import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, fallback, http, type Address, type Hash } from "viem";
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

const transport = fallback(
  [http(config.FUJI_RPC_URL), ...(config.FUJI_RPC_FALLBACK ? [http(config.FUJI_RPC_FALLBACK)] : [])],
  { retryCount: 2 },
);

export const publicClient = createPublicClient({ chain: avalancheFuji, transport });

let wallet: ReturnType<typeof makeWallet> | null = null;
function makeWallet() {
  const account = privateKeyToAccount(requireAgentKey());
  return createWalletClient({ account, chain: avalancheFuji, transport });
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

export function sendAndConfirm(label: string, send: () => Promise<Hash>): Promise<{ hash: Hash; confirmMs: number; block: bigint }> {
  const run = async () => {
    const started = Date.now();
    const hash = await send();
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`${label} tx başarısız: ${hash}`);
    return { hash, confirmMs: Date.now() - started, block: receipt.blockNumber };
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}
