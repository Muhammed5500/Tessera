"use client";

import Link from "next/link";
import { formatTR, formatUsdc, impliedYes, phase, type Market } from "@/lib/chain";
import { formatDuration } from "@/lib/hooks";

export function OddsBar({ yes, size = "md" }: { yes: number | null; size?: "sm" | "md" }) {
  const h = size === "sm" ? "h-1" : "h-1.5";
  if (yes === null) return <div className={`${h} w-full rounded-full bg-panel-2`} />;
  return (
    <div className={`${h} flex w-full gap-0.5 overflow-hidden rounded-full`}>
      <div className="rounded-full bg-yes" style={{ width: `${yes}%` }} />
      <div className="rounded-full bg-no/70" style={{ width: `${100 - yes}%` }} />
    </div>
  );
}

const DOT: Record<string, string> = {
  open: "bg-yes",
  closed: "bg-warn",
  proposed: "bg-info",
  disputed: "bg-no",
  final: "bg-muted",
};

export function PhasePill({ m, now }: { m: Market; now: number }) {
  const p = phase(m, now);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[p.tone]}`} />
      {p.label}
    </span>
  );
}

export function MarketCard({ m, now, agentP }: { m: Market; now: number; agentP?: number }) {
  const yes = impliedYes(m);
  const total = m.yesPool + m.noPool;
  const p = phase(m, now);
  const open = p.tone === "open";
  const timeLine = open
    ? `${formatDuration(m.closeTime - now)} kaldı`
    : p.tone === "closed"
      ? now < m.resolveTime
        ? `Ölçüm ${formatTR(m.resolveTime)}`
        : "Sonuç hesaplanıyor"
      : formatTR(m.resolveTime);
  const shown = yes ?? (agentP !== undefined ? agentP * 100 : null);

  return (
    <Link
      href={`/market/${m.id}`}
      className="card group flex flex-col gap-3 p-4 transition-colors hover:border-[#2f3846] hover:bg-panel-2/40"
    >
      <div className="flex items-start gap-3">
        <h3 className="flex-1 text-[15px] font-medium leading-snug text-text">{m.question}</h3>
        <div className="shrink-0 text-right">
          <div className="tabular text-xl font-semibold leading-none">{shown === null ? "—" : `%${shown.toFixed(0)}`}</div>
          <div className="mt-1 text-[11px] text-muted">{yes === null && agentP !== undefined ? "agent tahmini" : "evet"}</div>
        </div>
      </div>

      {p.tone === "final" ? (
        <div
          className={`rounded-lg px-3 py-2 text-sm font-medium ${
            m.finalOutcome === 1 ? "bg-yes/10 text-yes" : m.finalOutcome === 2 ? "bg-no/10 text-no" : "bg-panel-2 text-muted"
          }`}
        >
          Sonuç: {m.finalOutcome === 1 ? "Evet" : m.finalOutcome === 2 ? "Hayır" : "İptal (iade)"}
        </div>
      ) : open ? (
        <div className="grid grid-cols-2 gap-2">
          <span className="rounded-lg bg-yes/10 py-2 text-center text-sm font-medium text-yes transition group-hover:bg-yes/15">
            Evet
          </span>
          <span className="rounded-lg bg-no/10 py-2 text-center text-sm font-medium text-no transition group-hover:bg-no/15">
            Hayır
          </span>
        </div>
      ) : (
        <OddsBar yes={yes} size="sm" />
      )}

      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="tabular">{formatUsdc(total)} kUSDC hacim</span>
        <span className="flex items-center gap-3">
          {!open && p.tone !== "final" && <PhasePill m={m} now={now} />}
          <span className="tabular">{timeLine}</span>
        </span>
      </div>
    </Link>
  );
}
