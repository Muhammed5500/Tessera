import { describe, expect, it } from "vitest";
import { fundingPositive } from "../src/templates/fundingPositive.js";
import { priceAbove } from "../src/templates/priceAbove.js";
import { NotReady, type ResolveContext } from "../src/templates/types.js";
import { candle, fakeAtk, indexCandle } from "./fakeAtk.js";

const T = 1_792_230_240; // dakikaya hizalı
const ctx = (atk: ResolveContext["atk"]): ResolveContext => ({ atk, crossCheckMaxBps: 50n, nowMs: (T + 120) * 1000 });

describe("PRICE_ABOVE", () => {
  const params = priceAbove.fromInput({ site: "global", instId: "BTC-USDT", threshold: "81000" });

  it("encode/decode gidiş-dönüş", () => {
    expect(priceAbove.decode(priceAbove.encode(params))).toEqual(params);
    expect(params.thresholdE8).toBe(8_100_000_000_000n);
  });

  it("açılışı T−60 olan mumu kullanır ve eşik üstünde YES verir", async () => {
    const atk = fakeAtk(
      () => [candle(T - 60, "81690.3")],
      () => [indexCandle(T - 60, "81569.6")],
    );
    const r = await priceAbove.resolve(params, T, ctx(atk));
    expect(r.outcome).toBe("YES");
    expect(r.crossCheck?.diffBps).toBe("14");
    expect(atk.calls[0]).toContain(`--after ${T * 1000}`);
    expect(atk.calls[1]).toContain("market_get_index_candles");
  });

  it("eşite eşit kapanış NO verir (kesin büyüklük)", async () => {
    const atk = fakeAtk(() => [candle(T - 60, "81000")], () => [indexCandle(T - 60, "81000")]);
    expect((await priceAbove.resolve(params, T, ctx(atk))).outcome).toBe("NO");
  });

  it("kesinleşmemiş mumda NotReady fırlatır", async () => {
    const atk = fakeAtk(() => [candle(T - 60, "82000", "0")]);
    await expect(priceAbove.resolve(params, T, ctx(atk))).rejects.toBeInstanceOf(NotReady);
  });

  it("yanlış dakikanın mumunda NotReady fırlatır", async () => {
    const atk = fakeAtk(() => [candle(T - 120, "82000")]);
    await expect(priceAbove.resolve(params, T, ctx(atk))).rejects.toBeInstanceOf(NotReady);
  });

  it("çapraz kontrol eşiği aşılırsa VOID (CROSSCHECK_FAILED)", async () => {
    const atk = fakeAtk(() => [candle(T - 60, "82000")], () => [indexCandle(T - 60, "81000")]);
    const r = await priceAbove.resolve(params, T, ctx(atk));
    expect(r.outcome).toBe("VOID");
    expect(r.reason).toBe("CROSSCHECK_FAILED");
  });

  it("TRY paritesinde BTC-USDT × USDT-TRY ile çapraz kontrol yapar", async () => {
    const p = priceAbove.fromInput({ site: "tr", instId: "BTC-TRY", threshold: "3000000" });
    const atk = fakeAtk((_s, args) => {
      if (args[2] === "BTC-TRY") return [candle(T - 60, "4038031")];
      if (args[2] === "BTC-USDT") return [candle(T - 60, "81690.3")];
      if (args[2] === "USDT-TRY") return [candle(T - 60, "49.443")];
      throw new Error("beklenmeyen çağrı");
    });
    const r = await priceAbove.resolve(p, T, ctx(atk));
    expect(r.outcome).toBe("YES");
    expect(r.crossCheck?.diffBps).toBe("2");
    expect(r.observations).toHaveLength(3);
  });

  it("geçersiz girdiyi reddeder", () => {
    expect(() => priceAbove.fromInput({ site: "global", instId: "BTC-USDT-SWAP", threshold: "1" })).toThrow();
    expect(() => priceAbove.fromInput({ site: "mars", instId: "BTC-USDT", threshold: "1" })).toThrow();
    expect(() => priceAbove.fromInput({ site: "global", instId: "BTC-USDT", threshold: "abc" })).toThrow();
  });
});

describe("FUNDING_POSITIVE", () => {
  const FT = 1_792_224_000;
  const params = fundingPositive.fromInput({ instId: "BTC-USDT-SWAP", fundingTime: FT });
  const rows = (rate: string, ft = FT) => [{ fundingTime: String(ft * 1000), realizedRate: rate, instId: "BTC-USDT-SWAP" }];

  it("encode/decode gidiş-dönüş", () => {
    expect(fundingPositive.decode(fundingPositive.encode(params))).toEqual(params);
  });

  it.each([
    ["0.0000524801759437", "YES"],
    ["-0.0001", "NO"],
    ["0", "NO"],
    ["0.000000001", "YES"],
  ])("realizedRate=%s → %s", async (rate, expected) => {
    const r = await fundingPositive.resolve(params, FT + 120, ctx(fakeAtk(() => rows(rate))));
    expect(r.outcome).toBe(expected);
  });

  it("kayıt henüz yoksa NotReady", async () => {
    const atk = fakeAtk(() => rows("0.0001", FT - 8 * 3600));
    await expect(fundingPositive.resolve(params, FT + 120, ctx(atk))).rejects.toBeInstanceOf(NotReady);
  });

  it("hizasız fundingTime reddedilir", () => {
    expect(() => fundingPositive.fromInput({ instId: "BTC-USDT-SWAP", fundingTime: FT + 7 })).toThrow();
  });
});
