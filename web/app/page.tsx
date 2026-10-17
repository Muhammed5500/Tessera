"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MarketCard } from "@/components/MarketCard";
import { getMeta, getStats } from "@/lib/agentApi";
import { getAllMarkets, phase, type Market } from "@/lib/chain";
import { useNow, usePoll } from "@/lib/hooks";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export default function Home() {
  const now = useNow();
  const markets = usePoll(getAllMarkets, 10_000);
  const stats = usePoll(getStats, 10_000);
  const [agentP, setAgentP] = useState<Record<string, number>>({});

  // Agent'ın olasılık tahminleri (meta) — bir kez çekilir
  useEffect(() => {
    for (const m of markets.data ?? []) {
      const k = m.id.toString();
      if (k in agentP) continue;
      getMeta(k).then((meta) => setAgentP((x) => ({ ...x, [k]: meta?.myProbability ?? NaN })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markets.data]);

  const list = [...(markets.data ?? [])].sort((a, b) => Number(b.id - a.id));
  const groups: Record<string, Market[]> = { open: [], pending: [], done: [] };
  for (const m of list) {
    const t = phase(m, now).tone;
    if (t === "open") groups.open.push(m);
    else if (t === "final") groups.done.push(m);
    else groups.pending.push(m);
  }
  const s = stats.data;
  const p = (m: Market) => {
    const v = agentP[m.id.toString()];
    return v === undefined || Number.isNaN(v) ? undefined : v;
  };

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold sm:text-3xl">Agent açar, OKX verisiyle çözer, Avalanche'ta kanıtlar.</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          KAHİN'in agent'ı OKX Agent Trade Kit ile piyasayı tarar ve kısa vadeli olasılık marketleri açar. Süre dolunca sonucu
          OKX'in geçmiş verisiyle hesaplar ve kanıtın hash'ini zincire yazar. Sonucu herkes tekrar hesaplayıp doğrulayabilir.
        </p>
        <Link
          href="/grid"
          className="card mt-4 flex items-center justify-between gap-3 border-accent/50 bg-accent/10 p-4 transition hover:bg-accent/15"
        >
          <div>
            <div className="font-semibold text-accent">Canlı ızgara · BTC-USDT</div>
            <div className="text-sm text-muted">Fiyat canlı akarken önündeki karelere tıkla: her kare "3 dakika sonra bu aralıkta mı?" sorusu.</div>
          </div>
          <span className="btn btn-accent shrink-0">Oyna →</span>
        </Link>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Açılan market" value={markets.data ? String(markets.data.length) : "…"} />
        <Stat label="Kesinleşen" value={markets.data ? String(groups.done.length) : "…"} />
        <Stat label="ATK çağrısı" value={s ? String(s.atk.totalCalls) : "—"} hint={s ? `${s.atk.distinctTools} farklı araç` : "agent erişilemiyor"} />
        <Stat
          label="Ort. onay süresi"
          value={s?.chain.avgConfirmMs ? `${(s.chain.avgConfirmMs / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn` : "—"}
          hint="Avalanche Fuji"
        />
      </section>

      {markets.error && !markets.data && <div className="card p-4 text-sm text-no">Zincirden okunamadı: {markets.error}</div>}
      {markets.loading && !markets.data && <div className="text-sm text-muted">Marketler yükleniyor…</div>}

      {(
        [
          ["open", "Tahmine açık"],
          ["pending", "Çözüm aşamasında"],
          ["done", "Kesinleşenler"],
        ] as const
      ).map(([key, title]) =>
        groups[key].length ? (
          <section key={key}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
              {title} · {groups[key].length}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {groups[key].map((m) => (
                <MarketCard key={m.id.toString()} m={m} now={now} agentP={p(m)} />
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}
