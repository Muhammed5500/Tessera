import { decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import { z } from "zod";
import type { Site } from "../atk/types.js";
import { diffBps, formatE8, formatPriceTR, parseE8 } from "../lib/decimal.js";
import { formatTR } from "../lib/time.js";
import { candleObservation, fetchCandleAt, fetchIndexCandleAt } from "./candles.js";
import type { Observation, ResolveContext, ResolveResult, Template } from "./types.js";

/** Açık uçlu ızgara bantlarını metinde "X altı / X ve üstü" diye yazmak için eşikler (kural aynı: low ≤ close < high). */
const TAIL_LOW_MAX_E8 = 100_000_000n; // ≤ 1 $
const TAIL_HIGH_MIN_E8 = 1_000_000n * 100_000_000n; // ≥ 1 milyon $

export type PriceInBandParams = { site: Site; instId: string; lowE8: bigint; highE8: bigint };

const ABI = [
  { name: "site", type: "string" },
  { name: "instId", type: "string" },
  { name: "lowE8", type: "int256" },
  { name: "highE8", type: "int256" },
] as const;

const input = z.object({
  site: z.enum(["global", "tr"]),
  instId: z.string().regex(/^[A-Z0-9]+-(USDT|USDC)$/, "spot USDT/USDC paritesi bekleniyor (ör. BTC-USDT)"),
  low: z.union([z.string(), z.number()]).transform((v) => String(v)),
  high: z.union([z.string(), z.number()]).transform((v) => String(v)),
});

/**
 * Şablon 3 — PRICE_IN_BAND (canlı ızgara kareleri)
 * Kural: low ≤ close(resolveTime) < high → YES, aksi NO.
 * Çapraz kontrol PRICE_ABOVE ile aynı: <BASE>-USD index mumu (MCP), fark > CROSSCHECK_MAX_BPS → VOID.
 */
export const priceInBand: Template<PriceInBandParams> = {
  id: 3,
  key: "PRICE_IN_BAND",
  name: "Fiyat bu aralıkta mı kapanacak?",

  fromInput(raw) {
    const p = input.parse(raw);
    const lowE8 = parseE8(p.low);
    const highE8 = parseE8(p.high);
    if (lowE8 <= 0n || highE8 <= lowE8) throw new Error("0 < low < high olmalı");
    return { site: p.site, instId: p.instId, lowE8, highE8 };
  },

  encode: (p) => encodeAbiParameters(ABI, [p.site, p.instId, p.lowE8, p.highE8]),

  decode(data: Hex) {
    const [site, instId, lowE8, highE8] = decodeAbiParameters(ABI, data);
    if (site !== "global" && site !== "tr") throw new Error(`bilinmeyen site: ${site}`);
    return { site, instId, lowE8, highE8 };
  },

  toJson: (p) => ({ site: p.site, instId: p.instId, lowE8: p.lowE8.toString(), highE8: p.highE8.toString() }),

  questionTR: (p, t) => {
    const base = `${p.instId.split("-")[0]} ${formatTR(t)}'de`;
    if (p.lowE8 <= TAIL_LOW_MAX_E8) return `${base} ${formatPriceTR(p.highE8)} $ altında mı?`;
    if (p.highE8 >= TAIL_HIGH_MIN_E8) return `${base} ${formatPriceTR(p.lowE8)} $ veya üstünde mi?`;
    return `${base} ${formatPriceTR(p.lowE8)}–${formatPriceTR(p.highE8)} $ aralığında mı?`;
  },

  ruleTR: (p, t) =>
    `OKX (${p.site}) ${p.instId} 1 dakikalık mumunun ${formatTR(t)} itibarıyla kapanış fiyatı ` +
    (p.lowE8 <= TAIL_LOW_MAX_E8
      ? `${formatPriceTR(p.highE8)} $ altındaysa EVET, değilse HAYIR. `
      : p.highE8 >= TAIL_HIGH_MIN_E8
        ? `${formatPriceTR(p.lowE8)} $ veya üstündeyse EVET, değilse HAYIR. `
        : `${formatPriceTR(p.lowE8)} $ veya üstü ve ${formatPriceTR(p.highE8)} $ altındaysa EVET, değilse HAYIR. `) +
    `Fiyat bağımsız bir ikinci kaynakla %0,5'ten fazla ayrışırsa market geçersiz sayılır.`,

  async resolve(p, t, ctx: ResolveContext): Promise<ResolveResult> {
    const primary = await fetchCandleAt(ctx.atk, p.site, p.instId, t);
    const priceE8 = parseE8(primary.candle.close);
    const observations: Observation[] = [candleObservation("primary", p.site, "candle_1m", p.instId, primary.candle)];

    const base = p.instId.split("-")[0];
    const idx = await fetchIndexCandleAt(ctx.atk, `${base}-USD`, t, ctx.nowMs);
    observations.push(candleObservation("crosscheck", "global", "index_candle_1m", `${base}-USD`, idx.candle));
    const referenceE8 = parseE8(idx.candle.close);
    const bps = diffBps(priceE8, referenceE8);
    const ok = bps <= ctx.crossCheckMaxBps;
    const crossCheck = { maxBps: ctx.crossCheckMaxBps.toString(), diffBps: bps.toString(), reference: formatE8(referenceE8), ok: String(ok) };
    const rule = "params.lowE8 <= primary.close < params.highE8";
    const commands = [primary.command, idx.command];
    const raw = [primary.raw, idx.raw];

    if (!ok) return { outcome: "VOID", reason: "CROSSCHECK_FAILED", observations, crossCheck, rule, commands, raw };
    const inBand = priceE8 >= p.lowE8 && priceE8 < p.highE8;
    return { outcome: inBand ? "YES" : "NO", observations, crossCheck, rule, commands, raw };
  },
};
