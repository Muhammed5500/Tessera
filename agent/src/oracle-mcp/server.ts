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
import { formatTR, isAligned, nowSec } from "../lib/time.js";
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
    params: { site: '"global" | "tr"', instId: "spot enstrüman, ör. BTC-USDT, BTC-TRY", threshold: "ondalık string, ör. \"81800\"" },
    rule: "resolveTime'da biten 1 dakikalık mumun (açılışı resolveTime−60) kapanışı > threshold → YES, aksi NO. Index mumuyla (TRY'de BTC-USDT×USDT-TRY) fark > 50 bps → VOID.",
    resolveTime: "dakikaya hizalı Unix saniye, geçmişte",
  },
  2: {
    params: { instId: "perp, ör. BTC-USDT-SWAP", fundingTime: "Unix saniye (OKX funding: 00/08/16 UTC)" },
    rule: "fundingTime'daki gerçekleşen funding oranı (realizedRate) > 0 → YES, aksi NO.",
    resolveTime: "fundingTime + 120 (önerilen)",
  },
};

export function createOracleServer(): McpServer {
  const server = new McpServer({ name: "kahin-oracle", version: "0.1.0" });

  server.registerTool(
    "list_templates",
    {
      title: "Şablon kataloğu",
      description: "KAHİN'in çözebildiği soru şablonları, parametre biçimleri ve çözüm kuralları. Ücretsiz.",
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
      title: "Metriği kanıtla çöz",
      description:
        "Bir şablon + parametre + geçmiş zaman için sonucu OKX verisiyle (OKX Agent Trade Kit) deterministik olarak hesaplar. " +
        "Sonuç (YES/NO/VOID), kanıt çekirdeği, keccak256 hash'i ve çalıştırılan ATK komutlarını döndürür. Aynı girdi → aynı hash. " +
        "marketId verilirse parametreler zincirdeki KAHİN marketinden okunur ve hash zincirdekiyle karşılaştırılır. Fiyat (taslak): 0,01 USDC/çağrı.",
      inputSchema: {
        templateId: z.number().int().optional().describe("1 = PRICE_ABOVE, 2 = FUNDING_POSITIVE (marketId yoksa zorunlu)"),
        params: z.record(z.string(), z.unknown()).optional().describe("list_templates'teki biçim (marketId yoksa zorunlu)"),
        resolveTime: z.number().int().optional().describe("Unix saniye, dakikaya hizalı, geçmişte (marketId yoksa zorunlu)"),
        marketId: z.number().int().positive().optional().describe("Zincirdeki KAHİN market id'si"),
      },
    },
    async ({ templateId, params, resolveTime, marketId }) => {
      const ctx = { atk: realAtk, crossCheckMaxBps: BigInt(config.CROSSCHECK_MAX_BPS), nowMs: Date.now() };
      try {
        if (marketId !== undefined) {
          const dep = loadDeployment();
          const m = await getMarket(BigInt(marketId));
          if (nowSec() < m.resolveTime + 60) return fail(`market #${marketId} henüz ölçülmedi (${formatTR(m.resolveTime)} TR)`);
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
        if (!isAligned(resolveTime)) return fail("resolveTime dakikaya hizalı olmalı (60'ın katı)");
        if (resolveTime > nowSec() - 60) return fail("resolveTime geçmişte olmalı (en az 1 dk önce)");
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
      title: "KAHİN marketi",
      description: "Zincirdeki bir KAHİN marketinin durumu, havuzları, önerilen/kesin sonucu ve (varsa) kanıtı. Ücretsiz.",
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
          verifyHint: "resolve_metric({marketId}) ile OKX verisinden yeniden hesaplayıp hash'i karşılaştırabilirsin.",
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
      description: "KAHİN agent'ının bir market için EVET olasılık tahmini, gerekçesi ve kullandığı ATK araçları. Fiyat (taslak): 0,005 USDC/çağrı.",
      inputSchema: { marketId: z.number().int().positive() },
    },
    async ({ marketId }) => {
      const meta = loadMeta(String(marketId));
      if (!meta) return fail(`market #${marketId} için agent tahmini yok`);
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
      title: "Açık marketler",
      description: "Şu an tahmine açık KAHİN marketleri: soru, kural, kapanış/ölçüm zamanı, havuzlar, ima edilen olasılık, agent tahmini. Ücretsiz.",
      inputSchema: {},
    },
    async () => {
      try {
        const now = nowSec();
        const all = await getAllMarkets();
        return json(
          all
            .filter((m) => m.status === Status.Active && now < m.closeTime)
            .map((m) => {
              const t = getTemplate(m.templateId);
              const p = t.decode(m.params);
              const total = m.yesPool + m.noPool;
              const meta = loadMeta(m.id.toString());
              return {
                marketId: Number(m.id),
                question: m.question,
                rule: t.ruleTR(p, m.resolveTime),
                closeTime: m.closeTime,
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
      title: "Tahmin işlemi hazırla",
      description:
        "Bir KAHİN marketine tahmin için İMZALANMAMIŞ işlem verisini (approve + bet) döndürür. Servis hiçbir anahtar tutmaz; " +
        "çağıran agent işlemleri kendi cüzdanıyla Avalanche Fuji'de (chainId 43113) imzalayıp gönderir. Ücretsiz.",
      inputSchema: {
        marketId: z.number().int().positive(),
        side: z.enum(["YES", "NO"]),
        amount: z.string().describe("kUSDC miktarı, ondalık string (ör. \"10\")"),
        from: z.string().optional().describe("Gönderecek cüzdan adresi (isteğe bağlı, yalnız bilgi amaçlı)"),
      },
    },
    async ({ marketId, side, amount, from }) => {
      try {
        const dep = loadDeployment();
        const m = await getMarket(BigInt(marketId));
        if (m.status !== Status.Active || nowSec() >= m.closeTime) return fail("market tahmine kapalı");
        const amt = parseUnits(amount, 6);
        const { minBet } = await readParams();
        if (amt < minBet) return fail(`en az ${usdc(minBet)} kUSDC`);
        return json({
          chainId: dep.chainId,
          from: from ? getAddress(from) : null,
          steps: [
            {
              description: `kUSDC onayı: ${amount}`,
              to: dep.usdc,
              data: encodeFunctionData({ abi: mockUsdcAbi, functionName: "approve", args: [dep.pm, amt] }),
              value: "0",
            },
            {
              description: `Tahmin: market #${marketId} · ${side} · ${amount} kUSDC`,
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

  return server;
}
