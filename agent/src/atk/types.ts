export type Site = "global" | "tr";

/** Bir ATK çağrısının sonucu. `command` kanıta (evidence.meta) birebir yazılır. */
export type AtkResult = {
  json: unknown;
  command: string;
  raw: string;
};

/**
 * Resolver ve şablonların kullandığı ATK arayüzü.
 * Testlerde sahte (fake) uygulama verilir; gerçekte cli.ts + mcp.ts.
 */
export interface Atk {
  /** `OKX_SITE=<site> okx <args...> --json` */
  cli(site: Site, args: string[]): Promise<AtkResult>;
  /** okx-trade-mcp --site <site> --modules market üzerinden araç çağrısı */
  mcp(site: Site, tool: string, args: Record<string, unknown>): Promise<AtkResult>;
}

export class AtkError extends Error {
  constructor(
    message: string,
    readonly command: string,
  ) {
    super(message);
  }
}
