import { describe, expect, it } from "vitest";
import { bandProbabilities, bandsAround, normCdf, seedSplit, sigmaPerMinute } from "../src/grid/model.js";
import { parseE8 } from "../src/lib/decimal.js";

describe("ızgara modeli", () => {
  it("normCdf", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("spot ortadaki bantta, bantlar bitişik", () => {
    const b = bandsAround(parseE8("81672.3"), parseE8("50"), 5);
    expect(b).toHaveLength(5);
    expect(b[2].lowE8).toBe(parseE8("81650"));
    expect(b[2].highE8).toBe(parseE8("81700"));
    expect(b[0].lowE8).toBe(parseE8("81550"));
    for (let i = 1; i < b.length; i++) expect(b[i].lowE8).toBe(b[i - 1].highE8);
  });

  it("olasılıklar: ortadaki bant en yüksek, toplam ≤ 1", () => {
    const b = bandsAround(parseE8("81675"), parseE8("50"), 5);
    const p = bandProbabilities(81675, 0.0006, 6, b);
    expect(Math.max(...p)).toBe(p[2]);
    expect(p.reduce((a, x) => a + x, 0)).toBeLessThanOrEqual(1);
    expect(p[0]).toBeGreaterThan(0);
  });

  it("sigma: sabit fiyatta taban değer, oynak seride daha büyük", () => {
    expect(sigmaPerMinute(Array(30).fill(100))).toBe(0.0001);
    const wiggly = Array.from({ length: 30 }, (_, i) => 100 * (1 + (i % 2 ? 0.002 : -0.002)));
    expect(sigmaPerMinute(wiggly)).toBeGreaterThan(0.003);
  });

  it("seed dağılımı: her taraf en az minimum", () => {
    expect(seedSplit(0.02, 10_000_000n, 1_000_000n)).toEqual({ yes: 1_000_000n, no: 9_000_000n });
    expect(seedSplit(0.5, 10_000_000n, 1_000_000n)).toEqual({ yes: 5_000_000n, no: 5_000_000n });
    expect(seedSplit(0.99, 10_000_000n, 1_000_000n)).toEqual({ yes: 9_000_000n, no: 1_000_000n });
  });
});
