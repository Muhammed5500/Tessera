import { keccak256, stringToBytes, type Hex } from "viem";

/**
 * Kanonik JSON (MIMARI §9.2): anahtarlar sıralı, boşluksuz, sayılar string.
 * ⚠️ agent/src/evidence/canonical.ts ile birebir aynı olmalı (web kopyası) — biri değişirse diğeri de değişmeli.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalJSON: sonlu olmayan sayı");
      return JSON.stringify(String(value));
    case "bigint":
      return JSON.stringify(value.toString());
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJSON: desteklenmeyen tip ${typeof value}`);
  }
}

/** evidenceHash = keccak256(utf8(canonicalJSON(core))) */
export function hashCore(core: unknown): Hex {
  return keccak256(stringToBytes(canonicalJSON(core)));
}
