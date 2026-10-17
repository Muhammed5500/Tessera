import { atkCli } from "./cli.js";
import { atkMcp } from "./mcp.js";
import type { Atk } from "./types.js";

/** Gerçek ATK: CLI (tekrar edilebilir komutlar) + MCP (CLI'ın desteklemediği parametreler). */
export const realAtk: Atk = {
  cli: (site, args) => atkCli(site, args),
  mcp: (site, tool, args) => atkMcp(site, tool, args),
};

export * from "./types.js";
