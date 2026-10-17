/**
 * Scout'u tek sefer çalıştırır.
 *   npm run scout:once -- --dry                       # politika onayına kadar, zincire yazmaz
 *   npm run scout:once                                 # gerçek: market açar + seed
 *   npm run scout:once -- --context "resolveTime 20:05–21:25 TR arasında olsun"
 */
import { closeAllMcp } from "../src/atk/mcp.js";
import { recentEvents } from "../src/feed/store.js";
import { runScout } from "../src/scout/loop.js";
import { parseArgs } from "./args.js";

const { named } = parseArgs();
try {
  const outcome = await runScout({ dryRun: named.dry === "true", extraContext: named.context });
  console.log("\nSONUÇ:", JSON.stringify(outcome, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  const last = recentEvents(3);
  for (const e of last.reverse()) {
    console.log(`\n[${e.type}] ${e.message}`);
    if (e.data) console.log(JSON.stringify(e.data, null, 2).slice(0, 2500));
  }
} finally {
  await closeAllMcp();
}
