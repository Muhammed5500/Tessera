import { config } from "./config.js";
import { closeAllMcp } from "./atk/mcp.js";
import { resolverTick } from "./resolver/loop.js";
import { runScout } from "./scout/loop.js";
import { startServer, type LoopStatus } from "./server/index.js";

/** Agent servisi: döngüler + HTTP API (MIMARI §7.1). Scout F4'te, Hedger F7'de eklenir. */
async function main() {
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

  // Scout (F4): SCOUT_AUTO=1 ise otomatik döngü. Beyin: API anahtarı varsa API, yoksa yerel Claude Code.
  // İlk tarama 1 dk sonra (resolver önce toparlansın).
  if (config.SCOUT_AUTO) {
    loops.scout.enabled = true;
    const runScoutLoop = async () => {
      loops.scout.lastRunAt = new Date().toISOString();
      await runScout();
    };
    setTimeout(runScoutLoop, 60_000);
    setInterval(runScoutLoop, config.SCOUT_INTERVAL_SEC * 1000);
  } else {
    console.log("[agent] SCOUT_AUTO kapalı → otomatik market açma yok (elle: npm run scout:once)");
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
