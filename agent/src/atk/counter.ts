import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

/**
 * Tüm ATK çağrılarının sayacı — /api/stats ve jüri ekranı için (MIMARI §8.2).
 * Dosyaya yazılır: agent yeniden başlasa ya da çağrı ayrı bir süreçten (scout:once, verify) gelse de sayılır.
 */
export type AtkCall = {
  tool: string;
  via: "cli" | "mcp";
  site: string;
  ms: number;
  ok: boolean;
  at: number;
};

const file = () => join(config.DATA_DIR, "atk-calls.jsonl");

export function recordCall(c: Omit<AtkCall, "at">): void {
  try {
    mkdirSync(config.DATA_DIR, { recursive: true });
    appendFileSync(file(), JSON.stringify({ ...c, at: Date.now() }) + "\n");
  } catch {
    /* sayaç hatası işi durdurmamalı */
  }
}

let cache: { size: number; calls: AtkCall[] } = { size: -1, calls: [] };

function load(): AtkCall[] {
  if (!existsSync(file())) return [];
  const size = statSync(file()).size;
  if (size === cache.size) return cache.calls;
  const calls: AtkCall[] = [];
  for (const line of readFileSync(file(), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      calls.push(JSON.parse(line));
    } catch {
      /* atla */
    }
  }
  cache = { size, calls };
  return calls;
}

export function snapshot() {
  const calls = load();
  const byTool: Record<string, number> = {};
  let errors = 0;
  for (const c of calls) {
    const key = `${c.via}:${c.tool}`;
    byTool[key] = (byTool[key] ?? 0) + 1;
    if (!c.ok) errors++;
  }
  return {
    totalCalls: calls.length,
    errors,
    distinctTools: new Set(calls.map((c) => c.tool)).size,
    byTool,
    recent: calls.slice(-20),
  };
}
