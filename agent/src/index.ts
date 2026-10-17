import { config } from "./config.js";
import { closeAllMcp } from "./atk/mcp.js";
import { resolverTick } from "./resolver/loop.js";
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

  console.log(`[agent] başladı · DRY_RUN=${config.DRY_RUN} · PAUSE_AGENT=${config.PAUSE_AGENT}`);
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
