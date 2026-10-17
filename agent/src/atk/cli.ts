import { spawn } from "node:child_process";
import { recordCall } from "./counter.js";
import { AtkError, type AtkResult, type Site } from "./types.js";

const TIMEOUT_MS = 20_000;
const SAFE_ARG = /^[A-Za-z0-9_.:\-]+$/;

/** `okx market candles` → "market_candles" gibi sayaç anahtarı. */
function toolName(args: string[]): string {
  return args.filter((a) => !a.startsWith("-")).slice(0, 2).join("_");
}

function runOnce(site: Site, args: string[]): Promise<AtkResult> {
  const fullArgs = [...args, "--json"];
  const command = `OKX_SITE=${site} okx ${fullArgs.join(" ")}`;
  for (const a of fullArgs) {
    // Windows'ta shell üzerinden çalıştığımız için yalnız güvenli karakterlere izin ver.
    if (!SAFE_ARG.test(a)) throw new AtkError(`güvensiz argüman: ${a}`, command);
  }

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn("okx", fullArgs, {
      env: { ...process.env, OKX_SITE: site },
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new AtkError(`zaman aşımı (${TIMEOUT_MS} ms)`, command));
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      recordCall({ tool: toolName(args), via: "cli", site, ms: Date.now() - started, ok: false });
      reject(new AtkError(`okx çalıştırılamadı: ${e.message}`, command));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      if (code !== 0) {
        recordCall({ tool: toolName(args), via: "cli", site, ms, ok: false });
        return reject(new AtkError(`okx çıkış kodu ${code}: ${(err || out).trim().slice(0, 500)}`, command));
      }
      try {
        const json = JSON.parse(out);
        recordCall({ tool: toolName(args), via: "cli", site, ms, ok: true });
        resolve({ json, command, raw: out });
      } catch {
        recordCall({ tool: toolName(args), via: "cli", site, ms, ok: false });
        reject(new AtkError(`JSON parse edilemedi: ${out.slice(0, 300)}`, command));
      }
    });
  });
}

/** Exponential backoff ile en fazla `attempts` deneme. */
export async function atkCli(site: Site, args: string[], attempts = 3): Promise<AtkResult> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await runOnce(site, args);
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}
