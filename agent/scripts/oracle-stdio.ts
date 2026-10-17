/**
 * KAHİN Oracle MCP — stdio modu (MIMARI §7.7).
 *   claude mcp add --transport stdio kahin-oracle -- npm --prefix <repo>/agent run -s oracle:stdio
 * stdout MCP protokolüne ayrılmıştır; tüm loglar stderr'e yönlendirilir.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

console.log = (...a: unknown[]) => console.error(...a);

const { createOracleServer } = await import("../src/oracle-mcp/server.js");
const server = createOracleServer();
await server.connect(new StdioServerTransport());
console.error("[tessera] stdio hazır");
