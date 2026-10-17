/** Agent servisinin HTTP API'si (MIMARI §7.6). Erişilemezse null döner; arayüz zincir verisiyle çalışmaya devam eder. */
export const AGENT_API = (process.env.NEXT_PUBLIC_AGENT_API ?? "http://localhost:8787").replace(/\/$/, "");

export type FeedEvent = {
  id: number;
  at: string;
  type: string;
  marketId?: string;
  message: string;
  data?: Record<string, unknown>;
  tx?: string;
  confirmMs?: number;
};

export type ToolTraceEntry = { tool: string; args: unknown; ms: number; ok: boolean; summary: string };

export type MarketMeta = {
  source?: string;
  model?: string;
  template?: string;
  rule?: string;
  rationale_tr?: string;
  myProbability?: number;
  evidence_tools_used?: string[];
  toolTrace?: ToolTraceEntry[];
  createdTx?: string;
};

export type Stats = {
  atk: { totalCalls: number; errors: number; distinctTools: number; byTool: Record<string, number> };
  markets: { created: number; proposed: number; finalized: number; rejectedProposals: number };
  chain: { txCount: number; avgConfirmMs: number | null; minConfirmMs: number | null };
};

export type Evidence = {
  core: Record<string, unknown> & { outcome: string; observations: Record<string, string>[]; crossCheck: Record<string, string> | null; rule: string; reason?: string };
  meta: { fetchedAt: string; commands: string[]; evidenceHash: string; tx?: string; agentVersion?: string };
};

async function get<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${AGENT_API}${path}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const getFeed = (limit = 50) => get<FeedEvent[]>(`/api/feed?limit=${limit}`);
export const getStats = () => get<Stats>("/api/stats");
export const getMeta = (id: string | bigint) => get<MarketMeta>(`/api/markets/${id}/meta`);
export const getEvidence = (id: string | bigint) => get<Evidence>(`/evidence/${id}.json`);

/** evidenceURI zincirde yazılı; önce onu, olmazsa API'yi dene. */
export async function fetchEvidence(id: bigint, evidenceURI?: string): Promise<Evidence | null> {
  if (evidenceURI) {
    try {
      const r = await fetch(evidenceURI, { cache: "no-store" });
      if (r.ok) return (await r.json()) as Evidence;
    } catch {
      /* API'ye düş */
    }
  }
  return getEvidence(id);
}
