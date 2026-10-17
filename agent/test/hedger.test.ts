import { describe, expect, it } from "vitest";
import { estimateCost, exposureUp, planHedge } from "../src/hedger/plan.js";

const U = (n: number) => BigInt(Math.round(n * 1e6)); // test yardımcısı (USDT → mikro)
const base = { current: 0n, ratioBps: 2000n, maxNotional: U(20), minStep: U(5) };

describe("hedger", () => {
  it("maruziyet: YES yukarı, NO aşağı yönlü risk", () => {
    expect(exposureUp([{ marketId: "2", direction: 1, yes: U(6.6), no: U(13.4) }])).toBe(U(-6.8));
    expect(exposureUp([{ marketId: "3", direction: -1, yes: U(10), no: 0n }])).toBe(U(-10));
  });

  it("aşağı yönlü riskte BTC alır", () => {
    const p = planHedge({ ...base, exposureUp: U(-50) });
    expect(p.action).toBe("buy");
    expect(p.notional).toBe(U(10)); // 50 × %20
  });

  it("küçük farkta işlem yapmaz", () => {
    const p = planHedge({ ...base, exposureUp: U(-6.8) });
    expect(p.action).toBe("none");
  });

  it("tavanı aşmaz", () => {
    const p = planHedge({ ...base, exposureUp: U(-1000) });
    expect(p.target).toBe(U(20));
  });

  it("açığa satış yapmaz: yukarı risk varsa hedef 0, elde BTC varsa satar", () => {
    const p1 = planHedge({ ...base, exposureUp: U(100) });
    expect(p1.target).toBe(0n);
    expect(p1.action).toBe("none");
    const p2 = planHedge({ ...base, current: U(12), exposureUp: U(100) });
    expect(p2.action).toBe("sell");
    expect(p2.notional).toBe(U(12));
  });

  it("emir defterinden ortalama fiyat ve kayma", () => {
    const asks: [string, string][] = [
      ["100", "0.05"], // 5 USDT
      ["101", "1"],
    ];
    const c = estimateCost(asks, U(10), 10n);
    expect(c.filled).toBe(true);
    expect(c.bestPriceE8).toBe(100n * 100_000_000n);
    expect(c.slippageBps).toBeGreaterThan(0n);
    expect(c.slippageBps).toBeLessThan(100n);
    expect(c.feeMicro).toBe(U(0.01)); // 10 USDT × 10 bps
  });

  it("derinlik yetmezse filled=false", () => {
    expect(estimateCost([["100", "0.01"]], U(10), 10n).filled).toBe(false);
  });
});
