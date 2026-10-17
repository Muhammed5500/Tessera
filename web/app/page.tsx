"use client";

import Link from "next/link";
import { useState } from "react";
import { MarketCard } from "@/components/MarketCard";
import { AssetIcon } from "@/components/ui";
import { getAllMarkets, phase, type Market } from "@/lib/chain";
import { useNow, usePoll } from "@/lib/hooks";
import { useLivePrice } from "@/lib/livePrice";

const GRID_TEMPLATE = 3;
const CHIPS = [
  ["all", "All"],
  ["price", "Price"],
  ["funding", "Funding"],
  ["done", "Resolved"],
] as const;
type Chip = (typeof CHIPS)[number][0];

/** Izgaraya giden öne çıkan kart (Polymarket'in "Up or Down" kartları gibi). */
function GridCard({ openSquares }: { openSquares: number }) {
  const { last, open24h } = useLivePrice("BTC-USDT");
  const chg = last && open24h ? ((last.p - open24h) / open24h) * 100 : null;
  return (
    <Link
      href="/grid"
      className="card group flex h-full flex-col justify-between gap-4 p-4 transition-colors hover:border-[#2f3846] hover:bg-panel-2/30"
    >
      <div className="flex items-start gap-3">
        <AssetIcon instId="BTC-USDT" size={38} />
        <h3 className="flex-1 text-[15px] font-medium leading-snug">BTC 3-minute grid</h3>
        <div className="text-right">
          <div className="tabular text-sm font-semibold">
            {last ? `$${last.p.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
          </div>
          {chg !== null && (
            <div className={`tabular text-[11px] ${chg >= 0 ? "text-yes" : "text-no"}`}>
              {chg >= 0 ? "+" : ""}
              {chg.toFixed(2)}%
            </div>
          )}
        </div>
      </div>
      <span className="rounded-lg bg-accent/15 py-2 text-center text-sm font-medium text-accent transition-colors group-hover:bg-accent/25">
        {openSquares ? `${openSquares} open squares` : "Open the grid"}
      </span>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className="flex items-center gap-1 font-medium text-no">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-no" />
          LIVE
        </span>
        · Bitcoin
      </div>
    </Link>
  );
}

export default function Home() {
  const now = useNow();
  const markets = usePoll(getAllMarkets, 10_000);
  const [chip, setChip] = useState<Chip>("all");

  const all = markets.data ?? [];
  const list: Market[] = all
    .filter((m) => m.templateId !== GRID_TEMPLATE)
    .filter((m) => {
      const final = phase(m, now).tone === "final";
      if (chip === "done") return final;
      if (final) return false;
      if (chip === "price") return m.templateId === 1;
      if (chip === "funding") return m.templateId === 2;
      return true;
    })
    .sort((a, b) => (chip === "done" ? Number(b.id - a.id) : a.closeTime - b.closeTime));
  const openSquares = all.filter((m) => m.templateId === GRID_TEMPLATE && now < m.closeTime).length;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Crypto</h1>
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {CHIPS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setChip(k)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              chip === k ? "bg-text font-medium text-bg" : "bg-panel-2 text-muted hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
        <Link href="/grid" className="shrink-0 rounded-full bg-panel-2 px-3.5 py-1.5 text-sm text-muted hover:text-text">
          Live grid
        </Link>
      </div>

      {markets.error && !markets.data && <div className="mt-6 text-sm text-no">Couldn&apos;t read the chain — retrying…</div>}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {chip === "all" && <GridCard openSquares={openSquares} />}
        {!markets.data && [0, 1, 2, 3, 4].map((i) => <div key={i} className="card h-[150px] animate-pulse" />)}
        {list.map((m) => (
          <MarketCard key={m.id.toString()} m={m} now={now} />
        ))}
      </div>
      {markets.data && list.length === 0 && chip !== "all" && (
        <div className="py-16 text-center text-sm text-muted">No markets here yet.</div>
      )}
    </div>
  );
}
