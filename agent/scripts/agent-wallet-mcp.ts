/**
 * Tessera'e katılan dış agent'lar için KISITLI cüzdan MCP'si (stdio).
 *
 * Anahtar MCP yapılandırmasına YAZILMAZ: WALLET_DOTENV dosyasındaki WALLET_KEY_VAR değişkeninden okunur.
 * Yalnız şu işlemleri imzalar (başka adres/fonksiyon reddedilir):
 *   kUSDC.faucet() · kUSDC.approve(Tessera, ≤ tavan) · Tessera.bet(≤ tavan) · Tessera.claim()
 *
 * Env: WALLET_DOTENV (.env yolu), WALLET_KEY_VAR (ör. RIVAL_PRIVATE_KEY), DEPLOYMENTS_FILE, WALLET_MAX_USDC (vars. 20)
 */
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { createPublicClient, createWalletClient, decodeFunctionData, fallback, formatEther, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { z } from "zod";
import { mockUsdcAbi, predictionMarketAbi } from "../src/chain/abi.js";

console.log = (...a: unknown[]) => console.error(...a); // stdout MCP'ye ayrılmış

const envFile = process.env.WALLET_DOTENV;
if (envFile) dotenv.config({ path: envFile, quiet: true });
const keyVar = process.env.WALLET_KEY_VAR ?? "RIVAL_PRIVATE_KEY";
const key = process.env[keyVar];
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error(`[agent-wallet] ${keyVar} bulunamadı ya da geçersiz (${envFile ?? ".env yok"})`);
  process.exit(1);
}
const dep = JSON.parse(readFileSync(process.env.DEPLOYMENTS_FILE ?? "../deployments/fuji.json", "utf8")) as { usdc: Hex; pm: Hex; chainId: number };
const MAX = BigInt(Math.round(Number(process.env.WALLET_MAX_USDC ?? "20") * 1e6));

const account = privateKeyToAccount(key as Hex);
// Okuma publicnode'dan; gönderme resmî RPC'den (publicnode eth_estimateGas'ta hatalı değer döndürüyor).
const readTransport = fallback([http("https://avalanche-fuji-c-chain-rpc.publicnode.com"), http("https://api.avax-test.network/ext/bc/C/rpc")]);
const writeTransport = fallback([http("https://api.avax-test.network/ext/bc/C/rpc"), http("https://avalanche-fuji-c-chain-rpc.publicnode.com")]);
const pub = createPublicClient({ chain: avalancheFuji, transport: readTransport, pollingInterval: 250 });
const wallet = createWalletClient({ account, chain: avalancheFuji, transport: writeTransport });

const json = (v: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }],
});
const fail = (msg: string) => ({ content: [{ type: "text" as const, text: `REJECTED: ${msg}` }], isError: true });

/** İşlemi çöz ve izin listesine göre doğrula. */
function check(to: string, data: Hex): string | null {
  const target = getAddress(to);
  if (target === getAddress(dep.usdc)) {
    const d = decodeFunctionData({ abi: mockUsdcAbi, data });
    if (d.functionName === "faucet") return null;
    if (d.functionName === "approve") {
      const [spender, amount] = d.args as [Hex, bigint];
      if (getAddress(spender) !== getAddress(dep.pm)) return "approve is only allowed to the Tessera contract";
      if (amount > MAX) return `approve exceeds the cap (${Number(MAX) / 1e6} kUSDC)`;
      return null;
    }
    return `kUSDC.${d.functionName} is not allowed`;
  }
  if (target === getAddress(dep.pm)) {
    const d = decodeFunctionData({ abi: predictionMarketAbi, data });
    if (d.functionName === "bet") {
      const amount = (d.args as [bigint, boolean, bigint])[2];
      if (amount > MAX) return `bet exceeds the cap (${Number(MAX) / 1e6} kUSDC)`;
      return null;
    }
    if (d.functionName === "claim") return null;
    return `Tessera.${d.functionName} is not allowed`;
  }
  return `target address is not allowed: ${to}`;
}

const server = new McpServer({ name: "tessera-wallet", version: "0.1.0" });

server.registerTool(
  "wallet_info",
  { title: "Wallet", description: "This agent wallet's address, Fuji AVAX and kUSDC balance, and the per-transaction cap.", inputSchema: {} },
  async () => {
    const [avax, kusdc] = await Promise.all([
      pub.getBalance({ address: account.address }),
      pub.readContract({ address: dep.usdc, abi: mockUsdcAbi, functionName: "balanceOf", args: [account.address] }),
    ]);
    return json({ address: account.address, chainId: dep.chainId, avax: formatEther(avax), kUSDC: (Number(kusdc) / 1e6).toString(), maxPerTx: Number(MAX) / 1e6 });
  },
);

server.registerTool(
  "send_prepared",
  {
    title: "Sign and send prepared steps",
    description:
      "Signs and sends, in order, the steps returned by prepare_bet / prepare_claim (or the faucet step) to Avalanche Fuji. " +
      "Only Tessera actions (faucet, approve, bet, claim) within the cap are accepted; anything else is rejected.",
    inputSchema: {
      steps: z
        .array(z.object({ to: z.string(), data: z.string(), description: z.string().optional() }))
        .min(1)
        .max(4),
    },
  },
  async ({ steps }) => {
    for (const s of steps) {
      const err = check(s.to, s.data as Hex);
      if (err) return fail(`${s.description ?? s.to}: ${err}`);
    }
    const results = [];
    for (const s of steps) {
      try {
        // Sabit gas: RPC gas tahmini Fuji'de zaman zaman anlamsız değer döndürüyor (17 Ekim: "exceeds block gas limit").
        const hash = await wallet.sendTransaction({ to: getAddress(s.to), data: s.data as Hex, value: 0n, gas: 500_000n });
        const sent = Date.now();
        const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 250 });
        results.push({ description: s.description ?? null, hash, status: r.status, confirmMs: Date.now() - sent, explorer: `https://testnet.snowtrace.io/tx/${hash}` });
        if (r.status !== "success") break;
      } catch (e) {
        results.push({ description: s.description ?? null, error: ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).slice(0, 200) });
        break;
      }
    }
    return json({ from: account.address, results });
  },
);

await server.connect(new StdioServerTransport());
console.error(`[agent-wallet] hazır · ${account.address}`);
