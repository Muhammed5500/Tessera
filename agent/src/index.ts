import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { closeAllMcp } from "./atk/mcp.js";
import { resolverTick } from "./resolver/loop.js";
import { watchBets } from "./chain/watch.js";
import { gridTick } from "./grid/maker.js";
import { runScout } from "./scout/loop.js";
import { hedgerTick } from "./hedger/loop.js";
import { addEvent } from "./feed/store.js";
import { startServer, type LoopStatus } from "./server/index.js";

/** Agent servisi: döngüler + HTTP API (MIMARI §7.1). Scout F4'te, Hedger F7'de eklenir. */
/**
 * Tek kopya kilidi: aynı cüzdanla iki agent süreci aynı ızgara sütunlarını açıp nonce çakışmasına yol açıyordu.
 * data/agent.pid'deki süreç hâlâ yaşıyorsa başlama.
 */
function singleInstance() {
  mkdirSync(config.DATA_DIR, { recursive: true });
  const lock = join(config.DATA_DIR, "agent.pid");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    let alive = false;
    try {
      if (pid && pid !== process.pid) {
        process.kill(pid, 0);
        alive = true;
      }
    } catch {
      alive = false;
    }
    if (alive) {
      console.error(`Başka bir agent zaten çalışıyor (pid ${pid}). Önce onu durdur ya da ${lock} dosyasını sil.`);
      process.exit(1);
    }
  }
  writeFileSync(lock, String(process.pid));
  const release = () => {
    try {
      if (readFileSync(lock, "utf8") === String(process.pid)) rmSync(lock);
    } catch {
      /* yoksay */
    }
  };
  process.on("exit", release); // mevcut SIGINT/SIGTERM işleyicisi process.exit çağırır
}

async function main() {
  singleInstance();
  const loops: LoopStatus = {
    resolver: { enabled: true },
    scout: { enabled: false },
    hedger: { enabled: false },
  };

  await startServer(loops);

  const runResolver = async () => {
    loops.resolver.lastRunAt = new Date().toISOString();
    await resolverTick();
  };
  await runResolver();
  setInterval(runResolver, config.RESOLVER_INTERVAL_SEC * 1000);

  // Canlı ızgara (şablon 3): GRID_ENABLED=1 ise eksik 3 dk'lık sütunları açar
  if (config.GRID_ENABLED) {
    loops.grid = { enabled: true };
    const runGrid = async () => {
      loops.grid.lastRunAt = new Date().toISOString();
      await gridTick();
    };
    runGrid();
    setInterval(runGrid, config.GRID_INTERVAL_SEC * 1000);
  }

  // Dış tahmin izleyici: agent dışındaki adreslerden gelen BetPlaced olayları → akış
  await watchBets();
  setInterval(watchBets, 20_000);

  // Scout (F4): SCOUT_AUTO=1 ise otomatik döngü. Beyin: API anahtarı varsa API, yoksa yerel Claude Code.
  // İlk tarama 5 dk sonra (resolver önce toparlansın).
  if (config.SCOUT_AUTO) {
    loops.scout.enabled = true;
    const runScoutLoop = async () => {
      loops.scout.lastRunAt = new Date().toISOString();
      await runScout();
    };
    setTimeout(runScoutLoop, 5 * 60_000);
    setInterval(runScoutLoop, config.SCOUT_INTERVAL_SEC * 1000);
  } else {
    console.log("[agent] SCOUT_AUTO kapalı → otomatik market açma yok (elle: npm run scout:once)");
  }

  // Hedger (F7): yalnız HEDGE_ENABLED=1 iken gerçek emir döngüsü. Kuru plan için: npm run hedger:once
  if (config.HEDGE_ENABLED) {
    loops.hedger.enabled = true;
    setInterval(async () => {
      loops.hedger.lastRunAt = new Date().toISOString();
      try {
        await hedgerTick({ live: true });
      } catch (e) {
        addEvent({ type: "error", message: `Hedger hatası: ${(e as Error).message.slice(0, 200)}` });
      }
    }, config.HEDGER_INTERVAL_SEC * 1000);
  }

  console.log(`[agent] başladı · DRY_RUN=${config.DRY_RUN} · PAUSE_AGENT=${config.PAUSE_AGENT} · model=${config.AGENT_MODEL}`);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await closeAllMcp();
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
