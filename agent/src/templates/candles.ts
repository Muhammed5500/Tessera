import type { Atk, Site } from "../atk/types.js";
import { NotReady, type Observation } from "./types.js";

/**
 * MIMARI §5.2: "t anındaki fiyat" = açılışı (t − 60) olan 1 dakikalık mumun kapanışı, confirm = "1".
 * ATK satır formatı (F0): [openTimeMs, o, h, l, c, vol, volCcy, volQuote, confirm]
 * Index satırı:           [openTimeMs, o, h, l, c, confirm]
 */

export type Candle = { openTimeMs: string; close: string; confirm: string };

export type Fetched = { candle: Candle; command: string; raw: string };

function pickRow(json: unknown, expectedOpenMs: number, confirmIndex: number, command: string): Candle {
  const rows = Array.isArray(json) ? (json as unknown[][]) : [];
  const row = rows.find((r) => Array.isArray(r) && String(r[0]) === String(expectedOpenMs));
  if (!row) {
    throw new NotReady(`mum bulunamadı (openTime=${expectedOpenMs}) — ${command}`);
  }
  const candle = { openTimeMs: String(row[0]), close: String(row[4]), confirm: String(row[confirmIndex]) };
  if (candle.confirm !== "1") throw new NotReady(`mum henüz kesinleşmedi (openTime=${expectedOpenMs})`);
  return candle;
}

/** Spot/perp 1m mumu — CLI ile (`--after` T ms → açılışı T−60 olan mum). */
export async function fetchCandleAt(atk: Atk, site: Site, instId: string, t: number): Promise<Fetched> {
  const res = await atk.cli(site, ["market", "candles", instId, "--bar", "1m", "--after", String(t * 1000), "--limit", "1"]);
  return { candle: pickRow(res.json, (t - 60) * 1000, 8, res.command), command: res.command, raw: res.raw };
}

/** Index 1m mumu — MCP ile (CLI `index-candles` `after` parametresini iletmiyor, MIMARI §8.4a). */
export async function fetchIndexCandleAt(atk: Atk, indexId: string, t: number, nowMs: number): Promise<Fetched> {
  const olderThanADay = nowMs - t * 1000 > 23 * 3600 * 1000;
  const res = await atk.mcp("global", "market_get_index_candles", {
    instId: indexId,
    bar: "1m",
    after: String(t * 1000),
    limit: 1,
    ...(olderThanADay ? { history: true } : {}),
  });
  return { candle: pickRow(res.json, (t - 60) * 1000, 5, res.command), command: res.command, raw: res.raw };
}

export function candleObservation(role: string, site: Site, kind: string, instId: string, c: Candle): Observation {
  return { role, source: "okx", site, kind, instId, openTimeMs: c.openTimeMs, close: c.close, confirm: c.confirm };
}
