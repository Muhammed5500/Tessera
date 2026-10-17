/**
 * Float kullanmadan ondalık işlemleri (CLAUDE.md: para/fiyat → bigint veya decimal string).
 * Fiyatlar 1e8 ölçekli bigint (E8) olarak tutulur.
 */

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** "81719.12" → 8171912000000n. 8 basamaktan fazlası kesilir (yuvarlanmaz). */
export function parseE8(value: string): bigint {
  const s = value.trim();
  if (!DECIMAL.test(s)) throw new Error(`geçersiz ondalık sayı: "${value}"`);
  const negative = s.startsWith("-");
  const [intPart, frac = ""] = (negative ? s.slice(1) : s).split(".");
  const fracPadded = (frac + "00000000").slice(0, 8);
  const n = BigInt(intPart) * 100_000_000n + BigInt(fracPadded);
  return negative ? -n : n;
}

/** 8171912000000n → "81719.12" */
export function formatE8(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const intPart = abs / 100_000_000n;
  const frac = (abs % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${intPart}${frac ? "." + frac : ""}`;
}

/** |a − b| / b, baz puan (1% = 100), aşağı yuvarlanmış. */
export function diffBps(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("diffBps: sıfıra bölme");
  const d = a > b ? a - b : b - a;
  return (d * 10_000n) / (b < 0n ? -b : b);
}

/** Ondalık string'in işareti: -1, 0, 1. */
export function sign(value: string): -1 | 0 | 1 {
  const n = parseE8(value.length > 0 ? value : "0");
  if (n === 0n) {
    // 8 basamağın altındaki çok küçük değerler: string'e bak
    const digits = value.replace(/[-.]/g, "").replace(/^0+/, "");
    if (digits === "") return 0;
    return value.trim().startsWith("-") ? -1 : 1;
  }
  return n > 0n ? 1 : -1;
}

/** TR biçiminde fiyat: 81800 → "81.800", 0.5 → "0,5" */
export function formatPriceTR(e8: bigint): string {
  const [i, f] = formatE8(e8).split(".");
  const neg = i.startsWith("-");
  const digits = neg ? i.slice(1) : i;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}${grouped}${f ? "," + f : ""}`;
}
