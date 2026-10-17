"use client";

import { useState } from "react";
import { CodeBlock } from "@/components/ui";
import { AGENT_API, fetchEvidence } from "@/lib/agentApi";
import { hashCore } from "@/lib/canonical";
import { getAllMarkets, marketQuestion, type Market } from "@/lib/chain";
import { usePoll } from "@/lib/hooks";

const SECTIONS = [
  ["how", "How it works"],
  ["verify", "Verify a result"],
  ["mcp", "For AI agents (MCP)"],
] as const;

const TOOLS = [
  ["list_open_markets", "Open markets and live-grid squares: question, rule, kind (market | grid), price band, seconds to close, pools."],
  ["prepare_bet", "Unsigned approve + bet transactions. The service holds no keys; your agent signs with its own wallet."],
  ["get_position", "An address's stake, claimable payout and kUSDC balance in a market."],
  ["prepare_claim", "Unsigned claim transaction for a finalized market."],
  ["get_market", "A market with its evidence and verification status."],
  ["get_forecast", "The KAHİN agent's probability estimate for a market."],
  ["resolve_metric", "Resolve any supported question for a past time with OKX data and get the evidence hash."],
  ["list_templates", "Supported question templates and their rules."],
];

const EXAMPLE = `// 1. find a grid square closing in at least a minute
list_open_markets({ "kind": "grid", "minSecondsToClose": 60 })
→ [{ "marketId": 106, "kind": "grid", "band": { "low": "81500", "high": "81550" },
     "secondsToClose": 214, "impliedYes": 0.23, ... }]

// 2. get unsigned transactions, sign and send them with your own wallet
prepare_bet({ "marketId": 106, "side": "YES", "amount": "5" })
→ { "chainId": 43113, "steps": [ { "to": "0xC891…", "data": "0x095e…" },   // approve
                                 { "to": "0x3Bf7…", "data": "0x…" } ] }    // bet`;

function Verify() {
  const markets = usePoll(getAllMarkets, 30_000);
  const [res, setRes] = useState<{ m: Market; local: string; match: boolean } | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const resolved = (markets.data ?? []).filter((m) => m.status >= 1).sort((a, b) => Number(b.id - a.id));

  async function run(id: string) {
    const m = resolved.find((x) => x.id.toString() === id);
    setRes(null);
    if (!m) return;
    setState("loading");
    const ev = await fetchEvidence(m.id, m.evidenceURI);
    if (!ev) return setState("error");
    const local = hashCore(ev.core);
    setRes({ m, local, match: local.toLowerCase() === m.evidenceHash.toLowerCase() });
    setState("idle");
  }

  return (
    <div className="card space-y-4 p-5">
      <select className="field" defaultValue="" onChange={(e) => run(e.target.value)}>
        <option value="">{markets.data ? `Pick one of ${resolved.length} resolved markets…` : "Loading…"}</option>
        {resolved.map((m) => (
          <option key={m.id.toString()} value={m.id.toString()}>
            #{m.id.toString()} · {marketQuestion(m)}
          </option>
        ))}
      </select>
      {state === "loading" && <div className="h-12 animate-pulse rounded-lg bg-panel-2" />}
      {state === "error" && <div className="text-sm text-muted">The evidence file isn&apos;t reachable right now. Use the command below instead.</div>}
      {res && (
        <div className="space-y-3">
          <div className={`flex items-center gap-2 text-sm font-medium ${res.match ? "text-yes" : "text-no"}`}>
            <span className={`h-2 w-2 rounded-full ${res.match ? "bg-yes" : "bg-no"}`} />
            {res.match ? "Evidence matches the on-chain hash" : "Evidence does not match the on-chain hash"}
          </div>
          <div className="mono grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-xs text-muted">
            <span>chain</span>
            <span className="break-all">{res.m.evidenceHash}</span>
            <span>browser</span>
            <span className="break-all">{res.local}</span>
          </div>
        </div>
      )}
      <CodeBlock label="recompute from OKX data">{`cd agent && npm run verify -- ${res?.m.id ?? "<market-id>"}`}</CodeBlock>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="grid gap-10 lg:grid-cols-[180px_minmax(0,1fr)]">
      <nav className="hidden lg:block">
        <div className="sticky top-20 space-y-1 text-sm">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block rounded-md px-2 py-1.5 text-muted hover:bg-panel hover:text-text">
              {label}
            </a>
          ))}
        </div>
      </nav>

      <div className="min-w-0 max-w-3xl space-y-14">
        <section id="how" className="scroll-mt-24">
          <h1 className="text-3xl font-semibold tracking-tight">Docs</h1>
          <h2 className="mt-8 text-xl font-semibold">How it works</h2>
          <ol className="mt-4 space-y-3 text-[15px] leading-relaxed text-[#c9d1dc]">
            <li>
              <span className="font-medium text-text">1. An agent opens markets.</span> It reads market data through the OKX Agent
              Trade Kit and lists short-term crypto questions, plus a live BTC grid every 3 minutes.
            </li>
            <li>
              <span className="font-medium text-text">2. Anyone trades.</span> People with a wallet, or AI agents over MCP, buy Yes or
              No on Avalanche Fuji. Pools are parimutuel: winners split the pool minus a 1% fee.
            </li>
            <li>
              <span className="font-medium text-text">3. The result is computed, not decided.</span> At measurement time the agent
              fetches the closed OKX candle (or funding rate), applies the market&apos;s fixed rule — no AI involved — and posts the
              outcome with a hash of its evidence.
            </li>
            <li>
              <span className="font-medium text-text">4. Anyone can challenge it.</span> There is a 5-minute dispute window before the
              result is final and payouts open.
            </li>
          </ol>
        </section>

        <section id="verify" className="scroll-mt-24">
          <h2 className="text-xl font-semibold">Verify a result</h2>
          <p className="mt-2 text-[15px] text-muted">
            Your browser hashes the evidence file and compares it with the hash on chain. The command re-fetches the OKX data and
            reproduces the same hash.
          </p>
          <div className="mt-4">
            <Verify />
          </div>
        </section>

        <section id="mcp" className="scroll-mt-24">
          <h2 className="text-xl font-semibold">For AI agents (MCP)</h2>
          <p className="mt-2 text-[15px] text-muted">
            Agents trade the same markets as people. Connect any MCP client; the server is read-only and never holds keys.
          </p>
          <div className="mt-4 space-y-3">
            <CodeBlock label="Streamable HTTP">{`${AGENT_API}/mcp`}</CodeBlock>
            <CodeBlock label="Claude Code (stdio)">{`claude mcp add --transport stdio kahin -- npm --prefix <repo>/agent run -s oracle:stdio`}</CodeBlock>
          </div>

          <div className="card mt-6 overflow-hidden">
            <ul className="divide-y divide-line">
              {TOOLS.map(([name, desc]) => (
                <li key={name} className="grid gap-1 px-5 py-3 sm:grid-cols-[170px_1fr] sm:gap-4">
                  <span className="mono text-sm">{name}</span>
                  <span className="text-sm text-muted">{desc}</span>
                </li>
              ))}
            </ul>
          </div>

          <h3 className="mt-8 text-[15px] font-medium">Example: bet on a grid square</h3>
          <div className="mt-3">
            <CodeBlock label="MCP calls">{EXAMPLE}</CodeBlock>
          </div>
          <p className="mt-3 text-sm text-muted">
            Network: Avalanche Fuji (chain id 43113). Test kUSDC comes from the faucet step returned by <span className="mono">prepare_bet</span>.
          </p>
        </section>
      </div>
    </div>
  );
}
