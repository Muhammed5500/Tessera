import type { Hex } from "viem";
import type { Atk } from "../atk/types.js";

export type ResolvedOutcome = "YES" | "NO" | "VOID";

/** Kanıta giren tek bir gözlem. Bütün değerler string (kanonik hash için). */
export type Observation = Record<string, string>;

export type ResolveResult = {
  outcome: ResolvedOutcome;
  observations: Observation[];
  crossCheck: Record<string, string> | null;
  rule: string;
  /** VOID ise sebep kodu: CROSSCHECK_FAILED, DATA_UNAVAILABLE ... */
  reason?: string;
  /** evidence.meta'ya: çalıştırılan ATK komutları ve ham yanıtlar (hash'e girmez) */
  commands: string[];
  raw: string[];
};

export type ResolveContext = {
  atk: Atk;
  crossCheckMaxBps: bigint;
  /** Şu anki zaman (ms). Testlerde sabitlenir. */
  nowMs: number;
};

/** Veri henüz hazır değil (mum kesinleşmedi, funding kaydı yok) → resolver tekrar dener. */
export class NotReady extends Error {}

/**
 * Soru şablonu (MIMARI §5). LLM yalnız şablon + parametre seçer; kural ve çözüm buradadır.
 * `P` zincirde ABI-kodlu olarak saklanır; `input` LLM/CLI'dan gelen JSON biçimidir.
 */
export interface Template<P> {
  id: number;
  key: string;
  name: string;
  /** LLM veya CLI girdisini doğrular ve iç tipe çevirir. */
  fromInput(input: unknown): P;
  encode(p: P): Hex;
  decode(data: Hex): P;
  /** Kanıt ve arayüz için: tüm değerler string. */
  toJson(p: P): Record<string, string>;
  questionTR(p: P, resolveTime: number): string;
  ruleTR(p: P, resolveTime: number): string;
  resolve(p: P, resolveTime: number, ctx: ResolveContext): Promise<ResolveResult>;
}

export type AnyTemplate = Template<any>;
