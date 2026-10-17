import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, fallback, http, type Address, type Hash, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { config, requireAgentKey } from "../config.js";

export type Deployment = {
  chainId: number;
  usdc: Address;
  pm: Address;
  agent: Address;
  owner: Address;
  treasury: Address;
  deployBlock: number;
};

let cachedDeployment: Deployment | null = null;

export function loadDeployment(): Deployment {
  if (cachedDeployment) return cachedDeployment;
  const path = resolve(config.DEPLOYMENTS_FILE);
  try {
    cachedDeployment = JSON.parse(readFileSync(path, "utf8")) as Deployment;
    return cachedDeployment;
  } catch {
    throw new Error(`Deploy dosyası okunamadı: ${path}. Önce F2 (Fuji deploy) yapılmalı.`);
  }
}

// Herkese açık Fuji RPC'si rate limit (429) verebiliyor → yedek RPC + JSON-RPC batch.
const DEFAULT_FALLBACK_RPC = "https://avalanche-fuji-c-chain-rpc.publicnode.com";
const WRITE_RPC = "https://api.avax-test.network/ext/bc/C/rpc";
const transport = fallback(
  [http(config.FUJI_RPC_URL, { batch: { batchSize: 10 } }), http(config.FUJI_RPC_FALLBACK ?? DEFAULT_FALLBACK_RPC, { batch: { batchSize: 10 } })],
  { retryCount: 2 },
);

// Avalanche ~1 sn'de kesinleşir; viem'in varsayılan 4 sn sorgulama aralığı onay süresi ölçümünü bozar (MIMARI §1.5).
const POLLING_MS = 250;

/** Okumalar Multicall3 ile tek çağrıda toplanır (Fuji'de 0xcA11...CA11 mevcut). */
export const publicClient = createPublicClient({
  chain: avalancheFuji,
  transport,
  pollingInterval: POLLING_MS,
  batch: { multicall: { batchSize: 4096 } },
});

let wallet: ReturnType<typeof makeWallet> | null = null;
function makeWallet() {
  const account = privateKeyToAccount(requireAgentKey());
  // İşlem gönderme publicnode'dan (resmî RPC ızgara yükünde IP'yi rate-limit'liyor ve kullanıcının MetaMask'ini de
  // etkiliyordu). publicnode'un hatalı eth_estimateGas'ı sorun değil: tüm agent işlemleri sabit gas (WRITE_GAS) kullanır.
  const writeTransport = fallback([http(config.FUJI_RPC_URL), http(WRITE_RPC)], { retryCount: 2 });
  return createWalletClient({ account, chain: avalancheFuji, transport: writeTransport, pollingInterval: POLLING_MS });
}

export function agentWallet() {
  if (!wallet) wallet = makeWallet();
  return wallet;
}

/**
 * Tx gönder, onayını bekle ve gönderim→onay süresini ölç (MIMARI §1.5: hızlı kesinlik kanıtı).
 * Tek agent cüzdanı olduğu için tx'ler sıraya alınır (nonce çakışmasını önler).
 */
let queue: Promise<unknown> = Promise.resolve();

export function sendAndConfirm(
  label: string,
  send: () => Promise<Hash>,
): Promise<{ hash: Hash; confirmMs: number; totalMs: number; block: bigint; logs: Log[] }> {
  const run = async () => {
    const started = Date.now();
    const hash = await send(); // simülasyon + gas tahmini + imza + gönderim
    const submitted = Date.now();
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000, pollingInterval: POLLING_MS });
    if (receipt.status !== "success") throw new Error(`${label} tx başarısız: ${hash}`);
    const done = Date.now();
    // confirmMs: ağa ulaşan tx'in kesinleşme süresi (Avalanche hızının ölçüsü); totalMs: uçtan uca
    return { hash, confirmMs: done - submitted, totalMs: done - started, block: receipt.blockNumber, logs: receipt.logs };
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}
