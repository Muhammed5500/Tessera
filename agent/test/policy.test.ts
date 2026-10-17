import { describe, expect, it } from "vitest";
import { checkProposal, type PolicyContext, type Proposal } from "../src/policy/index.js";
import { parseE8 } from "../src/lib/decimal.js";

const NOW = 1_792_230_000; // dakikaya hizalı
const base: Proposal = {
  templateId: 1,
  params: { site: "global", instId: "BTC-USDT", threshold: "81800" },
  closeInMinutes: 40,
  resolveInMinutes: 50,
  myProbability: 0.4,
  rationale_tr: "OI son 1 saatte %6 arttı, funding yükseliyor; kalabalık long birikiyor.",
  evidence_tools_used: ["global__market_filter_oi_change", "global__market_get_funding_rate"],
};
const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  nowSec: NOW,
  openMarkets: [],
  maxOpenMarkets: 6,
  lastPriceE8: parseE8("81600"),
  ...over,
});

describe("policy", () => {
  it("geçerli PRICE_ABOVE önerisini kabul eder ve zamanları hesaplar", () => {
    const r = checkProposal(base, ctx());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.market.resolveTime).toBe(NOW + 50 * 60);
      expect(r.market.closeTime).toBe(NOW + 40 * 60);
    }
  });

  it.each<[string, Partial<Proposal>, Partial<PolicyContext>, RegExp]>([
    ["izinsiz şablon", { templateId: 3 }, {}, /izinli değil/],
    ["izinsiz enstrüman", { params: { site: "global", instId: "PEPE-USDT", threshold: "0.00001" } }, { lastPriceE8: parseE8("0.00001") }, /enstrüman/],
    ["çok kesin olasılık", { myProbability: 0.95 }, {}, /aralık dışı/],
    ["tek araç", { evidence_tools_used: ["a", "a"] }, {}, /2 farklı/],
    ["kısa süre", { closeInMinutes: 3, resolveInMinutes: 10 }, {}, /süre/],
    ["kapanış-ölçüm aralığı", { closeInMinutes: 49, resolveInMinutes: 50 }, {}, /kapanış ile ölçüm/],
    ["uzak eşik", { params: { site: "global", instId: "BTC-USDT", threshold: "90000" } }, {}, /uzakta/],
    ["açık market sınırı", {}, { maxOpenMarkets: 0 }, /sınırı dolu/],
  ])("%s reddedilir", (_name, over, ctxOver, re) => {
    const r = checkProposal({ ...base, ...over }, ctx(ctxOver));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" | ")).toMatch(re);
  });

  it("benzer eşikli açık market varsa reddeder", () => {
    const r = checkProposal(
      base,
      ctx({ openMarkets: [{ templateId: 1, params: { site: "global", instId: "BTC-USDT", thresholdE8: parseE8("81900").toString() }, resolveTime: NOW + 600 }] }),
    );
    expect(r.ok).toBe(false);
  });

  it("FUNDING_POSITIVE: zamanları funding saatinden türetir", () => {
    const ft = NOW + 3 * 3600;
    const r = checkProposal(
      { ...base, templateId: 2, params: { instId: "BTC-USDT-SWAP", fundingTime: ft } },
      ctx(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.market.resolveTime).toBe(ft + 120);
      expect(r.market.closeTime).toBe(ft - 30 * 60);
    }
  });

  it("FUNDING_POSITIVE: funding'e çok az kaldıysa reddeder", () => {
    const r = checkProposal({ ...base, templateId: 2, params: { instId: "BTC-USDT-SWAP", fundingTime: NOW + 30 * 60 } }, ctx());
    expect(r.ok).toBe(false);
  });
});
