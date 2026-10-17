/** Tüm ATK çağrılarının sayacı — /api/stats ve jüri ekranı için (MIMARI §8.2). */
export type AtkCall = {
  tool: string;
  via: "cli" | "mcp";
  site: string;
  ms: number;
  ok: boolean;
  at: number;
};

const calls: AtkCall[] = [];
const MAX_KEPT = 2000;

export function recordCall(c: Omit<AtkCall, "at">): void {
  calls.push({ ...c, at: Date.now() });
  if (calls.length > MAX_KEPT) calls.shift();
  totals.count++;
  if (!c.ok) totals.errors++;
  const key = `${c.via}:${c.tool}`;
  totals.byTool[key] = (totals.byTool[key] ?? 0) + 1;
}

const totals = { count: 0, errors: 0, byTool: {} as Record<string, number> };

export function snapshot() {
  return {
    totalCalls: totals.count,
    errors: totals.errors,
    distinctTools: Object.keys(totals.byTool).length,
    byTool: { ...totals.byTool },
    recent: calls.slice(-20),
  };
}
