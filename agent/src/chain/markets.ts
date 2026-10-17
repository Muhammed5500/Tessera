import { parseEventLogs, parseUnits, type Address, type Hex } from "viem";
import { mockUsdcAbi, predictionMarketAbi } from "./abi.js";
import { agentWallet, loadDeployment, publicClient, sendAndConfirm } from "./client.js";

/** Kontrattaki enum'lar (PredictionMarket.sol) */
export const Status = { Active: 0, Proposed: 1, Disputed: 2, Finalized: 3 } as const;
export const Outcome = { Unresolved: 0, Yes: 1, No: 2, Void: 3 } as const;
export const outcomeFromString = { YES: Outcome.Yes, NO: Outcome.No, VOID: Outcome.Void } as const;

export type OnchainMarket = {
  id: bigint;
  templateId: number;
  params: Hex;
  question: string;
  metadataURI: string;
  createdAt: number;
  closeTime: number;
  resolveTime: number;
  proposedAt: number;
  status: number;
  proposedOutcome: number;
  finalOutcome: number;
  yesPool: bigint;
  noPool: bigint;
  fee: bigint;
  evidenceHash: Hex;
  evidenceURI: string;
  disputer: Address;
};

const pm = () => loadDeployment().pm;

/** Sabit gas limiti: Fuji RPC gas tahmini zaman zaman anlamsız değer döndürüyor (17 Ekim, "exceeds block gas limit").
 *  Ücret kullanılan gas üzerinden alındığı için yüksek limit maliyeti artırmaz. */
export const WRITE_GAS = 1_500_000n;

export async function marketCount(): Promise<bigint> {
  return publicClient.readContract({ address: pm(), abi: predictionMarketAbi, functionName: "marketCount" });
}

export async function getMarket(id: bigint): Promise<OnchainMarket> {
  const m = await publicClient.readContract({ address: pm(), abi: predictionMarketAbi, functionName: "getMarket", args: [id] });
  return {
    id,
    templateId: Number(m.templateId),
    params: m.params,
    question: m.question,
    metadataURI: m.metadataURI,
    createdAt: Number(m.createdAt),
    closeTime: Number(m.closeTime),
    resolveTime: Number(m.resolveTime),
    proposedAt: Number(m.proposedAt),
    status: Number(m.status),
    proposedOutcome: Number(m.proposedOutcome),
    finalOutcome: Number(m.finalOutcome),
    yesPool: m.yesPool,
    noPool: m.noPool,
    fee: m.fee,
    evidenceHash: m.evidenceHash,
    evidenceURI: m.evidenceURI,
    disputer: m.disputer,
  };
}

/** Kesinleşmiş marketler değişmez → bir kez okunup önbellekte tutulur (RPC yükü). */
const finalizedCache = new Map<string, OnchainMarket>();

export async function getAllMarkets(): Promise<OnchainMarket[]> {
  const n = await marketCount();
  const ids = Array.from({ length: Number(n) }, (_, i) => BigInt(i + 1));
  return Promise.all(
    ids.map(async (id) => {
      const cached = finalizedCache.get(id.toString());
      if (cached) return cached;
      const m = await getMarket(id); // multicall ile toplanır
      if (m.status === Status.Finalized) finalizedCache.set(id.toString(), m);
      return m;
    }),
  );
}

export async function readParams() {
  const read = <T>(functionName: string) =>
    publicClient.readContract({ address: pm(), abi: predictionMarketAbi, functionName: functionName as never }) as Promise<T>;
  const [disputeWindow, proposeDeadline, minResolveGap, minBet] = await Promise.all([
    read<bigint>("disputeWindow"),
    read<bigint>("proposeDeadline"),
    read<bigint>("minResolveGap"),
    read<bigint>("minBet"),
  ]);
  return {
    disputeWindow: Number(disputeWindow),
    proposeDeadline: Number(proposeDeadline),
    minResolveGap: Number(minResolveGap),
    minBet,
  };
}

// ---------------- yazma (yalnız deterministik koddan çağrılır) ----------------

/** Market açar; market numarası işlem makbuzundaki MarketCreated olayından okunur (eşzamanlı açılışlarda güvenli). */
export async function createMarket(a: {
  templateId: number;
  params: Hex;
  question: string;
  metadataURI: string;
  closeTime: number;
  resolveTime: number;
}) {
  const res = await sendAndConfirm("createMarket", () =>
    agentWallet().writeContract({ gas: WRITE_GAS,
      address: pm(),
      abi: predictionMarketAbi,
      functionName: "createMarket",
      args: [a.templateId, a.params, a.question, a.metadataURI, BigInt(a.closeTime), BigInt(a.resolveTime)],
    }),
  );
  const ev = parseEventLogs({ abi: predictionMarketAbi, logs: res.logs, eventName: "MarketCreated" })[0];
  if (!ev) throw new Error(`MarketCreated olayı bulunamadı: ${res.hash}`);
  return { ...res, id: ev.args.id };
}

export function proposeResolution(id: bigint, outcome: number, evidenceHash: Hex, evidenceURI: string) {
  return sendAndConfirm("proposeResolution", () =>
    agentWallet().writeContract({ gas: WRITE_GAS,
      address: pm(),
      abi: predictionMarketAbi,
      functionName: "proposeResolution",
      args: [id, outcome, evidenceHash, evidenceURI],
    }),
  );
}

export function finalize(id: bigint) {
  return sendAndConfirm("finalize", () =>
    agentWallet().writeContract({ gas: WRITE_GAS, address: pm(), abi: predictionMarketAbi, functionName: "finalize", args: [id] }),
  );
}

export function claim(id: bigint) {
  return sendAndConfirm("claim", () =>
    agentWallet().writeContract({ gas: WRITE_GAS, address: pm(), abi: predictionMarketAbi, functionName: "claim", args: [id] }),
  );
}

/** Bir adresin verilen marketlerdeki alınabilir ödülü ve daha önce alıp almadığı (multicall ile tek turda). */
export async function payouts(ids: bigint[], addr: Address): Promise<{ id: bigint; payout: bigint; claimed: boolean }[]> {
  return Promise.all(
    ids.map(async (id) => {
      const [payout, pos] = await Promise.all([
        publicClient.readContract({ address: pm(), abi: predictionMarketAbi, functionName: "previewPayout", args: [id, addr] }),
        publicClient.readContract({ address: pm(), abi: predictionMarketAbi, functionName: "getPosition", args: [id, addr] }),
      ]);
      return { id, payout, claimed: pos[2] };
    }),
  );
}

export function bet(id: bigint, yes: boolean, amount: bigint) {
  return sendAndConfirm("bet", () =>
    agentWallet().writeContract({ gas: WRITE_GAS, address: pm(), abi: predictionMarketAbi, functionName: "bet", args: [id, yes, amount] }),
  );
}

/**
 * Başlangıç likiditesi (MIMARI §7.2 adım 6): toplam `totalUsdc` kUSDC, YES'e p, NO'ya 1−p oranında.
 * Her taraf en az `minSideUsdc`. Tam tutar kadar approve (sınırsız approve yok).
 */
export async function seedMarket(id: bigint, p: number, totalUsdc: number, minSideUsdc = 2) {
  const total = parseUnits(String(totalUsdc), 6);
  const minSide = parseUnits(String(minSideUsdc), 6);
  let yesAmt = (total * BigInt(Math.round(p * 100))) / 100n;
  if (yesAmt < minSide) yesAmt = minSide;
  if (total - yesAmt < minSide) yesAmt = total - minSide;
  const noAmt = total - yesAmt;
  const { usdc } = loadDeployment();
  await sendAndConfirm("approve", () =>
    agentWallet().writeContract({ gas: WRITE_GAS, address: usdc, abi: mockUsdcAbi, functionName: "approve", args: [pm(), total] }),
  );
  const y = await bet(id, true, yesAmt);
  const n = await bet(id, false, noAmt);
  return { yesAmt, noAmt, txs: [y.hash, n.hash] };
}
