import { decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import { z } from "zod";
import { sign } from "../lib/decimal.js";
import { formatTR, isAligned } from "../lib/time.js";
import { NotReady, type ResolveContext, type ResolveResult, type Template } from "./types.js";

export type FundingPositiveParams = { instId: string; fundingTime: number };

const ABI = [
  { name: "instId", type: "string" },
  { name: "fundingTime", type: "uint64" },
] as const;

const input = z.object({
  instId: z.string().regex(/^[A-Z0-9]+-USDT-SWAP$/, "perp enstrüman bekleniyor (ör. BTC-USDT-SWAP)"),
  /** Unix saniye; OKX funding saatleri 03:00/11:00/19:00 TR (MIMARI §8.4a) */
  fundingTime: z.coerce.number().int().positive(),
});

type FundingRow = { fundingTime: string; realizedRate?: string; fundingRate?: string; instId?: string };

/**
 * Şablon 2 — FUNDING_POSITIVE (MIMARI §5.3)
 * Kural: fundingTime anında gerçekleşen (realizedRate) oran > 0 → YES, aksi NO.
 * Kaynak: global perp (`okx market funding-rate <inst> --history`). Tek kaynak; çapraz kontrol yok.
 */
export const fundingPositive: Template<FundingPositiveParams> = {
  id: 2,
  key: "FUNDING_POSITIVE",
  name: "Funding pozitif mi?",

  fromInput(raw) {
    const p = input.parse(raw);
    if (!isAligned(p.fundingTime)) throw new Error("fundingTime dakikaya hizalı Unix saniye olmalı");
    return { instId: p.instId, fundingTime: p.fundingTime };
  },

  encode: (p) => encodeAbiParameters(ABI, [p.instId, BigInt(p.fundingTime)]),

  decode(data: Hex) {
    const [instId, fundingTime] = decodeAbiParameters(ABI, data);
    return { instId, fundingTime: Number(fundingTime) };
  },

  toJson: (p) => ({ instId: p.instId, fundingTime: String(p.fundingTime) }),

  questionTR: (p) => `${p.instId.split("-")[0]} perp funding oranı ${formatTR(p.fundingTime)} ödemesinde pozitif mi?`,

  ruleTR: (p) =>
    `OKX global ${p.instId} için ${formatTR(p.fundingTime)} ödemesinde gerçekleşen funding oranı (realizedRate) ` +
    `sıfırdan büyükse EVET, sıfır veya negatifse HAYIR. Pozitif funding, long pozisyonların short'lara ödeme yaptığı anlamına gelir.`,

  async resolve(p, _t, ctx: ResolveContext): Promise<ResolveResult> {
    const res = await ctx.atk.cli("global", ["market", "funding-rate", p.instId, "--history", "--limit", "50"]);
    const rows = (Array.isArray(res.json) ? res.json : []) as FundingRow[];
    const targetMs = String(p.fundingTime * 1000);
    const row = rows.find((r) => String(r.fundingTime) === targetMs);

    if (!row) {
      const newest = rows.reduce((m, r) => Math.max(m, Number(r.fundingTime)), 0);
      if (newest < p.fundingTime * 1000) throw new NotReady(`funding kaydı henüz yok (${targetMs})`);
      throw new Error(`funding kaydı geçmiş listesinde bulunamadı (${targetMs})`);
    }
    const rate = row.realizedRate ?? "";
    if (rate === "") throw new NotReady(`realizedRate boş (${targetMs})`);

    return {
      outcome: sign(rate) > 0 ? "YES" : "NO",
      observations: [
        {
          role: "primary",
          source: "okx",
          site: "global",
          kind: "funding_settled",
          instId: p.instId,
          fundingTimeMs: targetMs,
          realizedRate: rate,
        },
      ],
      crossCheck: null,
      rule: "primary.realizedRate > 0",
      commands: [res.command],
      raw: [res.raw],
    };
  },
};
