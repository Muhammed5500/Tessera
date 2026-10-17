import { describe, expect, it } from "vitest";
import { buildEvidence } from "../src/evidence/build.js";
import { canonicalJSON, hashCore } from "../src/evidence/canonical.js";
import { diffBps, formatE8, formatPriceTR, parseE8, sign } from "../src/lib/decimal.js";

describe("canonicalJSON", () => {
  it("anahtar sırasından bağımsızdır", () => {
    expect(canonicalJSON({ b: "1", a: { d: "2", c: "3" } })).toBe(canonicalJSON({ a: { c: "3", d: "2" }, b: "1" }));
    expect(canonicalJSON({ b: "1", a: "2" })).toBe('{"a":"2","b":"1"}');
  });

  it("sayıları ve bigint'i string'e çevirir, undefined alanları atlar", () => {
    expect(canonicalJSON({ n: 5, big: 10n, u: undefined, z: null, t: true })).toBe('{"big":"10","n":"5","t":true,"z":null}');
  });

  it("dizilerde sırayı korur", () => {
    expect(canonicalJSON(["b", "a"])).toBe('["b","a"]');
  });

  it("sonlu olmayan sayıyı reddeder", () => {
    expect(() => canonicalJSON({ x: Number.NaN })).toThrow();
  });
});

describe("evidence", () => {
  const input = {
    chainId: 43113,
    contract: "0xABCDEF0000000000000000000000000000000001",
    marketId: 7n,
    templateId: 1,
    params: { site: "global", instId: "BTC-USDT", thresholdE8: "8100000000000" },
    resolveTime: 1_792_230_240,
    result: {
      outcome: "YES" as const,
      observations: [{ role: "primary", close: "81690.3" }],
      crossCheck: { ok: "true", diffBps: "14", maxBps: "50", reference: "81569.6" },
      rule: "primary.close > params.thresholdE8",
      commands: ["cmd-a"],
      raw: ["raw-a"],
    },
  };

  it("hash yalnız core'a bağlıdır: meta (zaman, ham çıktı) değişse de aynı kalır", () => {
    const a = buildEvidence(input, 1);
    const b = buildEvidence({ ...input, result: { ...input.result, commands: ["x"], raw: ["y"] } }, 999_999);
    expect(a.meta.evidenceHash).toBe(b.meta.evidenceHash);
    expect(a.meta.evidenceHash).toBe(hashCore(a.core));
    expect(a.core.contract).toBe(input.contract.toLowerCase());
  });

  it("sonuç değişirse hash değişir", () => {
    const a = buildEvidence(input);
    const b = buildEvidence({ ...input, result: { ...input.result, outcome: "NO" as const } });
    expect(a.meta.evidenceHash).not.toBe(b.meta.evidenceHash);
  });
});

describe("decimal", () => {
  it("parseE8 / formatE8", () => {
    expect(parseE8("81690.3")).toBe(8_169_030_000_000n);
    expect(parseE8("-0.5")).toBe(-50_000_000n);
    expect(formatE8(8_169_030_000_000n)).toBe("81690.3");
    expect(formatE8(-50_000_000n)).toBe("-0.5");
    expect(() => parseE8("1e5")).toThrow();
  });

  it("diffBps", () => {
    expect(diffBps(parseE8("81690.3"), parseE8("81569.6"))).toBe(14n);
    expect(diffBps(parseE8("100"), parseE8("100"))).toBe(0n);
  });

  it("sign küçük değerleri de doğru okur", () => {
    expect(sign("0.000000001")).toBe(1);
    expect(sign("-0.000000001")).toBe(-1);
    expect(sign("0.0")).toBe(0);
  });

  it("formatPriceTR", () => {
    expect(formatPriceTR(parseE8("4038031"))).toBe("4.038.031");
    expect(formatPriceTR(parseE8("81690.3"))).toBe("81.690,3");
  });
});
