/**
 * Hedger'ı tek sefer çalıştırır (MIMARI §7.4).
 *   npm run hedger:once                         # kuru mod: yalnız plan (varsayılan)
 *   npm run hedger:once -- --ratio 1 --min 1    # kuru modda farklı oran/adım ile dene
 *   npm run hedger:once -- --live               # GERÇEK EMİR — yalnız HEDGE_ENABLED=1 iken
 */
import { parseArgs } from "./args.js";

const { named } = parseArgs();
if (named.ratio) process.env.HEDGE_RATIO = named.ratio;
if (named.min) process.env.HEDGE_MIN_STEP = named.min;

const { config } = await import("../src/config.js");
const { hedgerTick } = await import("../src/hedger/loop.js");
const { fmt, fmt4 } = await import("../src/hedger/plan.js");

const live = named.live === "true";
if (live && !config.HEDGE_ENABLED) {
  console.error("--live verildi ama HEDGE_ENABLED=1 değil → gerçek emir gönderilmeyecek, kuru modda çalışıyor.");
}
const r = await hedgerTick({ live });
const p = r.plan;
if (p) {
  console.log(`maruziyet ${fmt(p.exposureUp)} · hedef ${fmt(p.target)} · mevcut ${fmt(p.current)} · işlem: ${p.action} ${fmt(p.notional)} USDT`);
  console.log(`gerekçe: ${p.reason}`);
}
if ("cost" in r && r.cost) console.log(`maliyet: kayma ${r.cost.slippageBps} bps · ücret ~${fmt4(r.cost.feeMicro)} USDT · dolum ${r.cost.filled ? "tam" : "KISMİ"}`);
if ("ordId" in r) console.log(`emir: ${r.ordId}`);
