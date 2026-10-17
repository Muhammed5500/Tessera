/**
 * Bağımsız doğrulama (MIMARI §9.3):
 *   npm run verify -- <marketId>
 * Zincirden marketi okur → aynı şablon koduyla OKX verisini yeniden çeker → kanıt çekirdeğini
 * yeniden kurar → hash'i zincirdeki evidenceHash ile karşılaştırır. Agent'ın dosyalarına güvenmez.
 */
import { realAtk } from "../src/atk/index.js";
import { closeAllMcp } from "../src/atk/mcp.js";
import { config } from "../src/config.js";
import { loadDeployment } from "../src/chain/client.js";
import { getMarket, Outcome, Status } from "../src/chain/markets.js";
import { formatTR } from "../src/lib/time.js";
import { computeEvidence } from "../src/resolver/compute.js";
import { getTemplate } from "../src/templates/index.js";
import { parseArgs } from "./args.js";

const { positional } = parseArgs();
if (!positional[0] || !/^\d+$/.test(positional[0])) {
  console.error("Kullanım: npm run verify -- <marketId>");
  process.exit(2);
}
const id = BigInt(positional[0]);
const outcomeName = ["Unresolved", "YES", "NO", "VOID"];

try {
  const dep = loadDeployment();
  const m = await getMarket(id);
  const t = getTemplate(m.templateId);
  console.log(`Market #${id} · ${t.key}`);
  console.log(`Soru   : ${m.question}`);
  console.log(`Kural  : ${t.ruleTR(t.decode(m.params), m.resolveTime)}`);
  console.log(`Ölçüm  : ${formatTR(m.resolveTime)} TR`);

  if (m.status === Status.Active) {
    console.log("\nMarket henüz çözülmedi; doğrulanacak bir öneri yok.");
    process.exit(0);
  }

  const onchainOutcome = m.status === Status.Finalized ? m.finalOutcome : m.proposedOutcome;
  console.log(`Zincir : sonuç=${outcomeName[onchainOutcome]} · evidenceHash=${m.evidenceHash}`);

  const ev = await computeEvidence(m, { chainId: dep.chainId, contract: dep.pm }, {
    atk: realAtk,
    crossCheckMaxBps: BigInt(config.CROSSCHECK_MAX_BPS),
    nowMs: Date.now(),
  });
  console.log(`Yeniden: sonuç=${ev.core.outcome} · hash=${ev.meta.evidenceHash}`);
  console.log("Komutlar:\n  " + ev.meta.commands.join("\n  "));

  const hashOk = ev.meta.evidenceHash.toLowerCase() === m.evidenceHash.toLowerCase();
  const proposed = outcomeName[m.proposedOutcome];
  const outcomeOk = ev.core.outcome === proposed;

  if (hashOk && outcomeOk) {
    console.log(`\n✅ DOĞRULANDI — sonuç ${ev.core.outcome}, hash zincirdekiyle eşleşiyor.`);
    if (m.status === Status.Finalized && m.finalOutcome !== Outcome.Void && m.finalOutcome !== m.proposedOutcome) {
      console.log("ℹ️ Not: itiraz sonrası komite farklı karar vermiş.");
    }
    process.exit(0);
  }
  console.log(`\n❌ UYUŞMAZLIK — hash ${hashOk ? "eşleşiyor" : "eşleşmiyor"}, önerilen sonuç ${proposed}, yeniden hesaplanan ${ev.core.outcome}.`);
  console.log("İtiraz süresi devam ediyorsa `dispute` açılabilir.");
  process.exit(1);
} finally {
  await closeAllMcp();
}
