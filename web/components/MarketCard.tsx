"use client";

import Link from "next/link";
import { describeParams, formatTR, formatUsdc, impliedYes, phase, type Market } from "@/lib/chain";
import { formatDuration } from "@/lib/hooks";
import { AssetIcon } from "./ui";

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

/** Polymarket tarzı yarım daire olasılık göstergesi. */
function Gauge({ pct }: { pct: number | null }) {
  const r = 22;
  const c = Math.PI * r;
  const v = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const color = pct === null ? "var(--line)" : v >= 50 ? "var(--yes)" : "var(--no)";
  return (
    <div className="relative h-[34px] w-[56px] shrink-0">
      <svg width="56" height="34" viewBox="0 0 56 34" aria-hidden>
        <path d="M6 30 A22 22 0 0 1 50 30" fill="none" stroke="var(--panel-2)" strokeWidth="5" strokeLinecap="round" />
        <path
          d="M6 30 A22 22 0 0 1 50 30"
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center leading-none">
        <div className="tabular text-[13px] font-semibold">{pct === null ? "—" : `%${pct.toFixed(0)}`}</div>
      </div>
    </div>
  );
}

export function MarketCard({ m, now }: { m: Market; now: number; agentP?: number }) {
  const yes = impliedYes(m);
  const total = m.yesPool + m.noPool;
  const p = phase(m, now);
  const open = p.tone === "open";
  const final = p.tone === "final";
  const desc = describeParams(m.templateId, m.params);

  return (
    <Link
      href={`/market/${m.id}`}
      className="card group flex h-full flex-col justify-between gap-4 p-4 transition-colors hover:border-[#2f3846] hover:bg-panel-2/30"
    >
      <div className="flex items-start gap-3">
        <AssetIcon instId={desc.enstrüman} size={38} />
        <h3 className="line-clamp-2 flex-1 text-[15px] font-medium leading-snug">{m.question}</h3>
        {!final && (
          <div className="flex flex-col items-center">
            <Gauge pct={yes} />
            <span className="mt-0.5 text-[10px] text-muted">şans</span>
          </div>
        )}
      </div>

      {final ? (
        <div
          className={`rounded-lg py-2 text-center text-sm font-medium ${
            m.finalOutcome === 1 ? "bg-yes/10 text-yes" : m.finalOutcome === 2 ? "bg-no/10 text-no" : "bg-panel-2 text-muted"
          }`}
        >
          {m.finalOutcome === 1 ? "Evet" : m.finalOutcome === 2 ? "Hayır" : "Geçersiz"} ile sonuçlandı
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <span
            className={`rounded-lg py-2 text-center text-sm font-medium transition-colors ${
              open ? "bg-yes/12 text-yes group-hover:bg-yes/20" : "bg-panel-2 text-muted"
            }`}
          >
            Evet
          </span>
          <span
            className={`rounded-lg py-2 text-center text-sm font-medium transition-colors ${
              open ? "bg-no/12 text-no group-hover:bg-no/20" : "bg-panel-2 text-muted"
            }`}
          >
            Hayır
          </span>
        </div>
      )}

      <div className="tabular flex items-center justify-between text-xs text-muted">
        <span>${formatUsdc(total, 0)} hacim</span>
        <span>
          {open
            ? formatDuration(m.closeTime - now)
            : final
              ? formatTR(m.resolveTime)
              : p.tone === "closed"
                ? "Sonuç bekleniyor"
                : "Sonuç önerildi"}
        </span>
      </div>
    </Link>
  );
}
