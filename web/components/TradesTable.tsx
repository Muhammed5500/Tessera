"use client";

import { useState } from "react";
import { addrUrl, formatUsdc, txUrl } from "@/lib/chain";
import type { Activity } from "@/lib/history";
import { walletLabel } from "@/lib/traders";

function ago(t: number, now: number) {
  const s = Math.max(0, now - t);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/** Bir marketteki son işlemler: kim, hangi taraf, ne kadar, hangi fiyattan, ne zaman (BetPlaced olaylarından). */
export function TradesTable({ trades, now, limit = 10 }: { trades: Activity[] | null; now: number; limit?: number }) {
  const [all, setAll] = useState(false);
  if (trades === null) return <div className="h-32 animate-pulse rounded-lg bg-panel" />;
  if (!trades.length) return <div className="py-8 text-center text-sm text-muted">No trades yet — be the first.</div>;
  const rows = all ? trades : trades.slice(0, limit);

  return (
    <div>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-1 pb-2 font-normal">Trader</th>
              <th className="px-1 pb-2 font-normal">Side</th>
              <th className="px-1 pb-2 text-right font-normal">Amount</th>
              <th className="px-1 pb-2 text-right font-normal">Price</th>
              <th className="px-1 pb-2 text-right font-normal">Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => {
              const label = walletLabel(a.user);
              return (
                <tr key={`${a.tx}-${i}`} className="border-t border-line">
                  <td className="px-1 py-2.5">
                    <a href={addrUrl(a.user)} target="_blank" rel="noreferrer" className="group flex min-w-0 items-center gap-2.5">
                      <span
                        className="h-6 w-6 shrink-0 rounded-full"
                        style={{ background: `linear-gradient(135deg, #${a.user.slice(2, 8)}, #${a.user.slice(-6)})` }}
                      />
                      <span className="min-w-0">
                        {label && <span className="block truncate text-[13px] group-hover:text-accent">{label}</span>}
                        <span className={`mono block truncate ${label ? "text-[11px] text-muted" : "text-[13px] group-hover:text-accent"}`}>
                          {a.user.slice(0, 6)}…{a.user.slice(-4)}
                        </span>
                      </span>
                    </a>
                  </td>
                  <td className="px-1 py-2.5">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${a.yes ? "bg-yes/12 text-yes" : "bg-no/12 text-no"}`}>
                      {a.yes ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="tabular px-1 py-2.5 text-right">${formatUsdc(a.amount, 2)}</td>
                  <td className="tabular px-1 py-2.5 text-right text-muted">{a.price === null ? "—" : `${a.price}¢`}</td>
                  <td className="px-1 py-2.5 text-right">
                    <a className="tabular text-xs text-muted hover:text-text" href={txUrl(a.tx)} target="_blank" rel="noreferrer">
                      {ago(a.t, now)} ↗
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {trades.length > limit && (
        <button className="mt-2 w-full rounded-lg py-2 text-sm text-muted hover:bg-panel hover:text-text" onClick={() => setAll((x) => !x)}>
          {all ? "Show less" : `Show all ${trades.length} trades`}
        </button>
      )}
    </div>
  );
}
