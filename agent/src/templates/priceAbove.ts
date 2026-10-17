import { decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import { z } from "zod";
import type { Site } from "../atk/types.js";
import { diffBps, formatE8, formatPriceTR, parseE8 } from "../lib/decimal.js";
import { formatTR } from "../lib/time.js";
import { candleObservation, fetchCandleAt, fetchIndexCandleAt } from "./candles.js";
import type { Observation, ResolveContext, ResolveResult, Template } from "./types.js";

export type PriceAboveParams = { site: Site; instId: string; thresholdE8: bigint };

const ABI = [
  { name: "site", type: "string" },
  { name: "instId", type: "string" },
  { name: "thresholdE8", type: "int256" },
] as const;

const input = z.object({
  site: z.enum(["global", "tr"]),
  instId: z.string().regex(/^[A-Z0-9]+-(USDT|USDC|TRY)$/, "spot enstrüman bekleniyor (ör. BTC-USDT, BTC-TRY)"),
  threshold: z.union([z.string(), z.number()]).transform((v) => String(v)),
});

const quoteSymbol = (instId: string) => (instId.endsWith("-TRY") ? "₺" : "$");

/**
 * Şablon 1 — PRICE_ABOVE (MIMARI §5.3)
 * Kural: close(resolveTime) > threshold → YES, aksi NO.
 * Çapraz kontrol: USDT/USDC paritelerinde <BASE>-USD index mumu (MCP);
 *                 TRY paritelerinde <BASE>-USDT × USDT-TRY (aynı dakika).
 */
export const priceAbove: Template<PriceAboveParams> = {
  id: 1,
  key: "PRICE_ABOVE",
  name: "Fiyat eşiğin üstünde mi?",

  fromInput(raw) {
    const p = input.parse(raw);
    const thresholdE8 = parseE8(p.threshold);
    if (thresholdE8 <= 0n) throw new Error("threshold pozitif olmalı");
    return { site: p.site, instId: p.instId, thresholdE8 };
  },

  encode: (p) => encodeAbiParameters(ABI, [p.site, p.instId, p.thresholdE8]),

  decode(data: Hex) {
    const [site, instId, thresholdE8] = decodeAbiParameters(ABI, data);
    if (site !== "global" && site !== "tr") throw new Error(`bilinmeyen site: ${site}`);
    return { site, instId, thresholdE8 };
  },

  toJson: (p) => ({ site: p.site, instId: p.instId, thresholdE8: p.thresholdE8.toString() }),

  questionTR: (p, t) =>
    `${p.instId.split("-")[0]} ${formatTR(t)}'de ${formatPriceTR(p.thresholdE8)} ${quoteSymbol(p.instId)} üstünde mi?`,

  ruleTR: (p, t) =>
    `OKX (${p.site}) ${p.instId} 1 dakikalık mumunun ${formatTR(t)} itibarıyla kapanış fiyatı ` +
    `${formatPriceTR(p.thresholdE8)} ${quoteSymbol(p.instId)}'dan büyükse EVET, değilse HAYIR. ` +
    `Fiyat bağımsız bir ikinci kaynakla %0,5'ten fazla ayrışırsa market geçersiz sayılır.`,

  async resolve(p, t, ctx: ResolveContext): Promise<ResolveResult> {
    const commands: string[] = [];
    const raw: string[] = [];
    const observations: Observation[] = [];

    const primary = await fetchCandleAt(ctx.atk, p.site, p.instId, t);
    commands.push(primary.command);
    raw.push(primary.raw);
    observations.push(candleObservation("primary", p.site, "candle_1m", p.instId, primary.candle));
    const priceE8 = parseE8(primary.candle.close);

    // --- çapraz kontrol ---
    const [base, quote] = p.instId.split("-");
    let referenceE8: bigint;
    if (quote === "TRY") {
      const usdt = await fetchCandleAt(ctx.atk, p.site, `${base}-USDT`, t);
      const fx = await fetchCandleAt(ctx.atk, p.site, "USDT-TRY", t);
      commands.push(usdt.command, fx.command);
      raw.push(usdt.raw, fx.raw);
      observations.push(
        candleObservation("crosscheck", p.site, "candle_1m", `${base}-USDT`, usdt.candle),
        candleObservation("crosscheck", p.site, "candle_1m", "USDT-TRY", fx.candle),
      );
      referenceE8 = (parseE8(usdt.candle.close) * parseE8(fx.candle.close)) / 100_000_000n;
    } else {
      const idx = await fetchIndexCandleAt(ctx.atk, `${base}-USD`, t, ctx.nowMs);
      commands.push(idx.command);
      raw.push(idx.raw);
      observations.push(candleObservation("crosscheck", "global", "index_candle_1m", `${base}-USD`, idx.candle));
      referenceE8 = parseE8(idx.candle.close);
    }

    const bps = diffBps(priceE8, referenceE8);
    const ok = bps <= ctx.crossCheckMaxBps;
    const crossCheck = {
      maxBps: ctx.crossCheckMaxBps.toString(),
      diffBps: bps.toString(),
      reference: formatE8(referenceE8),
      ok: String(ok),
    };
    const rule = "primary.close > params.thresholdE8";

    if (!ok) {
      return { outcome: "VOID", reason: "CROSSCHECK_FAILED", observations, crossCheck, rule, commands, raw };
    }
    return { outcome: priceE8 > p.thresholdE8 ? "YES" : "NO", observations, crossCheck, rule, commands, raw };
  },
};
