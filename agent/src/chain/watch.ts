import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";
import { config } from "../config.js";
import { addEvent } from "../feed/store.js";
import { predictionMarketAbi } from "./abi.js";
import { loadDeployment, publicClient } from "./client.js";

/**
 * Zincirdeki BetPlaced olaylarını izler; agent dışındaki adreslerden (insan ya da dış agent)
 * gelen tahminleri akışa "bet" olarak yazar. Kalıcı imleç: data/watch.json
 */

const CHUNK = 2000n;
type WatchState = { lastBlock: string };
const file = () => join(config.DATA_DIR, "watch.json");

function load(fallback: bigint): bigint {
  if (!existsSync(file())) return fallback;
  return BigInt((JSON.parse(readFileSync(file(), "utf8")) as WatchState).lastBlock);
}
function save(b: bigint) {
  mkdirSync(config.DATA_DIR, { recursive: true });
  writeFileSync(file(), JSON.stringify({ lastBlock: b.toString() }));
}

let running = false;

export async function watchBets(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const dep = loadDeployment();
    const agent = getAddress(dep.agent);
    const head = await publicClient.getBlockNumber();
    let from = load(BigInt(dep.deployBlock)) + 1n;
    while (from <= head) {
      const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
      const logs = await publicClient.getContractEvents({
        address: dep.pm,
        abi: predictionMarketAbi,
        eventName: "BetPlaced",
        fromBlock: from,
        toBlock: to,
      });
      for (const l of logs) {
        const { id, user, yes, amount } = l.args as { id: bigint; user: `0x${string}`; yes: boolean; amount: bigint };
        if (getAddress(user) === agent) continue;
        addEvent({
          type: "bet",
          marketId: id.toString(),
          message: `Dış tahmin: ${user.slice(0, 6)}…${user.slice(-4)} · ${yes ? "EVET" : "HAYIR"} · ${(Number(amount) / 1e6).toLocaleString("tr-TR")} kUSDC`,
          data: { user, side: yes ? "YES" : "NO", amount: amount.toString(), block: l.blockNumber?.toString() },
          tx: l.transactionHash ?? undefined,
        });
      }
      save(to);
      from = to + 1n;
    }
  } catch (e) {
    const err = e as Error & { shortMessage?: string };
    console.error(`[watch] ${(err.shortMessage ?? err.message).slice(0, 160)}`);
  } finally {
    running = false;
  }
}
