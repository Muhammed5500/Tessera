import "dotenv/config";
import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const num = (def: number) => z.coerce.number().int().positive().default(def);

/** docs/MIMARI.md §14 — agent/.env şeması. */
const schema = z.object({
  FUJI_RPC_URL: z.string().url().default("https://api.avax-test.network/ext/bc/C/rpc"),
  FUJI_RPC_FALLBACK: z.string().optional().transform((v) => (v ? v : undefined)),
  AGENT_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, "AGENT_PRIVATE_KEY 0x ile başlayan 64 hex karakter olmalı")
    .optional(),
  DEPLOYMENTS_FILE: z.string().default("../deployments/fuji.json"),

  ANTHROPIC_API_KEY: z.string().optional(),
  AGENT_MODEL: z.string().default("claude-opus-5-5"),
  /** Claude Opus 5.5'te varsayılan effort zaten medium; açıkça veriyoruz. */
  SCOUT_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),

  SCOUT_AUTO: bool,
  SCOUT_INTERVAL_SEC: num(600),
  SCOUT_MAX_STEPS: num(12),
  RESOLVER_INTERVAL_SEC: num(30),
  RESOLVE_DELAY_SEC: num(90),
  HEDGER_INTERVAL_SEC: num(300),

  MAX_OPEN_MARKETS: num(6),
  SEED_TOTAL: num(20),
  CROSSCHECK_MAX_BPS: num(50),

  HEDGE_ENABLED: bool,
  HEDGE_RATIO: z.coerce.number().default(0.2),
  HEDGE_MAX_NOTIONAL: num(20),
  HEDGE_MIN_STEP: num(5),
  OKX_TR_PROFILE: z.string().default("hackathon"),

  PORT: num(8787),
  PUBLIC_BASE_URL: z.string().default("http://localhost:8787"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  DRY_RUN: bool,
  PAUSE_AGENT: bool,
  DATA_DIR: z.string().default("./data"),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`agent/.env geçersiz:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

export const config = load();

export function requireAgentKey(): `0x${string}` {
  if (!config.AGENT_PRIVATE_KEY) {
    throw new Error("Bu işlem için agent/.env içinde AGENT_PRIVATE_KEY gerekli.");
  }
  return config.AGENT_PRIVATE_KEY as `0x${string}`;
}
