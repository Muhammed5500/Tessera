"use client";

import Link from "next/link";
import { decodeSpec, formatTime, formatUsdc, impliedYes, marketQuestion, phase, type Market } from "@/lib/chain";
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

const NAMES: Record<string, string> = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", AVAX: "Avalanche", DOGE: "Dogecoin", XRP: "XRP" };

/** Polymarket tarzı yarım daire olasılık göstergesi. */
function Gauge({ pct }: { pct: number | null }) {
  const r = 26;
  const c = Math.PI * r;
  const v = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const color = pct === null ? "var(--line)" : v >= 60 ? "var(--yes)" : v >= 30 ? "var(--warn)" : "var(--no)";
  return (
    <div className="relative h-[48px] w-[64px] shrink-0">
      <svg width="64" height="36" viewBox="0 0 64 36" aria-hidden>
        <path d="M6 33 A26 26 0 0 1 58 33" fill="none" stroke="var(--line)" strokeWidth="4" strokeLinecap="round" />
        <path
          d="M6 33 A26 26 0 0 1 58 33"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
        />
      </svg>
      <div className="tabular absolute inset-x-0 top-[15px] text-center text-[14px] font-semibold leading-none">
        {pct === null ? "—" : `${pct.toFixed(0)}%`}
      </div>
      <div className="absolute inset-x-0 top-[36px] text-center text-[10px] leading-none text-muted">chance</div>
    </div>
  );
}

export function MarketCard({ m, now }: { m: Market; now: number; agentP?: number }) {
  const yes = impliedYes(m);
  const total = m.yesPool + m.noPool;
  const p = phase(m, now);
  const open = p.tone === "open";
  const final = p.tone === "final";
  const spec = decodeSpec(m.templateId, m.params);
  const name = NAMES[(spec.instId ?? "").split("-")[0]] ?? "Crypto";

  return (
    <Link
      href={`/market/${m.id}`}
      className="card group flex h-full flex-col justify-between gap-4 p-4 transition-colors hover:border-[#2f3846] hover:bg-panel-2/30"
    >
      <div className="flex items-start gap-3">
        <AssetIcon instId={spec.instId} size={38} />
        <h3 className="line-clamp-2 flex-1 text-[15px] font-medium leading-snug">{marketQuestion(m)}</h3>
        {!final && (
          <Gauge pct={yes} />
        )}
      </div>

      {final ? (
        <div
          className={`rounded-lg py-2 text-center text-sm font-medium ${
            m.finalOutcome === 1 ? "bg-yes/10 text-yes" : m.finalOutcome === 2 ? "bg-no/10 text-no" : "bg-panel-2 text-muted"
          }`}
        >
          Resolved {m.finalOutcome === 1 ? "Yes" : m.finalOutcome === 2 ? "No" : "Void"}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <span
            className={`rounded-lg py-2 text-center text-sm font-medium transition-colors ${
              open ? "bg-yes/12 text-yes group-hover:bg-yes/20" : "bg-panel-2 text-muted"
            }`}
          >
            Yes
          </span>
          <span
            className={`rounded-lg py-2 text-center text-sm font-medium transition-colors ${
              open ? "bg-no/12 text-no group-hover:bg-no/20" : "bg-panel-2 text-muted"
            }`}
          >
            No
          </span>
        </div>
      )}

      <div className="tabular flex items-center gap-1.5 text-xs text-muted">
        {open ? (
          <span className="flex items-center gap-1 font-medium text-no">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-no" />
            LIVE
          </span>
        ) : (
          <span>${formatUsdc(total, 0)} Vol.</span>
        )}
        <span>· {name}</span>
        <span className="ml-auto">{open ? formatDuration(m.closeTime - now) : final ? formatTime(m.resolveTime) : "Awaiting result"}</span>
      </div>
    </Link>
  );
}
