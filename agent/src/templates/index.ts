import { fundingPositive } from "./fundingPositive.js";
import { priceAbove } from "./priceAbove.js";
import type { AnyTemplate } from "./types.js";

/** Kayıtlı şablonlar. Bonus şablonlar (3–5) F9'da eklenir. */
export const templates: Record<number, AnyTemplate> = {
  [priceAbove.id]: priceAbove,
  [fundingPositive.id]: fundingPositive,
};

export function getTemplate(id: number): AnyTemplate {
  const t = templates[id];
  if (!t) throw new Error(`şablon ${id} kayıtlı değil`);
  return t;
}

export function getTemplateByKey(key: string): AnyTemplate {
  const t = Object.values(templates).find((x) => x.key === key.toUpperCase());
  if (!t) throw new Error(`şablon "${key}" kayıtlı değil (mevcut: ${Object.values(templates).map((x) => x.key).join(", ")})`);
  return t;
}

export * from "./types.js";
