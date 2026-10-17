import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { encodeFunctionData, getAddress, parseUnits } from "viem";
import { z } from "zod";
import { realAtk } from "../atk/index.js";
import { config } from "../config.js";
import { mockUsdcAbi, predictionMarketAbi } from "../chain/abi.js";
import { loadDeployment } from "../chain/client.js";
import { getAllMarkets, getMarket, readParams, Status } from "../chain/markets.js";
import { buildEvidence } from "../evidence/build.js";
import { loadEvidence } from "../evidence/store.js";
import { loadMeta } from "../feed/store.js";
import { isAligned, nowSec } from "../lib/time.js";
import { computeEvidence } from "../resolver/compute.js";
import { getTemplate, templates } from "../templates/index.js";

/**
 * KAHİN Oracle — MCP servisi (MIMARI §7.7). OKX.AI'da A2MCP olarak listelenebilir.
 * Yalnız OKUMA: zincire yazmaz, emir vermez, anahtar tutmaz. `prepare_bet` imzalanmamış işlem verisi döndürür;
 * çağıran agent kendi cüzdanıyla imzalar.
 */

const OUT = ["Unresolved", "YES", "NO", "VOID"] as const;
const ZERO = "0x0000000000000000000000000000000000000000";

const json = (v: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }],
});
const fail = (msg: string) => ({ content: [{ type: "text" as const, text: `HATA: ${msg}` }], isError: true });
const usdc = (v: bigint) => (Number(v) / 1e6).toString();

const TEMPLATE_DOCS: Record<number, { params: Record<string, string>; rule: string; resolveTime: string }> = {
  1: {
    params: { site: '"global" | "tr"', instId: "spot instrument, e.g. BTC-USDT, BTC-TRY", threshold: 'decimal string, e.g. "81800"' },
    rule: "Close of the 1-minute candle ending at resolveTime (opened at resolveTime−60) > threshold → YES, else NO. If it differs from the index candle (for TRY: BTC-USDT×USDT-TRY) by > 50 bps → VOID.",
    resolveTime: "Unix seconds, aligned to the minute, in the past",
  },
  2: {
    params: { instId: "perpetual swap, e.g. BTC-USDT-SWAP", fundingTime: "Unix seconds (OKX funding times: 00/08/16 UTC)" },
    rule: "Realized funding rate at fundingTime > 0 → YES, else NO.",
    resolveTime: "fundingTime + 120 (recommended)",
  },
  3: {
    params: { site: '"global" | "tr"', instId: "spot instrument, e.g. BTC-USDT", low: 'decimal string, e.g. "81500"', high: 'decimal string, e.g. "81550"' },
    rule: "Close of the 1-minute candle ending at resolveTime: low ≤ close < high → YES, else NO. Same index cross-check as PRICE_ABOVE. Live-grid squares use this template.",
    resolveTime: "Unix seconds, aligned to the minute, in the past",
  },
};

/** Izgara kareleri (şablon 3) 3 dakikalık sütunlar halinde açılır; diğerleri Scout'un tek tek açtığı marketlerdir. */
const GRID_TEMPLATE = 3;
const kindOf = (templateId: number) => (templateId === GRID_TEMPLATE ? "grid" : "market");

export function createOracleServer(): McpServer {
  const server = new McpServer({ name: "kahin-oracle", version: "0.1.0" });

  server.registerTool(
    "list_templates",
    {
      title: "Question templates",
      description: "The question templates KAHİN can resolve, their parameter formats and resolution rules.",
      inputSchema: {},
    },
    async () =>
      json(
        Object.values(templates).map((t) => ({
          templateId: t.id,
          key: t.key,
          name: t.name,
          ...TEMPLATE_DOCS[t.id],
        })),
      ),
  );

  server.registerTool(
    "resolve_metric",
    {
      title: "Resolve with evidence",
      description:
        "Deterministically computes the outcome for a template + params + past time from OKX data (OKX Agent Trade Kit). " +
        "Returns the outcome (YES/NO/VOID), the evidence core, its keccak256 hash and the ATK commands that were run. Same input → same hash. " +
        "With marketId, params are read from the on-chain KAHİN market and the hash is compared with the on-chain one. Requires the OKX CLI.",
      inputSchema: {
        templateId: z.number().int().optional().describe("1 = PRICE_ABOVE, 2 = FUNDING_POSITIVE, 3 = PRICE_IN_BAND (grid square) — required without marketId"),
        params: z.record(z.string(), z.unknown()).optional().describe("format from list_templates (required without marketId)"),
        resolveTime: z.number().int().optional().describe("Unix seconds, minute-aligned, in the past (required without marketId)"),
        marketId: z.number().int().positive().optional().describe("On-chain KAHİN market id"),
      },
    },
    async ({ templateId, params, resolveTime, marketId }) => {
      const ctx = { atk: realAtk, crossCheckMaxBps: BigInt(config.CROSSCHECK_MAX_BPS), nowMs: Date.now() };
      try {
        if (marketId !== undefined) {
          const dep = loadDeployment();
          const m = await getMarket(BigInt(marketId));
          if (nowSec() < m.resolveTime + 60) return fail(`market #${marketId} has not been measured yet (resolveTime ${m.resolveTime})`);
          const ev = await computeEvidence(m, { chainId: dep.chainId, contract: dep.pm }, ctx);
          const onchainHash = m.status >= Status.Proposed ? m.evidenceHash : null;
          return json({
            marketId,
            question: m.question,
            outcome: ev.core.outcome,
            reason: ev.core.reason,
            evidenceHash: ev.meta.evidenceHash,
            onchainEvidenceHash: onchainHash,
            matchesChain: onchainHash ? onchainHash.toLowerCase() === ev.meta.evidenceHash.toLowerCase() : null,
            core: ev.core,
            commands: ev.meta.commands,
          });
        }
        if (templateId === undefined || params === undefined || resolveTime === undefined) {
          return fail("marketId ya da (templateId, params, resolveTime) gerekli");
        }
        if (!isAligned(resolveTime)) return fail("resolveTime must be aligned to the minute (a multiple of 60)");
        if (resolveTime > nowSec() - 60) return fail("resolveTime must be in the past (at least 1 minute ago)");
        const t = getTemplate(templateId);
        const p = t.fromInput(params);
        const result = await t.resolve(p, resolveTime, ctx);
        const ev = buildEvidence({
          chainId: 43113,
          contract: ZERO,
          marketId: 0,
          templateId,
          params: t.toJson(p),
          resolveTime,
          result,
        });
        return json({
          question: t.questionTR(p, resolveTime),
          outcome: ev.core.outcome,
          reason: ev.core.reason,
          evidenceHash: ev.meta.evidenceHash,
          core: ev.core,
          commands: ev.meta.commands,
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_market",
    {
      title: "KAHİN market",
      description: "Status, pools, proposed/final outcome and (if any) evidence of an on-chain KAHİN market.",
      inputSchema: { marketId: z.number().int().positive() },
    },
    async ({ marketId }) => {
      try {
        const m = await getMarket(BigInt(marketId));
        const t = getTemplate(m.templateId);
        const ev = await loadEvidence(BigInt(marketId));
        return json({
          marketId,
          question: m.question,
          template: t.key,
          params: t.toJson(t.decode(m.params)),
          rule: t.ruleTR(t.decode(m.params), m.resolveTime),
          status: ["Active", "Proposed", "Disputed", "Finalized"][m.status],
          closeTime: m.closeTime,
          resolveTime: m.resolveTime,
          pools: { yes: usdc(m.yesPool), no: usdc(m.noPool) },
          proposedOutcome: OUT[m.proposedOutcome],
          finalOutcome: OUT[m.finalOutcome],
          evidenceHash: m.status >= Status.Proposed ? m.evidenceHash : null,
          evidenceURI: m.evidenceURI || null,
          evidence: ev?.core ?? null,
          verifyHint: "Call resolve_metric({marketId}) to recompute from OKX data and compare the hash.",
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_forecast",
    {
      title: "Agent tahmini",
      description: "The KAHİN agent's YES probability estimate for a market, its rationale and the ATK tools it used.",
      inputSchema: { marketId: z.number().int().positive() },
    },
    async ({ marketId }) => {
      const meta = loadMeta(String(marketId));
      if (!meta) return fail(`no agent forecast for market #${marketId}`);
      return json({
        marketId,
        myProbability: meta.myProbability ?? null,
        rationale_tr: meta.rationale_tr ?? null,
        model: meta.model ?? null,
        evidence_tools_used: meta.evidence_tools_used ?? [],
      });
    },
  );

  server.registerTool(
    "list_open_markets",
    {
      title: "Open markets",
      description:
        "KAHİN markets currently open for trading: question, rule, close/measurement time, pools, implied probability, agent forecast. " +
        "Two kinds: kind=\"market\" (price/funding questions opened by the agent, measured ~1 hour later) and kind=\"grid\" (live grid: " +
        "which $50 range BTC closes in, in 3-minute columns; every square is its own market and locks 2 minutes before measurement — " +
        "decide fast and check secondsToClose). `band` is the square's [low, high) range in USD; the top and bottom squares of each column are open-ended (low or high is null). " +
        "`question` and `rule` are the on-chain texts (Turkish); use `kind`, `band`, `params` and the times for logic.",
      inputSchema: {
        kind: z.enum(["all", "market", "grid"]).optional().describe("Filter: all (default), market or grid"),
        minSecondsToClose: z.number().int().min(0).optional().describe("Only markets with at least this many seconds left before trading closes (e.g. 60)"),
      },
    },
    async ({ kind = "all", minSecondsToClose = 0 }) => {
      try {
        const now = nowSec();
        const all = await getAllMarkets();
        return json(
          all
            .filter((m) => m.status === Status.Active && now + minSecondsToClose < m.closeTime)
            .filter((m) => kind === "all" || kindOf(m.templateId) === kind)
            .sort((a, b) => a.closeTime - b.closeTime)
            .map((m) => {
              const t = getTemplate(m.templateId);
              const p = t.decode(m.params);
              const total = m.yesPool + m.noPool;
              const meta = loadMeta(m.id.toString());
              const pj = t.toJson(p) as Record<string, string>;
              const band =
                m.templateId === GRID_TEMPLATE
                  ? {
                      // Açık uçlu kenar kareleri: low = null → "high altı", high = null → "low ve üstü"
                      low: BigInt(pj.lowE8) <= 100_000_000n ? null : (Number(pj.lowE8) / 1e8).toString(),
                      high: BigInt(pj.highE8) >= 100_000_000_000_000n ? null : (Number(pj.highE8) / 1e8).toString(),
                    }
                  : undefined;
              return {
                marketId: Number(m.id),
                kind: kindOf(m.templateId),
                templateId: m.templateId,
                question: m.question,
                rule: t.ruleTR(p, m.resolveTime),
                params: pj,
                ...(band ? { band } : {}),
                closeTime: m.closeTime,
                secondsToClose: m.closeTime - now,
                resolveTime: m.resolveTime,
                pools: { yes: usdc(m.yesPool), no: usdc(m.noPool) },
                impliedYes: total > 0n ? Number((m.yesPool * 10_000n) / total) / 10_000 : null,
                agentForecast: meta?.myProbability ?? null,
              };
            }),
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "prepare_bet",
    {
      title: "Prepare a bet",
      description:
        "Returns UNSIGNED transaction data (approve + bet) for a KAHİN market, plus a faucet step for test kUSDC. The service holds no keys; " +
        "the calling agent signs and sends with its own wallet on Avalanche Fuji (chainId 43113). Works on every open market including " +
        "grid squares; grid squares lock 2 minutes before measurement, so send right away.",
      inputSchema: {
        marketId: z.number().int().positive(),
        side: z.enum(["YES", "NO"]),
        amount: z.string().describe('kUSDC amount as a decimal string (e.g. "10")'),
        from: z.string().optional().describe("Sending wallet address (optional, informational)"),
      },
    },
    async ({ marketId, side, amount, from }) => {
      try {
        const dep = loadDeployment();
        const m = await getMarket(BigInt(marketId));
        if (m.status !== Status.Active || nowSec() >= m.closeTime) return fail("market is closed for trading");
        const amt = parseUnits(amount, 6);
        const { minBet } = await readParams();
        if (amt < minBet) return fail(`en az ${usdc(minBet)} kUSDC`);
        return json({
          chainId: dep.chainId,
          from: from ? getAddress(from) : null,
          steps: [
            {
              description: `approve ${amount} kUSDC`,
              to: dep.usdc,
              data: encodeFunctionData({ abi: mockUsdcAbi, functionName: "approve", args: [dep.pm, amt] }),
              value: "0",
            },
            {
              description: `bet #${marketId} ${side} ${amount}`,
              to: dep.pm,
              data: encodeFunctionData({ abi: predictionMarketAbi, functionName: "bet", args: [BigInt(marketId), side === "YES", amt] }),
              value: "0",
            },
          ],
          faucet: { to: dep.usdc, data: encodeFunctionData({ abi: mockUsdcAbi, functionName: "faucet" }), note: "test kUSDC (saatte 1000)" },
          closesAt: m.closeTime,
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "get_position",
    {
      title: "Pozisyon",
      description: "An address's YES/NO stake in a KAHİN market, claimable payout, whether it already claimed, and its kUSDC balance.",
      inputSchema: { marketId: z.number().int().positive(), address: z.string() },
    },
    async ({ marketId, address }) => {
      try {
        const dep = loadDeployment();
        const addr = getAddress(address);
        const { publicClient } = await import("../chain/client.js");
        const [pos, payout, balance] = await Promise.all([
          publicClient.readContract({ address: dep.pm, abi: predictionMarketAbi, functionName: "getPosition", args: [BigInt(marketId), addr] }),
          publicClient.readContract({ address: dep.pm, abi: predictionMarketAbi, functionName: "previewPayout", args: [BigInt(marketId), addr] }),
          publicClient.readContract({ address: dep.usdc, abi: mockUsdcAbi, functionName: "balanceOf", args: [addr] }),
        ]);
        return json({ marketId, address: addr, yes: usdc(pos[0]), no: usdc(pos[1]), claimed: pos[2], claimable: usdc(payout), kUSDCBalance: usdc(balance) });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "prepare_claim",
    {
      title: "Prepare a claim",
      description: "UNSIGNED `claim` transaction data to collect the payout of a finalized market. The calling agent signs it with its own wallet.",
      inputSchema: { marketId: z.number().int().positive(), address: z.string().optional().describe("To preview the payout (optional)") },
    },
    async ({ marketId, address }) => {
      try {
        const dep = loadDeployment();
        const m = await getMarket(BigInt(marketId));
        if (m.status !== Status.Finalized) return fail(`market #${marketId} is not final yet`);
        let claimable: string | null = null;
        if (address) {
          const { publicClient } = await import("../chain/client.js");
          claimable = usdc(
            await publicClient.readContract({ address: dep.pm, abi: predictionMarketAbi, functionName: "previewPayout", args: [BigInt(marketId), getAddress(address)] }),
          );
        }
        return json({
          chainId: dep.chainId,
          finalOutcome: OUT[m.finalOutcome],
          claimable,
          steps: [
            {
              description: `claim #${marketId}`,
              to: dep.pm,
              data: encodeFunctionData({ abi: predictionMarketAbi, functionName: "claim", args: [BigInt(marketId)] }),
              value: "0",
            },
          ],
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  return server;
}
