import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { recordCall } from "../atk/counter.js";
import { config } from "../config.js";
import { POLICY } from "../policy/index.js";
import type { ToolTraceEntry } from "./tools.js";

/**
 * Scout "beyni" — yerel Claude Code (`claude -p`, kullanıcının aboneliği) üzerinden.
 * API anahtarı yokken kullanılır. ATK MCP sunucuları Claude Code'a araç olarak verilir;
 * yerleşik araçlar (Bash, dosya yazma vb.) kapalıdır, yalnız allowlist'teki OKUMA araçları çalışır.
 * Model kararını `--json-schema` ile yapılandırılmış çıktı olarak döndürür; zincire yazma yine
 * Policy onayından sonra deterministik koddan yapılır.
 */

const SERVERS = { okx_global: "global", okx_tr: "tr" } as const;

const ALLOWED_TOOLS = [
  "mcp__okx_global__market_get_ticker",
  "mcp__okx_global__market_get_candles",
  "mcp__okx_global__market_get_funding_rate",
  "mcp__okx_global__market_get_oi_history",
  "mcp__okx_global__market_filter_oi_change",
  "mcp__okx_global__market_get_indicator",
  "mcp__okx_global__market_get_mark_price",
  "mcp__okx_tr__market_get_ticker",
  "mcp__okx_tr__market_get_candles",
  "mcp__okx_tr__market_get_orderbook",
];

const TIMEOUT_MS = 6 * 60_000;

export const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["propose", "none"] },
    reason_tr: { type: "string", description: "action=none ise neden market önermediğin (Türkçe, 1–2 cümle)" },
    proposal: {
      type: "object",
      properties: {
        templateId: { type: "integer" },
        params: {
          type: "object",
          properties: {
            site: { type: "string", enum: ["global", "tr"] },
            instId: { type: "string" },
            threshold: { type: "string" },
            fundingTime: { type: "integer" },
          },
          required: ["instId"],
        },
        closeInMinutes: { type: "integer" },
        resolveInMinutes: { type: "integer" },
        myProbability: { type: "number" },
        rationale_tr: { type: "string" },
        evidence_tools_used: { type: "array", items: { type: "string" } },
      },
      required: ["templateId", "params", "closeInMinutes", "resolveInMinutes", "myProbability", "rationale_tr", "evidence_tools_used"],
    },
  },
  required: ["action"],
};

export type Decision = {
  action: "propose" | "none";
  reason_tr?: string;
  proposal?: Record<string, unknown>;
};

export type CcRun = {
  decision: Decision | null;
  sessionId?: string;
  trace: ToolTraceEntry[];
  costUsd?: number;
  error?: string;
};

export const SCOUT_SYSTEM_CC = `Sen KAHİN'in piyasa analistisin. KAHİN, Avalanche üzerinde çalışan kısa vadeli bir kripto olasılık (tahmin) piyasasıdır.
Görevin: OKX verisini OKX Agent Trade Kit (ATK) MCP araçlarıyla (mcp__okx_global__*, mcp__okx_tr__*) inceleyip, şu an sorulmaya değer, ölçülebilir ve ilginç BİR market önermek — ya da uygun market yoksa bunu söylemek.
Kararını yapılandırılmış çıktı olarak ver: {"action":"propose","proposal":{...}} veya {"action":"none","reason_tr":"..."}.

## Şablonlar (yalnız bunlar)
1. PRICE_ABOVE — "<enstrüman> <zaman>'da <eşik> üstünde mi?"
   params: {"site":"global"|"tr","instId":"<spot>","threshold":"<ondalık string>"}
   Çözüm: ölçüm anında biten 1 dakikalık mumun kapanışı > eşik ise EVET.
   İzinli spot: ${POLICY.spotInstruments.join(", ")}. TRY pariteleri site "tr" ile.
   closeInMinutes / resolveInMinutes: şu andan itibaren dakika. Süre ${POLICY.minDurationMin}–${POLICY.maxDurationMin} dk; ölçüm kapanıştan ${POLICY.minCloseGapMin}–${POLICY.maxCloseGapMin} dk sonra.
   Eşik son fiyatın en fazla ±%3 uzağında.
2. FUNDING_POSITIVE — "<perp> funding oranı <ödeme zamanı>'nda pozitif mi?"
   params: {"instId":"<perp>","fundingTime":<Unix SANİYE>}
   İzinli perp: ${POLICY.perpInstruments.join(", ")}. Ödemeler 00:00/08:00/16:00 UTC. fundingTime'ı market_get_funding_rate yanıtındaki fundingTime'dan al (ms → saniye). closeInMinutes/resolveInMinutes için 0 gönder.
   Mevcut dönem oranı canlı görünür; oran sıfırdan uzaksa sonuç bellidir — yalnız |oran| < 0.00005 iken kullan.

## Kurallar
- Karar vermeden önce en az 2 FARKLI ATK aracından veri topla; gerekçede gerçek sayıları kullan.
- evidence_tools_used'a kullandığın araçların tam adlarını yaz (ör. mcp__okx_global__market_get_funding_rate).
- İlginç market = sonucu belirsiz. myProbability (senin EVET olasılığın) 0.15–0.85.
- Kullanıcı mesajındaki açık marketlerle aynı/benzer market önerme.
- Yatırım tavsiyesi verme; "al/sat" deme. Sen soru soruyorsun.
- Araçları verimli kullan (toplam 3–6 çağrı yeterli).
- rationale_tr Türkçe, 2–4 cümle, sayılarla.`;

function mcpConfigPath(): string {
  const dir = resolve(config.DATA_DIR, "scout-cc");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "mcp.json");
  writeFileSync(
    path,
    JSON.stringify({
      mcpServers: {
        okx_global: { command: "okx-trade-mcp", args: ["--site", "global", "--modules", "market"] },
        okx_tr: { command: "okx-trade-mcp", args: ["--site", "tr", "--modules", "market"] },
      },
    }),
  );
  return path;
}

/** `claude -p` çalıştırır, stream-json olaylarından araç izini ve yapılandırılmış kararı çıkarır. */
export function runClaudeCode(prompt: string, resumeSessionId?: string): Promise<CcRun> {
  const cwd = resolve(config.DATA_DIR, "scout-cc"); // repo CLAUDE.md'si yüklenmesin
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    config.AGENT_MODEL,
    "--system-prompt",
    SCOUT_SYSTEM_CC,
    "--strict-mcp-config",
    "--mcp-config",
    mcpConfigPath(),
    "--tools",
    "",
    "--allowedTools",
    ALLOWED_TOOLS.join(","),
    "--json-schema",
    JSON.stringify(DECISION_SCHEMA),
    ...(resumeSessionId ? ["--resume", resumeSessionId] : []),
  ];

  return new Promise((resolvePromise) => {
    const child = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const trace: ToolTraceEntry[] = [];
    const pending = new Map<string, { tool: string; args: unknown; started: number }>();
    let buf = "";
    let stderr = "";
    let result: CcRun = { decision: null, trace };

    const timer = setTimeout(() => {
      child.kill();
      resolvePromise({ ...result, error: `claude -p zaman aşımı (${TIMEOUT_MS / 1000} sn)` });
    }, TIMEOUT_MS);

    const onEvent = (e: any) => {
      if (e.type === "assistant") {
        for (const c of e.message?.content ?? []) {
          if (c.type === "tool_use" && c.name !== "StructuredOutput") {
            pending.set(c.id, { tool: c.name, args: c.input, started: Date.now() });
          }
        }
      } else if (e.type === "user") {
        for (const c of e.message?.content ?? []) {
          if (c.type !== "tool_result") continue;
          const p = pending.get(c.tool_use_id);
          if (!p) continue;
          pending.delete(c.tool_use_id);
          const text = typeof c.content === "string" ? c.content : JSON.stringify(c.content);
          const ok = !c.is_error;
          const ms = Date.now() - p.started;
          trace.push({ tool: p.tool, args: p.args, ms, ok, summary: text.slice(0, 160) });
          const [, server, tool] = p.tool.split("__");
          const site = SERVERS[server as keyof typeof SERVERS];
          if (site && tool) recordCall({ tool, via: "mcp", site, ms, ok });
        }
      } else if (e.type === "result") {
        result = {
          decision: (e.structured_output as Decision) ?? null,
          sessionId: e.session_id,
          trace,
          costUsd: e.total_cost_usd,
          error: e.is_error ? String(e.result ?? "claude -p hata") : undefined,
        };
      }
    };

    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line));
        } catch {
          /* JSON olmayan satır */
        }
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({ decision: null, trace, error: `claude çalıştırılamadı: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!result.decision && !result.error) {
        result.error = `claude -p çıkış kodu ${code}: ${stderr.trim().slice(0, 300)}`;
      }
      resolvePromise(result);
    });
  });
}
