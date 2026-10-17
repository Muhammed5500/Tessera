"use client";

import Link from "next/link";
import { formatTR, formatUsdc, impliedYes, phase, type Market } from "@/lib/chain";
import { formatDuration } from "@/lib/hooks";

export function OddsBar({ yes, size = "md" }: { yes: number | null; size?: "sm" | "md" }) {
  const h = size === "sm" ? "h-1.5" : "h-2.5";
  if (yes === null) return <div className={`${h} w-full rounded-full bg-panel-2`} />;
  return (
    <div className={`${h} flex w-full overflow-hidden rounded-full bg-panel-2`}>
      <div className="bg-yes" style={{ width: `${yes}%` }} />
      <div className="bg-no" style={{ width: `${100 - yes}%` }} />
    </div>
  );
}

export function PhasePill({ m, now }: { m: Market; now: number }) {
  const p = phase(m, now);
  return <span className={`pill pill-${p.tone}`}>{p.label}</span>;
}

export function MarketCard({ m, now, agentP }: { m: Market; now: number; agentP?: number }) {
  const yes = impliedYes(m);
  const total = m.yesPool + m.noPool;
  const p = phase(m, now);
  const timeLine =
    p.tone === "open"
      ? `Tahmin kapanışına ${formatDuration(m.closeTime - now)}`
      : p.tone === "closed"
        ? now < m.resolveTime
          ? `Ölçüme ${formatDuration(m.resolveTime - now)} · ${formatTR(m.resolveTime)}`
          : `Ölçüldü ${formatTR(m.resolveTime)} · agent çözüyor`
        : `Ölçüm ${formatTR(m.resolveTime)}`;

  return (
    <Link href={`/market/${m.id}`} className="card block p-4 transition hover:border-accent/60">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="mono text-xs text-muted">#{m.id.toString()}</span>
        <PhasePill m={m} now={now} />
      </div>
      <h3 className="mb-3 text-base font-semibold leading-snug">{m.question}</h3>
      <OddsBar yes={yes} />
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-yes">EVET {yes === null ? "—" : `%${yes.toFixed(0)}`}</span>
        <span className="text-muted">{formatUsdc(total)} kUSDC havuz</span>
        <span className="text-no">HAYIR {yes === null ? "—" : `%${(100 - yes).toFixed(0)}`}</span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span>{timeLine}</span>
        {agentP !== undefined && <span className="text-accent">Agent: %{Math.round(agentP * 100)}</span>}
      </div>
    </Link>
  );
}
