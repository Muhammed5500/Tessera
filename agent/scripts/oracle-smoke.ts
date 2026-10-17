/**
 * KAHİN Oracle MCP duman testi (HTTP). Agent sunucusu çalışıyor olmalı.
 *   npm run oracle:smoke -- [--url http://localhost:8787/mcp] [--market 1]
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parseArgs } from "./args.js";

const { named } = parseArgs();
const url = named.url ?? "http://localhost:8787/mcp";
const marketId = Number(named.market ?? "1");

const client = new Client({ name: "kahin-oracle-smoke", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const started = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("");
  console.log(`\n▶ ${name} ${JSON.stringify(args)} · ${Date.now() - started} ms${r.isError ? " · HATA" : ""}`);
  return { text, isError: !!r.isError, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
};

const { tools } = await client.listTools();
console.log(`Araçlar (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);

const tpl = await call("list_templates");
console.log(`  ${tpl.json?.length} şablon`);

const gm = await call("get_market", { marketId });
console.log(`  ${gm.json?.question} · ${gm.json?.status} · önerilen ${gm.json?.proposedOutcome}`);

const rm = await call("resolve_metric", { marketId });
console.log(`  sonuç ${rm.json?.outcome} · hash ${rm.json?.evidenceHash}`);
console.log(`  zincirdeki hash ile eşleşiyor mu: ${rm.json?.matchesChain === true ? "✅ EVET" : `❌ ${rm.json?.matchesChain}`}`);

const funding = await call("resolve_metric", {
  templateId: 2,
  params: { instId: "BTC-USDT-SWAP", fundingTime: 1792224000 },
  resolveTime: 1792224120,
});
console.log(`  ${funding.json?.question} → ${funding.json?.outcome}`);

const open = await call("list_open_markets");
console.log(`  açık market: ${Array.isArray(open.json) ? open.json.length : open.text}`);

if (Array.isArray(open.json) && open.json.length) {
  const id = open.json[0].marketId;
  const pb = await call("prepare_bet", { marketId: id, side: "YES", amount: "5" });
  console.log(`  ${pb.json?.steps?.length} adım: ${pb.json?.steps?.map((s: { description: string }) => s.description).join(" → ")}`);
  const fc = await call("get_forecast", { marketId: id });
  console.log(`  agent tahmini: ${fc.json?.myProbability}`);
}

await client.close();
