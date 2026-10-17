import type { Atk } from "../atk/types.js";
import { buildEvidence, type Evidence } from "../evidence/build.js";
import { getTemplate } from "../templates/index.js";
import type { ResolveResult } from "../templates/types.js";
import type { Hex } from "viem";

export type MarketRef = { id: bigint; templateId: number; params: Hex; resolveTime: number };
export type ChainRef = { chainId: number; contract: string };

/**
 * Bir marketin sonucunu deterministik olarak hesaplar ve kanıtı üretir.
 * Resolver, `verify` scripti ve Oracle MCP (F4.5) AYNI fonksiyonu kullanır → aynı hash.
 * NotReady fırlatabilir (veri henüz yok).
 */
export async function computeEvidence(
  m: MarketRef,
  chain: ChainRef,
  ctx: { atk: Atk; crossCheckMaxBps: bigint; nowMs: number },
): Promise<Evidence> {
  const template = getTemplate(m.templateId);
  const params = template.decode(m.params);
  const result = await template.resolve(params, m.resolveTime, ctx);
  return buildEvidence(
    {
      chainId: chain.chainId,
      contract: chain.contract,
      marketId: m.id,
      templateId: m.templateId,
      params: template.toJson(params),
      resolveTime: m.resolveTime,
      result,
    },
    ctx.nowMs,
  );
}

/** Veri hiç gelmediğinde (deadline yaklaşırken) VOID kanıtı. */
export function dataUnavailableEvidence(m: MarketRef, chain: ChainRef, error: string, nowMs: number): Evidence {
  const template = getTemplate(m.templateId);
  const result: ResolveResult = {
    outcome: "VOID",
    reason: "DATA_UNAVAILABLE",
    observations: [],
    crossCheck: null,
    rule: "data unavailable before propose deadline",
    commands: [],
    raw: [error],
  };
  return buildEvidence(
    {
      chainId: chain.chainId,
      contract: chain.contract,
      marketId: m.id,
      templateId: m.templateId,
      params: template.toJson(template.decode(m.params)),
      resolveTime: m.resolveTime,
      result,
    },
    nowMs,
  );
}
