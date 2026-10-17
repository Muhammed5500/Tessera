/**
 * "Rakip agent" — KAHİN'e DIŞARIDAN katılan bağımsız bir AI agent örneği (demo).
 * Kendi cüzdanı (RIVAL_PRIVATE_KEY) ve kendi analiziyle, yalnız MCP üzerinden:
 *   KAHİN Oracle MCP (marketleri gör, işlem hazırla) + kısıtlı cüzdan MCP (imzala/gönder) + OKX ATK (kendi analizi)
 * Beyin: yerel Claude Code (`claude -p`).
 *
 *   npm run rival -- [--market 2] [--max 10]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./args.js";

const { named } = parseArgs();
const here = dirname(fileURLToPath(import.meta.url));
const agentDir = resolve(here, "..");
const repo = resolve(agentDir, "..");
const workDir = resolve(agentDir, "data", "rival-cc");
mkdirSync(workDir, { recursive: true });

const tsx = join(agentDir, "node_modules", "tsx", "dist", "cli.mjs").replace(/\\/g, "/");
const deployments = join(repo, "deployments", "fuji.json").replace(/\\/g, "/");
const mcpPath = join(workDir, "mcp.json");
writeFileSync(
  mcpPath,
  JSON.stringify({
    mcpServers: {
      kahin_oracle: {
        command: "node",
        args: [tsx, join(agentDir, "scripts", "oracle-stdio.ts").replace(/\\/g, "/")],
        env: { DEPLOYMENTS_FILE: deployments, DATA_DIR: join(agentDir, "data").replace(/\\/g, "/") },
      },
      kahin_wallet: {
        command: "node",
        args: [tsx, join(agentDir, "scripts", "agent-wallet-mcp.ts").replace(/\\/g, "/")],
        env: {
          WALLET_DOTENV: join(agentDir, ".env").replace(/\\/g, "/"),
          WALLET_KEY_VAR: "RIVAL_PRIVATE_KEY",
          DEPLOYMENTS_FILE: deployments,
          WALLET_MAX_USDC: named.max ?? "10",
        },
      },
      okx_global: { command: "okx-trade-mcp", args: ["--site", "global", "--modules", "market"] },
    },
  }),
);

const SYSTEM = `Sen KAHİN'e dışarıdan katılan bağımsız bir trader agent'sın (KAHİN'in kendi agent'ı DEĞİLSİN).
Kendi cüzdanın var (kahin_wallet). KAHİN Oracle (kahin_oracle) üzerinden açık tahmin marketlerini görür, işlem hazırlarsın; OKX verisini (okx_global) kendi analizin için kullanırsın.

Görev:
1. wallet_info ile bakiyeni gör. kUSDC < 10 ise prepare_bet çıktısındaki "faucet" adımını send_prepared ile gönder (test kUSDC).
2. list_open_markets ile açık marketleri gör${named.market ? ` (market #${named.market} öncelikli)` : ""}; get_forecast ile KAHİN agent'ının tahminini oku.
3. OKX araçlarıyla (en fazla 2–3 çağrı) KENDİ görüşünü oluştur. KAHİN agent'ıyla aynı fikirde olmak zorunda değilsin.
4. Bir market ve taraf seç, 5–${named.max ?? "10"} kUSDC arası miktar belirle; prepare_bet → send_prepared ile gönder.
5. Son olarak kısa bir Türkçe özet yaz: hangi market, hangi taraf, ne kadar, neden (sayılarla), işlem hash'leri.
Kurallar: Yalnız test ağı ve test token'ı. Tavanı aşma. Market yoksa işlem yapma ve nedenini söyle.`;

const ALLOWED = [
  "mcp__kahin_oracle__list_open_markets",
  "mcp__kahin_oracle__get_forecast",
  "mcp__kahin_oracle__get_market",
  "mcp__kahin_oracle__prepare_bet",
  "mcp__kahin_oracle__get_position",
  "mcp__kahin_wallet__wallet_info",
  "mcp__kahin_wallet__send_prepared",
  "mcp__okx_global__market_get_ticker",
  "mcp__okx_global__market_get_candles",
  "mcp__okx_global__market_get_funding_rate",
  "mcp__okx_global__market_get_indicator",
];

const args = [
  "-p",
  "KAHİN'deki açık marketlere bak ve bir tahmin yap.",
  "--output-format",
  "stream-json",
  "--verbose",
  "--model",
  process.env.AGENT_MODEL ?? "claude-opus-5-5",
  "--system-prompt",
  SYSTEM,
  "--strict-mcp-config",
  "--mcp-config",
  mcpPath,
  "--tools",
  "",
  "--allowedTools",
  ALLOWED.join(","),
];

const started = Date.now();
const child = spawn("claude", args, { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === "system" && e.subtype === "init") {
        console.log(`[rakip] MCP: ${e.mcp_servers.map((s: { name: string; status: string }) => `${s.name}=${s.status}`).join(", ")}`);
      } else if (e.type === "assistant") {
        for (const c of e.message?.content ?? []) {
          if (c.type === "tool_use") console.log(`[rakip] → ${c.name.replace(/^mcp__/, "")} ${JSON.stringify(c.input).slice(0, 160)}`);
        }
      } else if (e.type === "user") {
        for (const c of e.message?.content ?? []) {
          if (c.type === "tool_result") {
            const t = typeof c.content === "string" ? c.content : JSON.stringify(c.content);
            console.log(`[rakip] ← ${c.is_error ? "HATA " : ""}${t.replace(/\s+/g, " ").slice(0, 220)}`);
          }
        }
      } else if (e.type === "result") {
        console.log(`\n[rakip] ÖZET (${Math.round((Date.now() - started) / 1000)} sn):\n${e.result}`);
      }
    } catch {
      /* JSON olmayan satır */
    }
  }
});
child.stderr.on("data", (d) => process.stderr.write(d));
child.on("close", (code) => process.exit(code ?? 0));
