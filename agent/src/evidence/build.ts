import type { Hex } from "viem";
import type { ResolveResult } from "../templates/types.js";
import { hashCore } from "./canonical.js";

export const AGENT_VERSION = "kahin-agent@0.1.0";

/** Hash'e giren, tekrar üretilebilir kısım (MIMARI §9.1). */
export type EvidenceCore = {
  v: "1";
  chainId: string;
  contract: string;
  marketId: string;
  templateId: string;
  params: Record<string, string>;
  resolveTime: string;
  observations: Record<string, string>[];
  crossCheck: Record<string, string> | null;
  rule: string;
  outcome: ResolveResult["outcome"];
  reason?: string;
};

export type Evidence = {
  core: EvidenceCore;
  meta: {
    fetchedAt: string;
    commands: string[];
    raw: string[];
    agentVersion: string;
    evidenceHash: Hex;
    tx?: Hex;
  };
};

export type BuildInput = {
  chainId: number;
  contract: string;
  marketId: bigint | number;
  templateId: number;
  params: Record<string, string>;
  resolveTime: number;
  result: ResolveResult;
};

export function buildCore(i: BuildInput): EvidenceCore {
  return {
    v: "1",
    chainId: String(i.chainId),
    contract: i.contract.toLowerCase(),
    marketId: String(i.marketId),
    templateId: String(i.templateId),
    params: i.params,
    resolveTime: String(i.resolveTime),
    observations: i.result.observations,
    crossCheck: i.result.crossCheck,
    rule: i.result.rule,
    outcome: i.result.outcome,
    ...(i.result.reason ? { reason: i.result.reason } : {}),
  };
}

export function buildEvidence(i: BuildInput, nowMs = Date.now()): Evidence {
  const core = buildCore(i);
  return {
    core,
    meta: {
      fetchedAt: new Date(nowMs).toISOString(),
      commands: i.result.commands,
      raw: i.result.raw,
      agentVersion: AGENT_VERSION,
      evidenceHash: hashCore(core),
    },
  };
}
