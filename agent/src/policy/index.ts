import { parseE8 } from "../lib/decimal.js";
import { alignMinute } from "../lib/time.js";
import { fundingPositive } from "../templates/fundingPositive.js";
import { getTemplate } from "../templates/index.js";
import { priceAbove, type PriceAboveParams } from "../templates/priceAbove.js";
import type { FundingPositiveParams } from "../templates/fundingPositive.js";

/**
 * POLICY (MIMARI §7.5) — LLM önerilerini zincire gitmeden önce süzen deterministik kurallar.
 * LLM burayı atlatamaz: createMarket yalnız `checkProposal` onayından sonra çağrılır.
 */

export const POLICY = {
  allowedTemplates: [priceAbove.id, fundingPositive.id],
  spotInstruments: ["BTC-USDT", "ETH-USDT", "SOL-USDT", "AVAX-USDT", "XRP-USDT", "DOGE-USDT", "BTC-TRY", "ETH-TRY", "AVAX-TRY"],
  perpInstruments: ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP", "AVAX-USDT-SWAP", "XRP-USDT-SWAP", "DOGE-USDT-SWAP"],
  minDurationMin: 15,
  maxDurationMin: 180,
  minCloseGapMin: 5,
  maxCloseGapMin: 15,
  maxThresholdDeviationBps: 300n, // eşik, anlık fiyatın ±%3'ü içinde
  duplicateThresholdBps: 100n, // aynı şablon + enstrüman + ±%1 eşik tekrarı yasak
  minProbability: 0.15,
  maxProbability: 0.85,
  fundingCloseBeforeMin: 30,
} as const;

/** LLM'in `propose_market` aracıyla gönderdiği öneri (MIMARI §7.2). */
export type Proposal = {
  templateId: number;
  params: Record<string, unknown>;
  closeInMinutes: number;
  resolveInMinutes: number;
  myProbability: number;
  rationale_tr: string;
  evidence_tools_used: string[];
};

export type OpenMarketSummary = { templateId: number; params: Record<string, string>; resolveTime: number };

export type PolicyContext = {
  nowSec: number;
  openMarkets: OpenMarketSummary[];
  maxOpenMarkets: number;
  /** PRICE_ABOVE eşik kontrolü için son fiyat (E8). Policy çağıran tarafından ATK'dan okunur. */
  lastPriceE8?: bigint;
};

export type Approved = {
  templateId: number;
  params: unknown;
  closeTime: number;
  resolveTime: number;
  probability: number;
};

export type PolicyResult = { ok: true; market: Approved } | { ok: false; reasons: string[] };

export function checkProposal(p: Proposal, ctx: PolicyContext): PolicyResult {
  const reasons: string[] = [];
  const reject = (r: string) => reasons.push(r);

  if (ctx.openMarkets.length >= ctx.maxOpenMarkets) reject(`açık market sınırı dolu (${ctx.maxOpenMarkets})`);
  if (!(POLICY.allowedTemplates as readonly number[]).includes(p.templateId)) {
    return { ok: false, reasons: [...reasons, `şablon ${p.templateId} izinli değil`] };
  }
  if (!(p.myProbability >= POLICY.minProbability && p.myProbability <= POLICY.maxProbability)) {
    reject(`myProbability ${p.myProbability} aralık dışı (${POLICY.minProbability}–${POLICY.maxProbability}); çok kesin sonuçlu market açma`);
  }
  if (!p.rationale_tr || p.rationale_tr.trim().length < 20) reject("gerekçe (rationale_tr) çok kısa");
  if (!Array.isArray(p.evidence_tools_used) || new Set(p.evidence_tools_used).size < 2) {
    reject("en az 2 farklı ATK aracından veri kullanılmalı");
  }

  const template = getTemplate(p.templateId);
  let params: unknown;
  try {
    params = template.fromInput(p.params);
  } catch (e) {
    return { ok: false, reasons: [...reasons, `parametreler geçersiz: ${(e as Error).message}`] };
  }

  const now = alignMinute(ctx.nowSec);
  let closeTime: number;
  let resolveTime: number;

  if (p.templateId === priceAbove.id) {
    const pa = params as PriceAboveParams;
    if (!(POLICY.spotInstruments as readonly string[]).includes(pa.instId)) reject(`enstrüman izinli değil: ${pa.instId}`);
    if (!Number.isInteger(p.resolveInMinutes) || !Number.isInteger(p.closeInMinutes)) reject("süreler tam dakika olmalı");
    resolveTime = now + p.resolveInMinutes * 60;
    closeTime = now + p.closeInMinutes * 60;
    if (p.resolveInMinutes < POLICY.minDurationMin || p.resolveInMinutes > POLICY.maxDurationMin) {
      reject(`süre ${POLICY.minDurationMin}–${POLICY.maxDurationMin} dk arasında olmalı`);
    }
    const gap = p.resolveInMinutes - p.closeInMinutes;
    if (gap < POLICY.minCloseGapMin || gap > POLICY.maxCloseGapMin) {
      reject(`kapanış ile ölçüm arası ${POLICY.minCloseGapMin}–${POLICY.maxCloseGapMin} dk olmalı`);
    }
    if (ctx.lastPriceE8 === undefined) reject("son fiyat okunamadı; eşik doğrulanamıyor");
    else {
      const dev = absBps(pa.thresholdE8, ctx.lastPriceE8);
      if (dev > POLICY.maxThresholdDeviationBps) reject(`eşik son fiyattan %${Number(dev) / 100} uzakta (en fazla %3)`);
    }
    for (const m of ctx.openMarkets) {
      if (m.templateId !== priceAbove.id || m.params.instId !== pa.instId) continue;
      const other = BigInt(m.params.thresholdE8 ?? "0");
      if (other > 0n && absBps(pa.thresholdE8, other) <= POLICY.duplicateThresholdBps) {
        reject(`benzer market zaten açık (${pa.instId}, eşik ±%1)`);
      }
    }
  } else {
    const fp = params as FundingPositiveParams;
    if (!(POLICY.perpInstruments as readonly string[]).includes(fp.instId)) reject(`enstrüman izinli değil: ${fp.instId}`);
    resolveTime = fp.fundingTime + 120;
    closeTime = fp.fundingTime - POLICY.fundingCloseBeforeMin * 60;
    if (closeTime - now < 10 * 60) reject("funding zamanına çok az kaldı (kapanış en az 10 dk sonra olmalı)");
    if (resolveTime - now > POLICY.maxDurationMin * 60 * 4) reject("funding zamanı çok uzak");
    for (const m of ctx.openMarkets) {
      if (m.templateId === fundingPositive.id && m.params.instId === fp.instId && Number(m.params.fundingTime) === fp.fundingTime) {
        reject(`bu funding ödemesi için market zaten açık (${fp.instId})`);
      }
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, market: { templateId: p.templateId, params, closeTime: closeTime!, resolveTime: resolveTime!, probability: p.myProbability } };
}

function absBps(a: bigint, b: bigint): bigint {
  const d = a > b ? a - b : b - a;
  return (d * 10_000n) / b;
}

/** "81800" gibi bir fiyat string'i → E8; policy testleri ve scout için yardımcı. */
export const priceToE8 = (s: string) => parseE8(s);
