/**
 * Zincire dokunmadan bir şablonu canlı ATK verisiyle çözer ve kanıt çekirdeğini + hash'i yazdırır.
 *
 *   npm run preview -- --template PRICE_ABOVE --site global --inst BTC-USDT --threshold 81000 --at 1792228560
 *   npm run preview -- --template FUNDING_POSITIVE --inst BTC-USDT-SWAP --funding-time 1792224000
 *
 * --at verilmezse 3 dakika önceki dakika kullanılır.
 */
import { realAtk } from "../src/atk/index.js";
import { closeAllMcp } from "../src/atk/mcp.js";
import { config } from "../src/config.js";
import { buildEvidence } from "../src/evidence/build.js";
import { alignMinute, formatTR, nowSec } from "../src/lib/time.js";
import { getTemplateByKey } from "../src/templates/index.js";
import { parseArgs } from "./args.js";

const { named } = parseArgs();
const template = getTemplateByKey(named.template ?? "PRICE_ABOVE");

const input =
  template.key === "PRICE_ABOVE"
    ? { site: named.site ?? "global", instId: named.inst ?? "BTC-USDT", threshold: named.threshold ?? "1" }
    : { instId: named.inst ?? "BTC-USDT-SWAP", fundingTime: named["funding-time"] };

const params = template.fromInput(input);
const at = named.at ? Number(named.at) : template.key === "FUNDING_POSITIVE" ? Number(named["funding-time"]) + 120 : alignMinute(nowSec()) - 180;

console.log(`Şablon : ${template.key}`);
console.log(`Soru   : ${template.questionTR(params, at)}`);
console.log(`Kural  : ${template.ruleTR(params, at)}`);
console.log(`Zaman  : ${at} (${formatTR(at)} TR)\n`);

try {
  const result = await template.resolve(params, at, { atk: realAtk, crossCheckMaxBps: BigInt(config.CROSSCHECK_MAX_BPS), nowMs: Date.now() });
  const ev = buildEvidence({
    chainId: 43113,
    contract: "0x0000000000000000000000000000000000000000",
    marketId: 0,
    templateId: template.id,
    params: template.toJson(params),
    resolveTime: at,
    result,
  });
  console.log("core:", JSON.stringify(ev.core, null, 2));
  console.log("\nkomutlar:\n  " + ev.meta.commands.join("\n  "));
  console.log(`\nSONUÇ: ${ev.core.outcome}${ev.core.reason ? ` (${ev.core.reason})` : ""}`);
  console.log(`hash : ${ev.meta.evidenceHash}`);
} finally {
  await closeAllMcp();
}
