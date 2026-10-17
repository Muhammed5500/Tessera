/** Resolver döngüsünü tek sefer çalıştırır (demo/test için). */
import { closeAllMcp } from "../src/atk/mcp.js";
import { resolverTick } from "../src/resolver/loop.js";

try {
  await resolverTick();
} finally {
  await closeAllMcp();
}
