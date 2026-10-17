"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CodeBlock } from "@/components/ui";
import { fetchEvidence } from "@/lib/agentApi";
import { hashCore } from "@/lib/canonical";
import { addrUrl, getAllMarkets, marketQuestion, PM_ADDRESS, USDC_ADDRESS, type Market } from "@/lib/chain";
import { usePoll } from "@/lib/hooks";

const REPO = "https://github.com/Muhammed5500/Kahin";
const FAUCET = "https://core.app/tools/testnet-faucet/?subnet=c&token=c";

const SECTIONS = [
  ["overview", "Overview"],
  ["how", "How it works"],
  ["grid", "Markets & the live grid"],
  ["resolution", "Resolution & verification"],
  ["agents", "Connect your AI agent"],
  ["tools", "Tool reference"],
  ["safety", "Wallet safety"],
  ["network", "Network & contracts"],
  ["faq", "FAQ"],
] as const;

/* ---------- küçük yapı taşları ---------- */

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-2xl font-semibold tracking-tight">
      {children}
    </h2>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[15px] leading-relaxed text-[#c9d1dc]">{children}</p>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="mono rounded bg-panel-2 px-1.5 py-0.5 text-[13px] text-text">{children}</code>;
}

function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-text underline decoration-line underline-offset-4 hover:decoration-text">
      {children}
    </a>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="relative pl-12">
      <span className="tabular absolute left-0 top-0 grid h-8 w-8 place-items-center rounded-full border border-line bg-panel text-sm font-semibold">
        {n}
      </span>
      <h3 className="pt-1 text-[17px] font-semibold">{title}</h3>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-[#c9d1dc]">{children}</div>
    </li>
  );
}

function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${
        tone === "warn" ? "border-warn/40 bg-warn/5 text-[#e8d6a8]" : "border-info/30 bg-info/5 text-[#c9d1dc]"
      }`}
    >
      {children}
    </div>
  );
}

/* ---------- içerik ---------- */

const ORACLE_TOOLS: [string, string, string][] = [
  ["list_open_markets", "kind?: all | market | grid · minSecondsToClose?", "Every market still open for trading: question, rule, kind, band (grid), closeTime, secondsToClose, pools, implied probability."],
  ["prepare_bet", "marketId, side: YES | NO, amount (kUSDC), from?", "Unsigned approve + bet transactions, plus a faucet step for test kUSDC. Nothing is sent."],
  ["get_position", "marketId, address", "Your Yes/No stake, claimable payout, whether you already claimed, and your kUSDC balance."],
  ["prepare_claim", "marketId, address?", "Unsigned claim transaction for a resolved market."],
  ["get_market", "marketId", "One market with status, outcome, evidence hash and verification details."],
  ["get_forecast", "marketId", "The KAHİN agent's own probability estimate for a market (when available)."],
  ["resolve_metric", "marketId | (templateId, params, resolveTime)", "Recomputes a result for a past time from OKX data and returns the evidence and its hash. Requires the OKX CLI."],
  ["list_templates", "—", "The question types KAHİN supports and their exact rules."],
];

const WALLET_TOOLS: [string, string, string][] = [
  ["wallet_info", "—", "Your agent wallet's address, Fuji AVAX and kUSDC balance, and the per-trade cap."],
  ["send_prepared", "steps: [{ to, data }]", "Signs and sends the steps returned by prepare_bet / prepare_claim (or the faucet step), one after another, and returns the transaction hashes."],
];

function ToolTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="card mt-4 overflow-hidden">
      <ul className="divide-y divide-line">
        {rows.map(([name, input, desc]) => (
          <li key={name} className="grid gap-1.5 px-5 py-3.5 md:grid-cols-[170px_1fr] md:gap-5">
            <span className="mono text-sm font-medium">{name}</span>
            <div>
              <div className="mono text-xs text-muted">{input}</div>
              <div className="mt-1 text-sm text-[#c9d1dc]">{desc}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CLAUDE_CODE = `# from anywhere — replace /path/to/Kahin with where you cloned it
claude mcp add kahin -- npm --prefix /path/to/Kahin/agent run -s oracle:stdio

claude mcp add kahin-wallet \\
  -e WALLET_DOTENV=/path/to/kahin-wallet.env \\
  -e WALLET_KEY_VAR=WALLET_PRIVATE_KEY \\
  -e WALLET_MAX_USDC=20 \\
  -- npm --prefix /path/to/Kahin/agent run -s wallet:stdio`;

const JSON_CONFIG = `{
  "mcpServers": {
    "kahin": {
      "command": "npm",
      "args": ["--prefix", "/path/to/Kahin/agent", "run", "-s", "oracle:stdio"]
    },
    "kahin-wallet": {
      "command": "npm",
      "args": ["--prefix", "/path/to/Kahin/agent", "run", "-s", "wallet:stdio"],
      "env": {
        "WALLET_DOTENV": "/path/to/kahin-wallet.env",
        "WALLET_KEY_VAR": "WALLET_PRIVATE_KEY",
        "WALLET_MAX_USDC": "20"
      }
    }
  }
}`;

const PROMPT = `Use the kahin and kahin-wallet tools.
1. Check my wallet with wallet_info. If kUSDC is below 10, send the faucet step from prepare_bet.
2. List open grid squares closing in at least 60 seconds.
3. Look at the current BTC price and pick the square you think it will close in.
4. Buy 5 kUSDC of YES on it: prepare_bet, then send_prepared.
5. Tell me the market id, the band and the transaction hashes.`;

const SESSION = `→ wallet_info()
← { "address": "0x175E…2DF6", "avax": "0.049", "kUSDC": "995", "maxPerTx": 10 }

→ list_open_markets({ "kind": "grid", "minSecondsToClose": 60 })
← [{ "marketId": 106, "kind": "grid", "question": "…",
     "band": { "low": "81500", "high": "81550" },
     "secondsToClose": 214, "impliedYes": 0.23, "pools": { "yes": "2.3", "no": "7.7" } }, …]

→ prepare_bet({ "marketId": 106, "side": "YES", "amount": "5" })
← { "chainId": 43113,
    "steps": [ { "description": "approve 5 kUSDC", "to": "0xC891…5Aa4", "data": "0x095e…" },
               { "description": "bet #106 YES 5",  "to": "0x3Bf7…4336", "data": "0x…" } ],
    "faucet": { "to": "0xC891…5Aa4", "data": "0xde5f72fd" } }

→ send_prepared({ "steps": [ …the two steps above… ] })
← { "results": [ { "hash": "0x0742…b769", "status": "success" },
                 { "hash": "0x131c…a8c7", "status": "success" } ] }`;

const WALLET_ENV = `# kahin-wallet.env — keep this file OUTSIDE the repo and never share it
WALLET_PRIVATE_KEY=0xyour_test_wallet_private_key`;

const GEN_KEY = `# run inside Kahin/agent after npm install — prints a brand-new test key
node -e "const a=require('viem/accounts');const k=a.generatePrivateKey();console.log(k, a.privateKeyToAccount(k).address)"`;

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
    <div className="card mt-4 space-y-4 p-5">
      <select className="field" defaultValue="" onChange={(e) => run(e.target.value)}>
        <option value="">{markets.data ? `Pick one of ${resolved.length} resolved markets…` : "Loading…"}</option>
        {resolved.map((m) => (
          <option key={m.id.toString()} value={m.id.toString()}>
            #{m.id.toString()} · {marketQuestion(m)}
          </option>
        ))}
      </select>
      {state === "loading" && <div className="h-12 animate-pulse rounded-lg bg-panel-2" />}
      {state === "error" && (
        <div className="text-sm text-muted">
          The evidence file is served by the KAHİN agent and isn&apos;t reachable from here right now. The on-chain hash is still valid — use the
          command below.
        </div>
      )}
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
      <CodeBlock label="recompute from OKX data (needs the OKX CLI)">{`cd Kahin/agent && npm run verify -- ${res?.m.id ?? "<market-id>"}`}</CodeBlock>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="grid gap-12 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav className="hidden lg:block">
        <div className="sticky top-20 space-y-0.5 text-sm">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block rounded-md px-2.5 py-1.5 text-muted hover:bg-panel hover:text-text">
              {label}
            </a>
          ))}
        </div>
      </nav>

      <article className="min-w-0 max-w-3xl space-y-16 pb-10">
        {/* OVERVIEW */}
        <section>
          <h1 id="overview" className="scroll-mt-24 text-4xl font-semibold tracking-tight">
            Docs
          </h1>
          <P>
            KAHİN is a prediction market for short-term crypto questions — &quot;Will BTC be above $81,500 at 17:26?&quot;, &quot;Will
            ETH funding be positive at 19:00?&quot; — plus a live BTC grid that opens new questions every three minutes. An agent creates
            the markets and settles them with data from the <span className="text-text">OKX Agent Trade Kit</span>; every result is
            written to <span className="text-text">Avalanche</span> together with a fingerprint of its evidence, so anyone can check it.
          </P>
          <P>
            You can trade in two ways: with your own wallet on this site, or by connecting your own AI agent over{" "}
            <span className="text-text">MCP</span> (Model Context Protocol) and letting it trade for you. Both land in the same markets.
          </P>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/" className="btn btn-accent">
              Browse markets
            </Link>
            <a href="#agents" className="btn btn-ghost">
              Connect an agent →
            </a>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section>
          <H2 id="how">How it works</H2>
          <ol className="mt-5 space-y-5">
            <Step n={1} title="An agent opens markets">
              <p>
                The KAHİN agent reads market data through the OKX Agent Trade Kit and lists questions with a fixed rule and a fixed
                measurement time. It also runs the live grid: a new column of BTC price ranges every 3 minutes.
              </p>
            </Step>
            <Step n={2} title="People and agents trade">
              <p>
                Buy <span className="text-yes">Yes</span> or <span className="text-no">No</span> with test kUSDC on Avalanche Fuji. Markets
                are parimutuel: everyone who picked the winning side splits the whole pool in proportion to their stake, minus a 1% fee.
                The price you see (e.g. 47¢) is the current share of the pool on that side.
              </p>
            </Step>
            <Step n={3} title="Trading closes, the result is computed">
              <p>
                At the measurement time the agent fetches the closed OKX 1-minute candle (or the realized funding rate), applies the
                rule — no AI involved — and posts the outcome on chain with the hash of its evidence.
              </p>
            </Step>
            <Step n={4} title="5-minute dispute window, then payouts">
              <p>
                Anyone who thinks the result is wrong can dispute it with a bond. If nobody does, the result becomes final and winners
                can claim.
              </p>
            </Step>
          </ol>
        </section>

        {/* GRID */}
        <section>
          <H2 id="grid">Markets &amp; the live grid</H2>
          <P>There are three question types:</P>
          <div className="card mt-4 overflow-hidden text-sm">
            <div className="grid grid-cols-[150px_1fr] gap-4 border-b border-line px-5 py-3">
              <span className="font-medium">Price above</span>
              <span className="text-[#c9d1dc]">&quot;BTC above $81,500 on Oct 17, 17:26?&quot; — Yes if the OKX 1-minute close at that minute is above the threshold.</span>
            </div>
            <div className="grid grid-cols-[150px_1fr] gap-4 border-b border-line px-5 py-3">
              <span className="font-medium">Funding positive</span>
              <span className="text-[#c9d1dc]">&quot;ETH perp funding positive on Oct 17, 19:00?&quot; — Yes if the realized funding rate at that payment is above zero.</span>
            </div>
            <div className="grid grid-cols-[150px_1fr] gap-4 px-5 py-3">
              <span className="font-medium">Price range (grid)</span>
              <span className="text-[#c9d1dc]">&quot;BTC between $81,500 and $81,550 on 17:03?&quot; — Yes if the close lands inside the range.</span>
            </div>
          </div>
          <P>
            On the <Link href="/grid" className="text-text underline decoration-line underline-offset-4">live grid</Link> every square is
            one of these range markets. Each column has five $50 ranges around the price plus two open-ended squares at the edges
            (&quot;below $81,350&quot; ↓ and &quot;$81,600 or above&quot; ↑), so every possible price falls into exactly one square.
          </P>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] text-[#c9d1dc]">
            <li>Columns are 3 minutes apart and open about 15 minutes ahead.</li>
            <li>
              A square <span className="text-text">locks 2 minutes before</span> its close, so nobody can buy a square whose result is already
              obvious.
            </li>
            <li>The multiplier on a square (e.g. 3.2x) is what each kUSDC returns if that square wins, at the current pool.</li>
          </ul>
        </section>

        {/* RESOLUTION */}
        <section>
          <H2 id="resolution">Resolution &amp; verification</H2>
          <P>
            Results are never decided by a person or a language model. The agent applies the market&apos;s rule to closed OKX data,
            cross-checks the price against a second source (the OKX index price — if they differ by more than 0.5% the market resolves
            Void and everyone is refunded), and writes a JSON evidence file. The keccak256 hash of that file goes on chain with the
            result.
          </P>
          <P>Pick a resolved market to compare the evidence file with the hash on chain, right in your browser:</P>
          <Verify />
        </section>

        {/* AGENTS */}
        <section>
          <H2 id="agents">Connect your AI agent</H2>
          <P>
            Any MCP-capable agent — Claude Code, Claude Desktop, Cursor or your own MCP client — can trade KAHİN markets. You run two small
            MCP servers on your own machine:
          </P>
          <ul className="mt-3 space-y-2 text-[15px] text-[#c9d1dc]">
            <li>
              <span className="mono text-text">kahin</span> — reads markets straight from Avalanche and prepares{" "}
              <span className="text-text">unsigned</span> transactions. It holds no keys.
            </li>
            <li>
              <span className="mono text-text">kahin-wallet</span> — signs those transactions with <span className="text-text">your</span>{" "}
              test wallet. It only ever signs KAHİN trades, up to a cap you set.
            </li>
          </ul>
          <P>Your trades show up on this site the moment they confirm — in the pools, the odds and the market&apos;s Activity tab.</P>

          <ol className="mt-8 space-y-10">
            <Step n={1} title="Requirements">
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <A href="https://nodejs.org">Node.js</A> 20 or newer and <A href="https://git-scm.com">git</A>
                </li>
                <li>An MCP-capable agent (examples below use Claude Code)</li>
                <li>A new, empty test wallet — never use a wallet that holds real funds</li>
              </ul>
            </Step>

            <Step n={2} title="Get the code">
              <CodeBlock label="terminal">{`git clone ${REPO}.git\ncd Kahin/agent\nnpm install`}</CodeBlock>
              <p className="text-sm text-muted">
                No configuration file is needed for trading — contract addresses ship with the repo in{" "}
                <Code>deployments/fuji.json</Code>.
              </p>
            </Step>

            <Step n={3} title="Create a test wallet for your agent">
              <p>Generate a fresh key (or export one from MetaMask from a new, empty account):</p>
              <CodeBlock label="terminal">{GEN_KEY}</CodeBlock>
              <p>
                Save it in a file <span className="text-text">outside the repo</span>, for example <Code>~/kahin-wallet.env</Code>:
              </p>
              <CodeBlock label="kahin-wallet.env">{WALLET_ENV}</CodeBlock>
              <Note tone="warn">
                The key never goes into your MCP config or your prompt — the wallet server reads it from this file. Don&apos;t commit or share
                the file.
              </Note>
            </Step>

            <Step n={4} title="Fund it with test AVAX (for gas)">
              <p>
                Paste the wallet address into the <A href={FAUCET}>Avalanche Fuji faucet</A> and request C-Chain AVAX. 0.05 AVAX covers
                hundreds of trades. Test kUSDC needs no faucet site: your agent can claim 1,000 kUSDC per hour through the{" "}
                <Code>faucet</Code> step that <Code>prepare_bet</Code> returns.
              </p>
            </Step>

            <Step n={5} title="Add the two MCP servers">
              <p>
                <span className="font-medium text-text">Claude Code</span> — replace the paths with yours (on Windows use forward slashes,
                e.g. <Code>C:/Users/you/Kahin/agent</Code>):
              </p>
              <CodeBlock label="terminal">{CLAUDE_CODE}</CodeBlock>
              <p>
                <span className="font-medium text-text">Claude Desktop, Cursor and other clients</span> — add this to the client&apos;s MCP
                config (e.g. <Code>claude_desktop_config.json</Code> or <Code>.cursor/mcp.json</Code>):
              </p>
              <CodeBlock label="mcp config (JSON)">{JSON_CONFIG}</CodeBlock>
              <p className="text-sm text-muted">
                <Code>WALLET_MAX_USDC</Code> is the most your agent can stake or approve in a single transaction.
              </p>
            </Step>

            <Step n={6} title="Let your agent trade">
              <p>Restart your agent so it loads the tools, then ask it in plain language, for example:</p>
              <CodeBlock label="prompt">{PROMPT}</CodeBlock>
              <p>Under the hood it will make calls like these (a real session from Oct 17):</p>
              <CodeBlock label="MCP calls">{SESSION}</CodeBlock>
              <p>
                Open the market on this site to see the trade in its Activity tab. Prefer to stay in control? Skip{" "}
                <Code>kahin-wallet</Code> and sign the steps from <Code>prepare_bet</Code> with any wallet or library you like.
              </p>
            </Step>

            <Step n={7} title="Collect winnings">
              <p>
                After the market is final, <Code>get_position</Code> shows what you can claim. <Code>prepare_claim</Code> followed by{" "}
                <Code>send_prepared</Code> pays it out. Squares resolve about 7–8 minutes after their close (1–2 min to compute + 5 min
                dispute window).
              </p>
            </Step>
          </ol>
        </section>

        {/* TOOLS */}
        <section>
          <H2 id="tools">Tool reference</H2>
          <h3 className="mt-6 text-[17px] font-semibold">
            <span className="mono">kahin</span> — markets (read-only)
          </h3>
          <ToolTable rows={ORACLE_TOOLS} />
          <h3 className="mt-8 text-[17px] font-semibold">
            <span className="mono">kahin-wallet</span> — your signer
          </h3>
          <ToolTable rows={WALLET_TOOLS} />
          <div className="mt-6 space-y-2 text-sm text-[#c9d1dc]">
            <p>
              <span className="font-medium text-text">Grid squares</span> have <Code>kind: &quot;grid&quot;</Code> and a{" "}
              <Code>band</Code> of <Code>[low, high)</Code> in USD. Edge squares are open-ended: <Code>low: null</Code> means &quot;below
              high&quot;, <Code>high: null</Code> means &quot;low or above&quot;.
            </p>
            <p>
              <span className="font-medium text-text">Timing:</span> use <Code>minSecondsToClose</Code> (60 is a good default) so your
              agent doesn&apos;t pick a square that locks before its transaction lands.
            </p>
          </div>
        </section>

        {/* SAFETY */}
        <section>
          <H2 id="safety">Wallet safety</H2>
          <P>The wallet server checks every transaction before signing and refuses anything else:</P>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] text-[#c9d1dc]">
            <li>
              Only two contracts: the KAHİN market contract and kUSDC (addresses below).
            </li>
            <li>Only four actions: kUSDC faucet, approve to the KAHİN contract, bet, claim.</li>
            <li>Approve and bet amounts are capped by <Code>WALLET_MAX_USDC</Code>.</li>
            <li>The private key is read from your file, never from the MCP config or the model&apos;s input.</li>
          </ul>
          <div className="mt-4">
            <Note>Everything runs on the Avalanche Fuji testnet with test tokens. There is no real money involved.</Note>
          </div>
        </section>

        {/* NETWORK */}
        <section>
          <H2 id="network">Network &amp; contracts</H2>
          <div className="card mt-4 divide-y divide-line text-sm">
            {(
              [
                ["Network", "Avalanche Fuji C-Chain (testnet)"],
                ["Chain ID", "43113"],
                ["RPC", "https://avalanche-fuji-c-chain-rpc.publicnode.com"],
                ["Explorer", "https://testnet.snowtrace.io"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[140px_1fr] gap-4 px-5 py-3">
                <span className="text-muted">{k}</span>
                <span className="mono break-all">{v}</span>
              </div>
            ))}
            {(
              [
                ["PredictionMarket", PM_ADDRESS],
                ["kUSDC (test token)", USDC_ADDRESS],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[140px_1fr] gap-4 px-5 py-3">
                <span className="text-muted">{k}</span>
                <a className="mono break-all hover:text-accent" href={addrUrl(v)} target="_blank" rel="noreferrer">
                  {v} ↗
                </a>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted">
            Source code: <A href={REPO}>{REPO.replace("https://", "")}</A>
          </p>
        </section>

        {/* FAQ */}
        <section>
          <H2 id="faq">FAQ</H2>
          <div className="mt-4 divide-y divide-line">
            {(
              [
                [
                  "Do I need an OKX account or API key?",
                  "No. Trading only needs a test wallet. OKX data is used by the KAHİN agent to create and resolve markets.",
                ],
                [
                  "Why did my agent's transaction fail with “exceeds the balance”?",
                  "The wallet has no Fuji AVAX for gas. Use the faucet in step 4.",
                ],
                [
                  "Why was my bet rejected with BettingClosed?",
                  "The market (or grid square) locked before the transaction landed. Ask for minSecondsToClose of 60 or more.",
                ],
                [
                  "Can my agent sell or cancel a position?",
                  "No — positions are held until the market resolves. That keeps the pool and the payout math simple.",
                ],
                [
                  "Who can create markets?",
                  "Only the KAHİN agent. Anyone — person or agent — can trade, dispute and claim.",
                ],
              ] as const
            ).map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
                  {q}
                  <span className="text-muted transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-[15px] leading-relaxed text-[#c9d1dc]">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </article>
    </div>
  );
}
