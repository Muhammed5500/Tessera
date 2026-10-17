/**
 * Canlı ızgara için olasılık modeli. Yalnız başlangıç likiditesinin (seed) dağılımını belirler;
 * market sonucu her zaman OKX verisiyle deterministik çözülür. (Olasılık hesabında float kullanılır;
 * para tutarları bigint'e en sonda çevrilir.)
 */

/** Standart normal dağılım CDF'i (Abramowitz–Stegun 7.1.26, hata < 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** 1 dakikalık log-getirilerin standart sapması (kapanışlar yeniden eskiye ya da eskiden yeniye fark etmez). */
export function sigmaPerMinute(closes: number[]): number {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i] > 0 && closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 5) return 0.0005; // veri azsa makul varsayılan (~5 bps/dk)
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.max(Math.sqrt(v), 0.0001);
}

export type Band = { lowE8: bigint; highE8: bigint };

/** Spot fiyatı içeren bant ortada olacak şekilde `count` adet `width` genişliğinde bant. */
export function bandsAround(spotE8: bigint, widthE8: bigint, count: number): Band[] {
  const centerLow = (spotE8 / widthE8) * widthE8;
  const start = centerLow - BigInt(Math.floor(count / 2)) * widthE8;
  return Array.from({ length: count }, (_, i) => ({ lowE8: start + BigInt(i) * widthE8, highE8: start + BigInt(i + 1) * widthE8 }));
}

/**
 * Açık uçlu kenar bantları (Polymarket'teki "X ve üstü / X altı" seçenekleri): fiyat ortadaki bantların dışına
 * çıkarsa da tahmin yapılabilsin. Şablon 0 < low < high istediği için alt kenar 1e-8 $, üst kenar 10 milyon $.
 */
export const TAIL_LOW_E8 = 1n;
export const TAIL_HIGH_E8 = 10_000_000n * 100_000_000n;
export const isTail = (b: Band) => b.lowE8 === TAIL_LOW_E8 || b.highE8 === TAIL_HIGH_E8;

/** Ortadaki bantların altına ve üstüne birer açık uçlu bant ekler. */
export function withTails(bands: Band[]): Band[] {
  if (!bands.length) return bands;
  return [{ lowE8: TAIL_LOW_E8, highE8: bands[0].lowE8 }, ...bands, { lowE8: bands[bands.length - 1].highE8, highE8: TAIL_HIGH_E8 }];
}

/** Sıfır sürüklenmeli log-normal varsayımıyla fiyatın `minutes` sonra her bantta kapanma olasılığı. */
export function bandProbabilities(spot: number, sigmaMin: number, minutes: number, bands: Band[]): number[] {
  const s = sigmaMin * Math.sqrt(Math.max(minutes, 1));
  const z = (px: bigint) => Math.log(Number(px) / 1e8 / spot) / s;
  return bands.map((b) => Math.max(0, normCdf(z(b.highE8)) - normCdf(z(b.lowE8))));
}

/** Seed tutarları (mikro kUSDC): YES ≈ p·S, NO = S − YES; her taraf en az `minSide`. */
export function seedSplit(p: number, totalMicro: bigint, minSideMicro: bigint): { yes: bigint; no: bigint } {
  let yes = BigInt(Math.round(Number(totalMicro) * p));
  if (yes < minSideMicro) yes = minSideMicro;
  if (totalMicro - yes < minSideMicro) yes = totalMicro - minSideMicro;
  return { yes, no: totalMicro - yes };
}
