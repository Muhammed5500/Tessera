import { parseE8 } from "../lib/decimal.js";

/**
 * Hedger'ın saf hesapları (MIMARI §7.4). Tüm tutarlar mikro-USDT (1e6) bigint; fiyatlar E8 bigint.
 * Varsayım: 1 kUSDC (test token) ≈ 1 USDT nominal — testnet riskinin temsili, mekanizma gösterimi.
 */

export type MarketExposure = {
  marketId: string;
  /** PRICE_ABOVE gibi "yukarı" yönlü marketlerde +1; aşağı yönlülerde −1 */
  direction: 1 | -1;
  yes: bigint; // agent'ın YES payı (mikro)
  no: bigint; // agent'ın NO payı (mikro)
};

/** exposureUp > 0: agent fiyat yükselirse kazanır (yukarı yönlü risk). */
export function exposureUp(positions: MarketExposure[]): bigint {
  return positions.reduce((acc, p) => acc + BigInt(p.direction) * (p.yes - p.no), 0n);
}

export type HedgePlan = {
  exposureUp: bigint;
  /** Hedef BTC pozisyonu (USDT nominal, + uzun / − kısa) */
  target: bigint;
  current: bigint;
  diff: bigint;
  action: "buy" | "sell" | "none";
  notional: bigint;
  reason: string;
};

export function planHedge(a: {
  exposureUp: bigint;
  current: bigint;
  ratioBps: bigint; // 0.2 → 2000
  maxNotional: bigint;
  minStep: bigint;
}): HedgePlan {
  let target = (-a.exposureUp * a.ratioBps) / 10_000n;
  if (target > a.maxNotional) target = a.maxNotional;
  if (target < -a.maxNotional) target = -a.maxNotional;
  // Spot'ta açığa satış yok: hedef en fazla mevcut pozisyon kadar küçültülebilir (negatif olamaz)
  let note = "";
  if (target < 0n) {
    note = "spot'ta açığa satış yok → hedef 0'a sabitlendi";
    target = 0n;
  }
  const diff = target - a.current;
  const abs = diff < 0n ? -diff : diff;
  if (abs < a.minStep) {
    return { exposureUp: a.exposureUp, target, current: a.current, diff, action: "none", notional: 0n, reason: note || `fark ${fmt(abs)} USDT < en küçük adım ${fmt(a.minStep)}` };
  }
  return {
    exposureUp: a.exposureUp,
    target,
    current: a.current,
    diff,
    action: diff > 0n ? "buy" : "sell",
    notional: abs,
    reason: note || (diff > 0n ? "agent aşağı yönlü riskte → BTC al" : "agent yukarı yönlü riskte → BTC sat"),
  };
}

export type CostEstimate = {
  avgPriceE8: bigint;
  bestPriceE8: bigint;
  slippageBps: bigint;
  feeMicro: bigint;
  filled: boolean;
};

/**
 * Emir defterinden `notional` (mikro-USDT) tutarındaki market emrinin ortalama fiyatı, kayma ve ücret tahmini.
 * levels: [[fiyat, miktar(base)], ...] — alış için asks, satış için bids (en iyiden kötüye).
 */
export function estimateCost(levels: [string, string][], notional: bigint, feeRateBps: bigint): CostEstimate {
  let remaining = notional * 100n; // mikro (1e6) → E8 ölçeği
  let baseE8 = 0n;
  let spentE8 = 0n;
  const best = levels.length ? parseE8(levels[0][0]) : 0n;
  for (const [px, sz] of levels) {
    if (remaining <= 0n) break;
    const priceE8 = parseE8(px);
    const sizeE8 = parseE8(sz);
    const levelValueE8 = (priceE8 * sizeE8) / 100_000_000n;
    const take = levelValueE8 < remaining ? levelValueE8 : remaining;
    baseE8 += (take * 100_000_000n) / priceE8;
    spentE8 += take;
    remaining -= take;
  }
  const avg = baseE8 > 0n ? (spentE8 * 100_000_000n) / baseE8 : 0n;
  const slip = best > 0n && avg > 0n ? (((avg > best ? avg - best : best - avg) * 10_000n) / best) : 0n;
  return { avgPriceE8: avg, bestPriceE8: best, slippageBps: slip, feeMicro: (notional * feeRateBps) / 10_000n, filled: remaining <= 0n };
}

export const fmt = (micro: bigint) => {
  const neg = micro < 0n;
  const a = neg ? -micro : micro;
  const s = `${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, "0").slice(0, 2)}`;
  return `${neg ? "-" : ""}${s}`;
};

/** Küçük tutarlar (ücret) için 4 ondalık */
export const fmt4 = (micro: bigint) => {
  const neg = micro < 0n;
  const a = neg ? -micro : micro;
  return `${neg ? "-" : ""}${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, "0").slice(0, 4)}`;
};
