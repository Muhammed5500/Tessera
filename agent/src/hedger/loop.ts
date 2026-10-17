import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atkCli } from "../atk/cli.js";
import { config } from "../config.js";
import { predictionMarketAbi } from "../chain/abi.js";
import { loadDeployment, publicClient } from "../chain/client.js";
import { getAllMarkets, Status } from "../chain/markets.js";
import { addEvent } from "../feed/store.js";
import { formatE8 } from "../lib/decimal.js";
import { priceAbove } from "../templates/priceAbove.js";
import { estimateCost, exposureUp, fmt, fmt4, planHedge, type MarketExposure } from "./plan.js";

/**
 * Rol 3 — HEDGER (MIMARI §7.4). Agent'ın seed pozisyonlarından doğan BTC yönlü riskini
 * OKX TR spot piyasasında küçük, tavanlı işlemlerle dengeler. LLM'in emir yetkisi YOK.
 * Gerçek emir yalnız HEDGE_ENABLED=1 VE live=true iken; aksi halde yalnız plan (kuru mod).
 */

const INST = "BTC-USDT";
const DEFAULT_TAKER_BPS = 10n; // ücret okunamazsa varsayım: %0,10 (etiketlenir)

type HedgeState = { currentMicro: string; orders: { at: string; side: string; notional: string; ordId?: string }[] };
const stateFile = () => join(config.DATA_DIR, "hedge-state.json");

function loadState(): HedgeState {
  if (!existsSync(stateFile())) return { currentMicro: "0", orders: [] };
  return JSON.parse(readFileSync(stateFile(), "utf8")) as HedgeState;
}
function saveState(s: HedgeState) {
  mkdirSync(config.DATA_DIR, { recursive: true });
  writeFileSync(stateFile(), JSON.stringify(s, null, 2));
}

const toMicro = (usdt: number) => BigInt(Math.round(usdt * 1e6));
let lastLoggedExposure: bigint | null = null;

export async function hedgerTick(opts: { live: boolean }) {
  if (config.PAUSE_AGENT) return { skipped: "PAUSE_AGENT" };
  const live = opts.live && config.HEDGE_ENABLED;
  const dep = loadDeployment();

  // 1) Agent'ın BTC fiyat marketlerindeki pozisyonları (kesinleşmemiş)
  const markets = await getAllMarkets();
  const positions: MarketExposure[] = [];
  for (const m of markets) {
    if (m.templateId !== priceAbove.id || m.status === Status.Finalized) continue;
    const p = priceAbove.decode(m.params);
    if (!p.instId.startsWith("BTC-")) continue;
    const [yes, no] = await publicClient.readContract({
      address: dep.pm,
      abi: predictionMarketAbi,
      functionName: "getPosition",
      args: [m.id, dep.agent],
    });
    if (yes === 0n && no === 0n) continue;
    positions.push({ marketId: m.id.toString(), direction: 1, yes, no });
  }

  // 2) Plan
  const state = loadState();
  const exp = exposureUp(positions);
  const plan = planHedge({
    exposureUp: exp,
    current: BigInt(state.currentMicro),
    ratioBps: BigInt(Math.round(config.HEDGE_RATIO * 10_000)),
    maxNotional: toMicro(config.HEDGE_MAX_NOTIONAL),
    minStep: toMicro(config.HEDGE_MIN_STEP),
  });
  const summary = `maruziyet ${fmt(exp)} USDT (${positions.length} market) · hedef ${fmt(plan.target)} · mevcut ${fmt(plan.current)}`;

  if (plan.action === "none") {
    if (lastLoggedExposure !== exp) {
      lastLoggedExposure = exp;
      addEvent({ type: "hedge", message: `Hedge gerekmiyor: ${summary} — ${plan.reason}`, data: { positions } });
    }
    return { plan, positions };
  }

  // 3) Maliyet: OKX TR emir defteri + ücret oranı
  const ob = await atkCli("tr", ["market", "orderbook", INST, "--sz", "20"]);
  const book = (ob.json as { asks: string[][]; bids: string[][] }[])[0];
  const levels = (plan.action === "buy" ? book.asks : book.bids).map((l) => [l[0], l[1]] as [string, string]);

  let feeBps = DEFAULT_TAKER_BPS;
  let feeSource = "varsayım (%0,10)";
  if (live) {
    try {
      const f = await atkCli("tr", ["--profile", config.OKX_TR_PROFILE, "account", "fees", "--instType", "SPOT"]);
      const taker = String((f.json as { taker?: string }[])[0]?.taker ?? "");
      if (taker) {
        feeBps = BigInt(Math.round(Math.abs(Number(taker)) * 10_000));
        feeSource = "hesap ücret oranı";
      }
    } catch {
      /* varsayımla devam */
    }
  }
  const cost = estimateCost(levels, plan.notional, feeBps);
  const costLine = `ort. fiyat ${formatE8(cost.avgPriceE8)} · kayma ${cost.slippageBps} bps · ücret ~${fmt4(cost.feeMicro)} USDT (${feeSource})`;
  const sideTR = plan.action === "buy" ? "AL" : "SAT";

  if (!live) {
    addEvent({
      type: "hedge",
      message: `[KURU] Hedge planı: OKX TR ${INST} ${sideTR} ${fmt(plan.notional)} USDT · ${summary} · ${costLine}`,
      data: { plan: { ...plan }, cost, positions, command: `okx --profile ${config.OKX_TR_PROFILE} spot place --instId ${INST} --side ${plan.action} --ordType market --sz ${fmt(plan.notional)} --tgtCcy quote_ccy` },
    });
    return { plan, cost, positions, dry: true };
  }

  // 4) Gerçek emir (yalnız HEDGE_ENABLED=1 + live) — tutar tavanlı, market emri, quote cinsinden
  const res = await atkCli(
    "tr",
    ["--profile", config.OKX_TR_PROFILE, "spot", "place", "--instId", INST, "--side", plan.action, "--ordType", "market", "--sz", fmt(plan.notional), "--tgtCcy", "quote_ccy"],
    1, // emirlerde otomatik tekrar deneme YOK
  );
  const ordId = String((res.json as { ordId?: string }[])[0]?.ordId ?? "");
  state.currentMicro = (BigInt(state.currentMicro) + plan.diff).toString();
  state.orders.push({ at: new Date().toISOString(), side: plan.action, notional: fmt(plan.notional), ordId });
  saveState(state);
  addEvent({
    type: "hedge",
    message: `Hedge emri: OKX TR ${INST} ${sideTR} ${fmt(plan.notional)} USDT · emir #${ordId} · ${costLine}`,
    data: { plan: { ...plan }, cost, positions, ordId, command: res.command },
  });
  return { plan, cost, positions, ordId };
}
