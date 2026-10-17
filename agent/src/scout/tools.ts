import type Anthropic from "@anthropic-ai/sdk";
import { recordCall } from "../atk/counter.js";
import { getMcp } from "../atk/mcp.js";
import type { Site } from "../atk/types.js";

/**
 * Scout'un görebildiği ATK MCP araçları (MIMARI §7.2) — yalnız OKUMA, allowlist.
 * İsim çakışmasın diye site öneki eklenir: global__market_get_candles, tr__market_get_ticker ...
 */
const ALLOWLIST: Record<Site, string[]> = {
  global: [
    "market_get_ticker",
    "market_get_candles",
    "market_get_funding_rate",
    "market_get_oi_history",
    "market_filter_oi_change",
    "market_get_indicator",
    "market_get_mark_price",
  ],
  tr: ["market_get_ticker", "market_get_candles", "market_get_orderbook"],
};

const MAX_RESULT_CHARS = 6000;

export type ToolTraceEntry = { tool: string; args: unknown; ms: number; ok: boolean; summary: string };

export async function loadAtkTools(): Promise<Anthropic.Beta.BetaTool[]> {
  const out: Anthropic.Beta.BetaTool[] = [];
  for (const site of ["global", "tr"] as Site[]) {
    const { tools } = await getMcp(site);
    for (const t of tools) {
      if (!ALLOWLIST[site].includes(t.name)) continue;
      out.push({
        name: `${site}__${t.name}`,
        description: `[OKX ${site === "tr" ? "TR" : "global"} · salt okunur] ${t.description ?? ""}`.slice(0, 1000),
        input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      });
    }
  }
  return out;
}

export function isAtkTool(name: string): boolean {
  const [site, tool] = name.split("__");
  return (site === "global" || site === "tr") && ALLOWLIST[site as Site]?.includes(tool ?? "");
}

/** Prefiksli ATK aracını doğru MCP sürecinde çalıştırır; sonucu kısaltır. */
export async function callAtkTool(name: string, args: Record<string, unknown>): Promise<{ text: string; trace: ToolTraceEntry }> {
  const [site, tool] = name.split("__") as [Site, string];
  const started = Date.now();
  try {
    const { client } = await getMcp(site);
    const res = await client.callTool({ name: tool, arguments: args });
    const content = res.content as Array<{ type: string; text?: string }>;
    let text = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    const ms = Date.now() - started;
    recordCall({ tool, via: "mcp", site, ms, ok: !res.isError });
    if (text.length > MAX_RESULT_CHARS) text = text.slice(0, MAX_RESULT_CHARS) + `\n…(${text.length - MAX_RESULT_CHARS} karakter kesildi)`;
    return { text, trace: { tool: name, args, ms, ok: !res.isError, summary: text.slice(0, 160) } };
  } catch (e) {
    const ms = Date.now() - started;
    recordCall({ tool, via: "mcp", site, ms, ok: false });
    const msg = `HATA: ${(e as Error).message}`;
    return { text: msg, trace: { tool: name, args, ms, ok: false, summary: msg.slice(0, 160) } };
  }
}

/** Bizim araçlarımız (MIMARI §7.2). */
export const OWN_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_open_markets",
    description: "KAHİN'de şu an açık (henüz çözülmemiş) marketleri listeler. Aynı soruyu tekrar açmamak için market önermeden önce çağır.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "propose_market",
    description:
      "Yeni bir tahmin marketi öner. Öneri deterministik bir politika katmanından geçer; reddedilirse sebepleri döner ve bir kez düzeltebilirsin. " +
      "Soru metnini sen yazmazsın; şablondan otomatik üretilir.",
    // strict kullanılmıyor: params şablona göre farklı alanlar alıyor. Girdi zod + policy ile doğrulanır.
    input_schema: {
      type: "object",
      properties: {
        templateId: { type: "integer", description: "1 = PRICE_ABOVE, 2 = FUNDING_POSITIVE" },
        params: {
          type: "object",
          description:
            'PRICE_ABOVE için {"site":"global"|"tr","instId":"BTC-USDT","threshold":"81800"}; ' +
            'FUNDING_POSITIVE için {"instId":"BTC-USDT-SWAP","fundingTime":<Unix saniye>}. threshold ondalık string.',
          properties: {
            site: { type: "string", enum: ["global", "tr"] },
            instId: { type: "string" },
            threshold: { type: "string" },
            fundingTime: { type: "integer" },
          },
          required: ["instId"],
        },
        closeInMinutes: { type: "integer", description: "Şu andan itibaren kaç dakika sonra tahminler kapanır (PRICE_ABOVE)." },
        resolveInMinutes: { type: "integer", description: "Şu andan itibaren kaç dakika sonra ölçüm yapılır (PRICE_ABOVE)." },
        myProbability: { type: "number", description: "Senin YES olasılık tahminin (0.15–0.85)." },
        rationale_tr: { type: "string", description: "Neden bu marketi açtığının Türkçe, sayılarla desteklenmiş kısa açıklaması (2–4 cümle)." },
        evidence_tools_used: { type: "array", items: { type: "string" }, description: "Gerekçede kullandığın ATK araç adları." },
      },
      required: ["templateId", "params", "closeInMinutes", "resolveInMinutes", "myProbability", "rationale_tr", "evidence_tools_used"],
      additionalProperties: false,
    },
  },
];
