import { realAtk } from "../atk/index.js";
import { config } from "../config.js";
import { loadDeployment } from "../chain/client.js";
import { claim, finalize, getAllMarkets, outcomeFromString, payouts, proposeResolution, readParams, Status } from "../chain/markets.js";
import { evidenceURI, saveEvidence } from "../evidence/store.js";
import { addEvent } from "../feed/store.js";
import { nowSec } from "../lib/time.js";
import { NotReady } from "../templates/types.js";
import { computeEvidence, dataUnavailableEvidence } from "./compute.js";

/** Rol 2 — RESOLVER (MIMARI §7.3). LLM yok; tamamen deterministik. */

let running = false;
const lastWaitLog = new Map<string, number>();
let contractParams: Awaited<ReturnType<typeof readParams>> | null = null;
/** Agent'ın ödülünü aldığı ya da alacağı bir şey olmayan kesinleşmiş marketler (tekrar sorgulanmaz). */
const claimDone = new Set<string>();
const CLAIMS_PER_TICK = 15;

/**
 * 3) Agent'ın kendi kazancını geri alması: ızgara ve Scout marketlerine koyduğu başlangıç likiditesi kesinleşince
 * sözleşmede bekler; alınmazsa agent'ın kUSDC'si birkaç saatte biter. Birikmiş olanlar her turda en çok
 * CLAIMS_PER_TICK adet alınır; akışa tur başına tek özet yazılır.
 */
async function claimWinnings(markets: Awaited<ReturnType<typeof getAllMarkets>>, agent: `0x${string}`) {
  const pending = markets.filter((m) => m.status === Status.Finalized && !claimDone.has(m.id.toString())).map((m) => m.id);
  if (!pending.length) return;
  const info = await payouts(pending, agent);
  let n = 0;
  let total = 0n;
  let lastTx: string | undefined;
  for (const x of info) {
    if (x.claimed || x.payout === 0n) {
      claimDone.add(x.id.toString());
      continue;
    }
    if (n >= CLAIMS_PER_TICK) break;
    const { hash } = await claim(x.id);
    claimDone.add(x.id.toString());
    n++;
    total += x.payout;
    lastTx = hash;
  }
  if (n) {
    addEvent({
      type: "info",
      message: `Kazanç geri alındı: ${n} market · ${(Number(total) / 1e6).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} kUSDC`,
      tx: lastTx,
    });
  }
}

export async function resolverTick(): Promise<void> {
  if (running || config.PAUSE_AGENT) return;
  running = true;
  try {
    const dep = loadDeployment();
    contractParams ??= await readParams();
    const chain = { chainId: dep.chainId, contract: dep.pm };
    const markets = await getAllMarkets();
    const now = nowSec();

    for (const m of markets) {
      const key = m.id.toString();

      // 1) Vadesi gelen aktif marketler → çöz ve öner
      if (m.status === Status.Active && now >= m.resolveTime + config.RESOLVE_DELAY_SEC) {
        let ev;
        try {
          ev = await computeEvidence(m, chain, {
            atk: realAtk,
            crossCheckMaxBps: BigInt(config.CROSSCHECK_MAX_BPS),
            nowMs: Date.now(),
          });
        } catch (e) {
          const msg = (e as Error).message;
          const deadlineNear = now > m.resolveTime + contractParams.proposeDeadline - 600;
          if (!deadlineNear) {
            const last = lastWaitLog.get(key) ?? 0;
            if (Date.now() - last > 5 * 60_000) {
              lastWaitLog.set(key, Date.now());
              addEvent({
                type: e instanceof NotReady ? "resolve_waiting" : "error",
                marketId: key,
                message: e instanceof NotReady ? `Veri bekleniyor: ${msg}` : `Çözüm hatası, tekrar denenecek: ${msg}`,
              });
            }
            continue;
          }
          ev = dataUnavailableEvidence(m, chain, msg, Date.now());
        }

        if (config.DRY_RUN) {
          addEvent({ type: "info", marketId: key, message: `[DRY_RUN] önerilecek sonuç: ${ev.core.outcome}`, data: { hash: ev.meta.evidenceHash } });
          continue;
        }

        await saveEvidence(m.id, ev);
        const { hash, confirmMs } = await proposeResolution(
          m.id,
          outcomeFromString[ev.core.outcome],
          ev.meta.evidenceHash,
          evidenceURI(m.id),
        );
        ev.meta.tx = hash;
        await saveEvidence(m.id, ev);
        addEvent({
          type: "resolution_proposed",
          marketId: key,
          message: `Sonuç önerildi: ${ev.core.outcome}${ev.core.reason ? ` (${ev.core.reason})` : ""}`,
          data: { evidenceHash: ev.meta.evidenceHash, observations: ev.core.observations, crossCheck: ev.core.crossCheck },
          tx: hash,
          confirmMs,
        });
        continue;
      }

      // 2) İtiraz süresi dolan öneriler → kesinleştir (herkes çağırabilir; agent nezaketen yapar)
      if (m.status === Status.Proposed && now >= m.proposedAt + contractParams.disputeWindow && !config.DRY_RUN) {
        const { hash, confirmMs } = await finalize(m.id);
        addEvent({ type: "finalized", marketId: key, message: "Market kesinleşti", tx: hash, confirmMs });
      }
    }
    if (!config.DRY_RUN) await claimWinnings(await getAllMarkets(), dep.agent);
  } catch (e) {
    const err = e as Error & { shortMessage?: string };
    addEvent({ type: "error", message: `Resolver döngüsü hatası: ${(err.shortMessage ?? err.message).slice(0, 200)}` });
  } finally {
    running = false;
  }
}
