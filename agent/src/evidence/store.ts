import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import type { Evidence } from "./build.js";

const dir = () => join(config.DATA_DIR, "evidence");

export async function saveEvidence(marketId: bigint | number, ev: Evidence): Promise<string> {
  await mkdir(dir(), { recursive: true });
  const path = join(dir(), `${marketId}.json`);
  await writeFile(path, JSON.stringify(ev, null, 2));
  return path;
}

export async function loadEvidence(marketId: bigint | number): Promise<Evidence | null> {
  try {
    return JSON.parse(await readFile(join(dir(), `${marketId}.json`), "utf8")) as Evidence;
  } catch {
    return null;
  }
}

export function evidenceURI(marketId: bigint | number): string {
  return `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/evidence/${marketId}.json`;
}

/**
 * Zincire yazılan meta adresi şablonu: `{id}` yerine market numarası konur.
 * Market numarası işlem onaylanınca belli olduğu için (eşzamanlı açılışlar) önceden tahmin edilmez.
 */
export function metadataURI(): string {
  return `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/markets/{id}/meta`;
}
