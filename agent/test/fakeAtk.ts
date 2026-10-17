import type { Atk, AtkResult } from "../src/atk/types.js";

type CliHandler = (site: string, args: string[]) => unknown;
type McpHandler = (site: string, tool: string, args: Record<string, unknown>) => unknown;

/** Sahte ATK: handler'ın döndürdüğü değer `json` olur; Error fırlatırsa çağrı başarısız olur. */
export function fakeAtk(cli: CliHandler, mcp: McpHandler = () => []): Atk & { calls: string[] } {
  const calls: string[] = [];
  const wrap = (command: string, json: unknown): AtkResult => ({ json, command, raw: JSON.stringify(json) });
  return {
    calls,
    async cli(site, args) {
      const command = `OKX_SITE=${site} okx ${args.join(" ")} --json`;
      calls.push(command);
      return wrap(command, cli(site, args));
    },
    async mcp(site, tool, args) {
      const command = `mcp(${site}) ${tool} ${JSON.stringify(args)}`;
      calls.push(command);
      return wrap(command, mcp(site, tool, args));
    },
  };
}

/** [openTimeMs, o, h, l, c, vol, volCcy, volQuote, confirm] */
export const candle = (openSec: number, close: string, confirm = "1") => [
  String(openSec * 1000), close, close, close, close, "1", "1", "1", confirm,
];

/** [openTimeMs, o, h, l, c, confirm] */
export const indexCandle = (openSec: number, close: string, confirm = "1") => [
  String(openSec * 1000), close, close, close, close, confirm,
];
