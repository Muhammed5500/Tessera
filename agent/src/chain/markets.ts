import type { Address, Hex } from "viem";
import { predictionMarketAbi } from "./abi.js";
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

export async function getAllMarkets(): Promise<OnchainMarket[]> {
  const n = await marketCount();
  const ids = Array.from({ length: Number(n) }, (_, i) => BigInt(i + 1));
  return Promise.all(ids.map(getMarket));
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

export function createMarket(a: {
  templateId: number;
  params: Hex;
  question: string;
  metadataURI: string;
  closeTime: number;
  resolveTime: number;
}) {
  return sendAndConfirm("createMarket", () =>
    agentWallet().writeContract({
      address: pm(),
      abi: predictionMarketAbi,
      functionName: "createMarket",
      args: [a.templateId, a.params, a.question, a.metadataURI, BigInt(a.closeTime), BigInt(a.resolveTime)],
    }),
  );
}

export function proposeResolution(id: bigint, outcome: number, evidenceHash: Hex, evidenceURI: string) {
  return sendAndConfirm("proposeResolution", () =>
    agentWallet().writeContract({
      address: pm(),
      abi: predictionMarketAbi,
      functionName: "proposeResolution",
      args: [id, outcome, evidenceHash, evidenceURI],
    }),
  );
}

export function finalize(id: bigint) {
  return sendAndConfirm("finalize", () =>
    agentWallet().writeContract({ address: pm(), abi: predictionMarketAbi, functionName: "finalize", args: [id] }),
  );
}

export function bet(id: bigint, yes: boolean, amount: bigint) {
  return sendAndConfirm("bet", () =>
    agentWallet().writeContract({ address: pm(), abi: predictionMarketAbi, functionName: "bet", args: [id, yes, amount] }),
  );
}
