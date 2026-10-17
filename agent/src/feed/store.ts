import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

/** Agent akışı olayları — /agent sayfası ve jüri ekranı (MIMARI §7.6). */
export type FeedEvent = {
  id: number;
  at: string;
  type:
    | "market_created"
    | "proposal_rejected"
    | "no_market"
    | "seed"
    | "resolution_proposed"
    | "finalized"
    | "resolve_waiting"
    | "hedge"
    | "error"
    | "info";
  marketId?: string;
  message: string;
  data?: Record<string, unknown>;
  tx?: string;
  confirmMs?: number;
};

const dir = () => config.DATA_DIR;
const file = () => join(dir(), "feed.jsonl");

const events: FeedEvent[] = [];
const listeners = new Set<(e: FeedEvent) => void>();
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (!existsSync(file())) return;
  for (const line of readFileSync(file(), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* bozuk satırı atla */
    }
  }
}

export function addEvent(e: Omit<FeedEvent, "id" | "at">): FeedEvent {
  ensureLoaded();
  const full: FeedEvent = { id: (events.at(-1)?.id ?? 0) + 1, at: new Date().toISOString(), ...e };
  events.push(full);
  mkdirSync(dir(), { recursive: true });
  appendFileSync(file(), JSON.stringify(full, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) + "\n");
  const tag = full.marketId ? ` #${full.marketId}` : "";
  console.log(`[feed] ${full.type}${tag}: ${full.message}`);
  for (const l of listeners) l(full);
  return full;
}

export function recentEvents(limit = 50): FeedEvent[] {
  ensureLoaded();
  return events.slice(-limit).reverse();
}

export function allEvents(): FeedEvent[] {
  ensureLoaded();
  return events;
}

export function subscribe(fn: (e: FeedEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------- market meta (gerekçe, araç izi) ----------------

const metaDir = () => join(dir(), "meta");

export function saveMeta(marketId: bigint | number, meta: Record<string, unknown>) {
  mkdirSync(metaDir(), { recursive: true });
  writeFileSync(join(metaDir(), `${marketId}.json`), JSON.stringify(meta, null, 2));
}

export function loadMeta(marketId: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(metaDir(), `${marketId}.json`), "utf8"));
  } catch {
    return null;
  }
}
