"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MarketCard } from "@/components/MarketCard";
import { getMeta, getStats } from "@/lib/agentApi";
import { getAllMarkets, phase, type Market } from "@/lib/chain";
import { useNow, usePoll } from "@/lib/hooks";
import { useLivePrice } from "@/lib/livePrice";

const GRID_TEMPLATE = 3;
const TABS = [
  ["open", "Açık"],
  ["pending", "Sonuç bekleyen"],
  ["done", "Sonuçlanan"],
] as const;
type Tab = (typeof TABS)[number][0];

function LiveBtc({ openSquares }: { openSquares: number }) {
  const { last, open24h, status } = useLivePrice("BTC-USDT");
  const chg = last && open24h ? ((last.p - open24h) / open24h) * 100 : null;
  return (
    <Link
      href="/grid"
      className="card group relative flex flex-col justify-between gap-5 overflow-hidden p-5 transition-colors hover:border-[#2f3846]"
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-[#f7931a] text-[13px] font-bold text-white">₿</span>
        <span className="font-medium">Bitcoin · 3 dakikalık ızgara</span>
        {status === "live" && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yes opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yes" />
            </span>
            canlı
          </span>
        )}
      </div>
      <div>
        <div className="tabular text-3xl font-semibold tracking-tight sm:text-4xl">
          {last ? `$${last.p.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : "—"}
        </div>
        {chg !== null && (
          <div className={`tabular mt-1 text-sm ${chg >= 0 ? "text-yes" : "text-no"}`}>
            {chg >= 0 ? "+" : ""}
            {chg.toFixed(2)}% · 24 saat
          </div>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className="max-w-xs text-sm text-muted">
          Fiyat 3 dakika sonra hangi 50 $'lık aralıkta kapanacak? Kareyi seç, tahminini koy.
        </p>
        <span className="btn btn-accent shrink-0">
          {openSquares ? `${openSquares} açık kare` : "Izgaraya git"}
          <span className="transition-transform group-hover:translate-x-0.5">→</span>
        </span>
      </div>
    </Link>
  );
}

export default function Home() {
  const now = useNow();
  const markets = usePoll(getAllMarkets, 10_000);
  const stats = usePoll(getStats, 10_000);
  const [agentP, setAgentP] = useState<Record<string, number>>({});
  const [picked, setTab] = useState<Tab | null>(null);
  const [showGrid, setShowGrid] = useState(false);

  const all = markets.data ?? [];
  const nonGrid = all.filter((m) => m.templateId !== GRID_TEMPLATE);

  // Agent'ın olasılık tahminleri (meta) — ızgara dışı marketler için bir kez çekilir
  useEffect(() => {
    for (const m of nonGrid) {
      const k = m.id.toString();
      if (k in agentP) continue;
      getMeta(k).then((meta) => setAgentP((x) => ({ ...x, [k]: meta?.myProbability ?? NaN })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets.data]);

  const groups: Record<Tab, Market[]> = { open: [], pending: [], done: [] };
  for (const m of [...(showGrid ? all : nonGrid)].sort((a, b) => Number(b.id - a.id))) {
    const t = phase(m, now).tone;
    groups[t === "open" ? "open" : t === "final" ? "done" : "pending"].push(m);
  }
  const openSquares = all.filter((m) => m.templateId === GRID_TEMPLATE && now < m.closeTime).length;
  const p = (m: Market) => {
    const v = agentP[m.id.toString()];
    return v === undefined || Number.isNaN(v) ? undefined : v;
  };
  const s = stats.data;
  // Kullanıcı seçmediyse ilk dolu sekme
  const tab: Tab = picked ?? (groups.open.length ? "open" : groups.pending.length ? "pending" : groups.done.length ? "done" : "open");
  const list = groups[tab];

  return (
    <div className="space-y-10">
      <section className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col justify-center py-2">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Kısa vadeli kripto tahminleri.
            <br />
            <span className="text-muted">Sonucu herkes doğrulayabilir.</span>
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
            Marketleri bir agent açar, süre dolunca sonucu OKX verisinden hesaplar ve kanıtını Avalanche&apos;a yazar. Kimseye
            güvenmen gerekmiyor — <Link className="text-text underline-offset-4 hover:underline" href="/verify">kendin kontrol et</Link>.
          </p>
          <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <div>
              <dt className="text-muted">Market</dt>
              <dd className="tabular mt-0.5 text-lg font-semibold">{markets.data ? all.length : "…"}</dd>
            </div>
            <div>
              <dt className="text-muted">Sonuçlanan</dt>
              <dd className="tabular mt-0.5 text-lg font-semibold">
                {markets.data ? all.filter((m) => m.status === 3).length : "…"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Zincir onayı</dt>
              <dd className="tabular mt-0.5 text-lg font-semibold">
                {s?.chain.avgConfirmMs ? `${(s.chain.avgConfirmMs / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn` : "—"}
              </dd>
            </div>
          </dl>
        </div>
        <LiveBtc openSquares={openSquares} />
      </section>

      <section>
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
            <MarketCard key={m.id.toString()} m={m} now={now} agentP={p(m)} />
          ))}
        </div>
      </section>
    </div>
  );
}
