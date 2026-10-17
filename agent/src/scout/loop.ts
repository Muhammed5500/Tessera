import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { realAtk } from "../atk/index.js";
import type { Site } from "../atk/types.js";
import { config } from "../config.js";
import { createMarket, getAllMarkets, marketCount, seedMarket, Status } from "../chain/markets.js";
import { metadataURI } from "../evidence/store.js";
import { addEvent, saveMeta } from "../feed/store.js";
import { parseE8 } from "../lib/decimal.js";
import { formatTR, nowSec } from "../lib/time.js";
import { checkProposal, type OpenMarketSummary, type Proposal } from "../policy/index.js";
import { getTemplate } from "../templates/index.js";
import { SCOUT_SYSTEM, scoutUserMessage } from "./prompt.js";
import { callAtkTool, isAtkTool, loadAtkTools, OWN_TOOLS, type ToolTraceEntry } from "./tools.js";

/**
 * Rol 1 — SCOUT (MIMARI §7.2). LLM yalnız OKUR ve ÖNERİR.
 * Zincire yazma (createMarket, seed) yalnız Policy onayından sonra bu deterministik koddan yapılır.
 */

const proposalSchema = z.object({
  templateId: z.number().int(),
  params: z.record(z.string(), z.unknown()),
  closeInMinutes: z.number().int(),
  resolveInMinutes: z.number().int(),
  myProbability: z.number(),
  rationale_tr: z.string(),
  evidence_tools_used: z.array(z.string()),
});

export type ScoutOutcome =
  | { kind: "created"; marketId: bigint }
  | { kind: "accepted_dry_run" }
  | { kind: "no_market"; reason: string }
  | { kind: "error"; reason: string };

let running = false;
let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!config.ANTHROPIC_API_KEY) throw new Error("Scout için agent/.env içinde ANTHROPIC_API_KEY gerekli.");
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  return client;
}

async function openMarkets(): Promise<OpenMarketSummary[]> {
  const all = await getAllMarkets();
  return all
    .filter((m) => m.status === Status.Active || m.status === Status.Proposed)
    .map((m) => {
      const t = getTemplate(m.templateId);
      return { templateId: m.templateId, params: t.toJson(t.decode(m.params)), resolveTime: m.resolveTime };
    });
}

async function lastPriceE8(site: Site, instId: string): Promise<bigint | undefined> {
  try {
    const res = await realAtk.cli(site, ["market", "candles", instId, "--bar", "1m", "--limit", "1"]);
    return parseE8(String((res.json as string[][])[0][4]));
  } catch {
    return undefined;
  }
}

export async function runScout(opts: { dryRun?: boolean; extraContext?: string } = {}): Promise<ScoutOutcome> {
  if (running) return { kind: "error", reason: "scout zaten çalışıyor" };
  if (config.PAUSE_AGENT) return { kind: "error", reason: "PAUSE_AGENT" };
  running = true;
  const dryRun = opts.dryRun ?? config.DRY_RUN;
  const trace: ToolTraceEntry[] = [];
  let proposalAttempts = 0;
  let outcome: ScoutOutcome | null = null;
  const usage = { input: 0, output: 0, calls: 0 };

  try {
    const open = await openMarkets();
    if (open.length >= config.MAX_OPEN_MARKETS) {
      addEvent({ type: "no_market", message: `Açık market sınırı dolu (${open.length}/${config.MAX_OPEN_MARKETS}); tarama atlandı.` });
      return { kind: "no_market", reason: "max open markets" };
    }

    const tools = [...(await loadAtkTools()), ...OWN_TOOLS];
    const now = nowSec();
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: "user",
        content: scoutUserMessage({ nowSec: now, nowTR: formatTR(now), openMarkets: String(open.length), extraContext: opts.extraContext }),
      },
    ];

    const handleProposal = async (raw: unknown): Promise<string> => {
      proposalAttempts++;
      if (proposalAttempts > 2) return "Deneme hakkın bitti; yeni öneri kabul edilmeyecek. Kısa bir özetle bitir.";
      const parsed = proposalSchema.safeParse(raw);
      if (!parsed.success) return `Öneri biçimi geçersiz: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
      const proposal = parsed.data as Proposal;

      let lastPrice: bigint | undefined;
      if (proposal.templateId === 1) {
        const site = (proposal.params.site === "tr" ? "tr" : "global") as Site;
        lastPrice = await lastPriceE8(site, String(proposal.params.instId ?? ""));
      }
      const check = checkProposal(proposal, {
        nowSec: nowSec(),
        openMarkets: await openMarkets(),
        maxOpenMarkets: config.MAX_OPEN_MARKETS,
        lastPriceE8: lastPrice,
      });

      if (!check.ok) {
        addEvent({ type: "proposal_rejected", message: `Politika öneriyi reddetti: ${check.reasons.join("; ")}`, data: { proposal } });
        return `POLİTİKA REDDİ:\n- ${check.reasons.join("\n- ")}\nİstersen bir kez düzeltip tekrar öner; uygun değilse bitir.`;
      }

      const t = getTemplate(check.market.templateId);
      const question = t.questionTR(check.market.params, check.market.resolveTime);
      if (dryRun) {
        outcome = { kind: "accepted_dry_run" };
        addEvent({
          type: "info",
          message: `[DRY_RUN] Politika onayladı: ${question}`,
          data: { proposal, closeTime: check.market.closeTime, resolveTime: check.market.resolveTime, toolTrace: trace },
        });
        return `KABUL (DRY_RUN): "${question}" — zincire gönderilmedi.`;
      }

      const nextId = (await marketCount()) + 1n; // tek yazar agent → sıradaki id
      const created = await createMarket({
        templateId: t.id,
        params: t.encode(check.market.params),
        question,
        metadataURI: metadataURI(nextId),
        closeTime: check.market.closeTime,
        resolveTime: check.market.resolveTime,
      });
      saveMeta(nextId, {
        source: "scout",
        model: config.AGENT_MODEL,
        template: t.key,
        params: t.toJson(check.market.params),
        rule: t.ruleTR(check.market.params, check.market.resolveTime),
        rationale_tr: proposal.rationale_tr,
        myProbability: proposal.myProbability,
        evidence_tools_used: proposal.evidence_tools_used,
        toolTrace: trace,
        createdTx: created.hash,
      });
      addEvent({
        type: "market_created",
        marketId: nextId.toString(),
        message: `Market açıldı: ${question}`,
        data: { rationale_tr: proposal.rationale_tr, myProbability: proposal.myProbability, tools: trace.map((x) => x.tool) },
        tx: created.hash,
        confirmMs: created.confirmMs,
      });
      outcome = { kind: "created", marketId: nextId };

      try {
        const seed = await seedMarket(nextId, proposal.myProbability, config.SEED_TOTAL);
        addEvent({
          type: "seed",
          marketId: nextId.toString(),
          message: `Başlangıç likiditesi: ${config.SEED_TOTAL} kUSDC (YES %${Math.round(proposal.myProbability * 100)})`,
          data: { yes: seed.yesAmt.toString(), no: seed.noAmt.toString(), txs: seed.txs },
        });
      } catch (e) {
        addEvent({ type: "error", marketId: nextId.toString(), message: `Seed başarısız: ${(e as Error).message}` });
      }
      return `KABUL: Market #${nextId} açıldı — "${question}". Görev tamamlandı.`;
    };

    for (let step = 0; step < config.SCOUT_MAX_STEPS && !outcome; step++) {
      const response = await anthropic().beta.messages.create({
        model: config.AGENT_MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: config.SCOUT_EFFORT },
        system: SCOUT_SYSTEM,
        tools,
        messages,
      });
      usage.calls++;
      usage.input += response.usage.input_tokens;
      usage.output += response.usage.output_tokens;

      if (response.stop_reason === "refusal") {
        outcome = { kind: "error", reason: `model reddetti (${response.stop_details?.category ?? "?"})` };
        break;
      }
      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) {
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(" ")
          .trim();
        outcome = { kind: "no_market", reason: text || "model market önermedi" };
        addEvent({ type: "no_market", message: `Uygun market yok: ${text.slice(0, 300)}`, data: { toolTrace: trace } });
        break;
      }
      if (response.stop_reason === "max_tokens") throw new Error("araç girdisi max_tokens'ta kesildi");

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        if (isAtkTool(tu.name)) {
          const { text, trace: tr } = await callAtkTool(tu.name, input);
          trace.push(tr);
          results.push({ type: "tool_result", tool_use_id: tu.id, content: text, is_error: !tr.ok });
        } else if (tu.name === "list_open_markets") {
          const open = await openMarkets();
          results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(open) });
        } else if (tu.name === "propose_market") {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: await handleProposal(input) });
        } else {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: `bilinmeyen araç: ${tu.name}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }

    if (!outcome) {
      outcome = { kind: "no_market", reason: "adım sınırına ulaşıldı" };
      addEvent({ type: "no_market", message: `Scout ${config.SCOUT_MAX_STEPS} adımda öneri üretmedi.`, data: { toolTrace: trace } });
    }
    return outcome;
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `Claude API ${e.status}: ${e.message}` : (e as Error).message;
    addEvent({ type: "error", message: `Scout hatası: ${msg}` });
    return { kind: "error", reason: msg };
  } finally {
    running = false;
    console.log(`[scout] model çağrısı=${usage.calls} input=${usage.input} output=${usage.output} araç=${trace.length}`);
  }
}
