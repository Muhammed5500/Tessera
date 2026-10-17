"use client";

import Link from "next/link";
import { useState } from "react";
import { MarketCard } from "@/components/MarketCard";
import { getAllMarkets, phase, type Market } from "@/lib/chain";
import { useNow, usePoll } from "@/lib/hooks";
import { useLivePrice } from "@/lib/livePrice";
import { AssetIcon, LiveDot } from "@/components/ui";

const GRID_TEMPLATE = 3;
const TABS = [
  ["open", "Açık"],
  ["pending", "Sonuç bekleyen"],
  ["done", "Sonuçlanan"],
] as const;
type Tab = (typeof TABS)[number][0];

function LiveBtc({ openSquares }: { openSquares: number }) {
  const { last, open24h } = useLivePrice("BTC-USDT");
  const chg = last && open24h ? ((last.p - open24h) / open24h) * 100 : null;
  return (
    <Link
      href="/grid"
      className="card group flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 transition-colors hover:border-[#2f3846]"
    >
      <AssetIcon instId="BTC-USDT" size={38} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[15px] font-medium">
          BTC 3 dakikalık ızgara <LiveDot />
        </div>
        <div className="text-xs text-muted">Her 3 dakikada yeni kareler · fiyat hangi aralıkta kapanır?</div>
      </div>
      <div className="ml-auto flex items-center gap-5">
        <div className="text-right">
          <div className="tabular text-lg font-semibold">
            {last ? `$${last.p.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : "—"}
          </div>
          {chg !== null && (
            <div className={`tabular text-xs ${chg >= 0 ? "text-yes" : "text-no"}`}>
              {chg >= 0 ? "+" : ""}
              {chg.toFixed(2)}%
            </div>
          )}
        </div>
        <span className="btn btn-accent">
          {openSquares ? `${openSquares} açık kare` : "Oyna"}
          <span className="transition-transform group-hover:translate-x-0.5">→</span>
        </span>
      </div>
    </Link>
  );
}

export default function Home() {
  const now = useNow();
  const markets = usePoll(getAllMarkets, 10_000);
  const [picked, setTab] = useState<Tab | null>(null);
  const [showGrid, setShowGrid] = useState(false);

  const all = markets.data ?? [];
  const nonGrid = all.filter((m) => m.templateId !== GRID_TEMPLATE);

  const groups: Record<Tab, Market[]> = { open: [], pending: [], done: [] };
  for (const m of [...(showGrid ? all : nonGrid)].sort((a, b) => Number(b.id - a.id))) {
    const t = phase(m, now).tone;
    groups[t === "open" ? "open" : t === "final" ? "done" : "pending"].push(m);
  }
  const openSquares = all.filter((m) => m.templateId === GRID_TEMPLATE && now < m.closeTime).length;
  // Kullanıcı seçmediyse ilk dolu sekme
  const tab: Tab = picked ?? (groups.open.length ? "open" : groups.pending.length ? "pending" : groups.done.length ? "done" : "open");
  const list = groups[tab];

  return (
    <div className="space-y-8">
      <LiveBtc openSquares={openSquares} />

      <section>
        <h2 className="mb-3 text-lg font-semibold">Marketler</h2>
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`-mb-px border-b-2 pb-2.5 text-sm transition-colors ${
                tab === k ? "border-text font-medium text-text" : "border-transparent text-muted hover:text-text"
              }`}
            >
              {label}
              <span className="tabular ml-1.5 text-xs text-muted">{groups[k].length}</span>
            </button>
          ))}
          <label className="mb-2 ml-auto flex cursor-pointer select-none items-center gap-2 text-xs text-muted">
            <input type="checkbox" className="accent-[var(--accent)]" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
            Izgara karelerini de göster
          </label>
        </div>

        {markets.error && !markets.data && (
          <div className="card p-4 text-sm text-no">Zincirden okunamadı. Birkaç saniye sonra tekrar denenecek.</div>
        )}
        {markets.loading && !markets.data && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card h-40 animate-pulse bg-panel" />
            ))}
          </div>
        )}
        {markets.data && list.length === 0 && (
          <div className="card px-5 py-10 text-center text-sm text-muted">
            {tab === "open" ? (
              <>
                Şu an açık market yok.{" "}
                <Link href="/grid" className="text-text underline-offset-4 hover:underline">
                  Canlı ızgarada
                </Link>{" "}
                her 3 dakikada yeni kareler açılıyor.
              </>
            ) : (
              "Bu sekmede market yok."
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((m) => (
            <MarketCard key={m.id.toString()} m={m} now={now} />
          ))}
        </div>
      </section>
    </div>
  );
}
