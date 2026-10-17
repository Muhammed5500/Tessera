/**
 * Şablonlu marketi elle açar (agent cüzdanıyla). Scout'un yedeği ve demo marketleri için (PLAN F6).
 *
 * Fiyat:
 *   npm run create-manual -- --template PRICE_ABOVE --site global --inst BTC-USDT \
 *        (--threshold 81800 | --offset-bps 20) (--resolve-in 15 | --resolve-at 2026-10-17T20:05:00+03:00) \
 *        [--close-before 5] [--seed 20 --p 0.5] [--dry]
 * Funding:
 *   npm run create-manual -- --template FUNDING_POSITIVE --inst BTC-USDT-SWAP --funding-time next \
 *        [--close-before 30] [--seed 20 --p 0.5] [--dry]
 */
import { parseUnits } from "viem";
import { realAtk } from "../src/atk/index.js";
import { mockUsdcAbi } from "../src/chain/abi.js";
import { agentWallet, loadDeployment, sendAndConfirm } from "../src/chain/client.js";
import { bet, createMarket, marketCount, readParams, WRITE_GAS } from "../src/chain/markets.js";
import { metadataURI } from "../src/evidence/store.js";
import { addEvent, saveMeta } from "../src/feed/store.js";
import { formatE8, parseE8 } from "../src/lib/decimal.js";
import { alignMinute, formatTR, nowSec } from "../src/lib/time.js";
import { getTemplateByKey } from "../src/templates/index.js";
import { parseArgs } from "./args.js";

const { named } = parseArgs();
const template = getTemplateByKey(named.template ?? "PRICE_ABOVE");
const dry = named.dry === "true";
const now = nowSec();

let input: Record<string, unknown>;
let resolveTime: number;
let closeTime: number;

if (template.key === "PRICE_ABOVE") {
  const site = named.site ?? "global";
  const instId = named.inst ?? "BTC-USDT";
  let threshold = named.threshold;
  if (!threshold) {
    const bps = BigInt(named["offset-bps"] ?? "0");
    const res = await realAtk.cli(site as "global" | "tr", ["market", "candles", instId, "--bar", "1m", "--limit", "1"]);
    const last = parseE8(String((res.json as string[][])[0][4]));
    // eşik: son fiyat ± bps, 2 ondalığa yuvarlanmış
    const raw = last + (last * bps) / 10_000n;
    threshold = formatE8(raw - (raw % 1_000_000n));
    console.log(`Son fiyat ${formatE8(last)} → eşik ${threshold} (${bps} bps)`);
  }
  input = { site, instId, threshold };
  resolveTime = named["resolve-at"]
    ? alignMinute(Math.floor(new Date(named["resolve-at"]).getTime() / 1000))
    : alignMinute(now) + Number(named["resolve-in"] ?? "15") * 60;
  closeTime = resolveTime - Number(named["close-before"] ?? "5") * 60;
} else {
  const instId = named.inst ?? "BTC-USDT-SWAP";
  let fundingTime = named["funding-time"] ?? "next";
  if (fundingTime === "next") {
    const res = await realAtk.cli("global", ["market", "funding-rate", instId]);
    fundingTime = String(Number((res.json as { fundingTime: string }[])[0].fundingTime) / 1000);
  }
  input = { instId, fundingTime };
  resolveTime = Number(fundingTime) + 120; // gerçekleşen kaydın yayınlanması için pay
  closeTime = Number(fundingTime) - Number(named["close-before"] ?? "30") * 60;
}

const params = template.fromInput(input);
const question = template.questionTR(params, resolveTime);
const { minResolveGap } = dry ? { minResolveGap: 120 } : await readParams();

console.log(`\nŞablon     : ${template.key}`);
console.log(`Soru       : ${question}`);
console.log(`Kapanış    : ${formatTR(closeTime)} TR (${closeTime})`);
console.log(`Ölçüm      : ${formatTR(resolveTime)} TR (${resolveTime})`);
console.log(`Parametre  : ${JSON.stringify(template.toJson(params))}`);

if (closeTime <= now) throw new Error("closeTime geçmişte");
if (resolveTime < closeTime + minResolveGap) throw new Error(`resolveTime, closeTime'dan en az ${minResolveGap} sn sonra olmalı`);

if (dry) {
  console.log("\n[--dry] zincire gönderilmedi.");
  process.exit(0);
}

const nextId = (await marketCount()) + 1n; // tek yazar agent → sıradaki id
const created = await createMarket({
  templateId: template.id,
  params: template.encode(params),
  question,
  metadataURI: metadataURI(nextId),
  closeTime,
  resolveTime,
});
saveMeta(nextId, {
  source: "manual",
  template: template.key,
  params: template.toJson(params),
  rule: template.ruleTR(params, resolveTime),
  rationale_tr: named.rationale ?? "Elle açılan market (demo).",
  createdTx: created.hash,
});
addEvent({ type: "market_created", marketId: nextId.toString(), message: `Market açıldı (elle): ${question}`, tx: created.hash, confirmMs: created.confirmMs });
console.log(`\n✅ Market #${nextId} açıldı · tx ${created.hash} · ${created.confirmMs} ms`);

const seed = Number(named.seed ?? "0");
if (seed > 0) {
  const p = Number(named.p ?? "0.5");
  const total = parseUnits(String(seed), 6);
  const yesAmt = (total * BigInt(Math.round(p * 100))) / 100n;
  const noAmt = total - yesAmt;
  const dep = loadDeployment();
  await sendAndConfirm("approve", () =>
    agentWallet().writeContract({ gas: WRITE_GAS, address: dep.usdc, abi: mockUsdcAbi, functionName: "approve", args: [dep.pm, total] }),
  );
  if (yesAmt > 0n) await bet(nextId, true, yesAmt);
  if (noAmt > 0n) await bet(nextId, false, noAmt);
  addEvent({ type: "seed", marketId: nextId.toString(), message: `Başlangıç likiditesi: ${seed} kUSDC (YES %${Math.round(p * 100)})` });
  console.log(`Seed: YES ${yesAmt} / NO ${noAmt} (6 decimals)`);
}
