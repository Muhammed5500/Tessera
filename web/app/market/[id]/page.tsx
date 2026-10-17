"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BetPanel } from "@/components/BetPanel";
import { EvidenceCard } from "@/components/EvidenceCard";
import { ProbChart } from "@/components/ProbChart";
import { AssetIcon } from "@/components/ui";
import { getMeta, type MarketMeta } from "@/lib/agentApi";
import { describeParams, formatTR, formatUsdc, getMarket, impliedYes, readContractParams, txUrl } from "@/lib/chain";
import { getProbHistory, type ProbPoint } from "@/lib/history";
import { formatDuration, useNow, usePoll } from "@/lib/hooks";

const RULE_FALLBACK: Record<number, string> = {
  1: "Ölçüm anındaki OKX 1 dakikalık mum kapanışı eşiğin üstündeyse EVET, değilse HAYIR. İkinci kaynakla %0,5'ten fazla fark varsa market geçersiz sayılır.",
  2: "Belirtilen ödeme zamanında gerçekleşen OKX funding oranı sıfırdan büyükse EVET, değilse HAYIR.",
  3: "Ölçüm anındaki OKX 1 dakikalık mum kapanışı aralığın içindeyse EVET, değilse HAYIR.",
};

const CATEGORY: Record<number, string> = { 1: "Fiyat", 2: "Funding", 3: "Izgara" };

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const marketId = BigInt(id);
  const now = useNow();
  const market = usePoll(() => getMarket(marketId), 8_000, [id]);
  const params = usePoll(readContractParams, 60_000);
  const [meta, setMeta] = useState<MarketMeta | null | undefined>(undefined);
  const [hist, setHist] = useState<ProbPoint[] | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [tab, setTab] = useState<"evidence" | "agent">("evidence");

  useEffect(() => {
    getMeta(id).then(setMeta);
  }, [id]);

  const m = market.data;
  const poolKey = m ? `${m.yesPool}-${m.noPool}` : "";
  useEffect(() => {
    if (!m) return;
    getProbHistory(m)
      .then(setHist)
      .catch(() => setHist([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, poolKey]);

  if (!m) {
    return (
      <div className="space-y-4">
        <div className="h-11 w-full max-w-xl animate-pulse rounded-lg bg-panel" />
        <div className="h-60 w-full animate-pulse rounded-lg bg-panel" />
        {market.error && <div className="text-sm text-no">Market okunamadı. Sayfayı yenile.</div>}
      </div>
    );
  }

  const yes = impliedYes(m);
  const desc = describeParams(m.templateId, m.params);
  const p = params.data;
  const total = m.yesPool + m.noPool;
  const open = m.status === 0 && now < m.closeTime;
  const final = m.status === 3;
  const first = hist?.[0]?.yes;
  const delta = yes !== null && first !== undefined ? yes - first : null;
  const rule = meta?.rule ?? RULE_FALLBACK[m.templateId] ?? "—";

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* üst: başlık + grafik */}
      <div className="min-w-0 lg:col-start-1">
        <div className="flex items-start gap-3">
          <AssetIcon instId={desc.enstrüman} />
          <div className="min-w-0">
            <div className="text-xs text-muted">
              <Link href={m.templateId === 3 ? "/grid" : "/"} className="hover:text-text">
                {CATEGORY[m.templateId] ?? "Market"}
              </Link>
              {desc.enstrüman && ` · ${desc.enstrüman.split("-")[0]}`}
            </div>
            <h1 className="mt-0.5 text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{m.question}</h1>
          </div>
        </div>

        <div className="mt-5 flex items-baseline gap-3">
          {final ? (
            <span
              className={`text-2xl font-semibold ${m.finalOutcome === 1 ? "text-yes" : m.finalOutcome === 2 ? "text-no" : "text-muted"}`}
            >
              Sonuç: {["—", "Evet", "Hayır", "Geçersiz"][m.finalOutcome]}
            </span>
          ) : (
            <span className="tabular text-2xl font-semibold text-info">{yes === null ? "—" : `%${yes.toFixed(0)} şans`}</span>
          )}
          {!final && delta !== null && Math.abs(delta) >= 1 && (
            <span className={`tabular text-sm ${delta > 0 ? "text-yes" : "text-no"}`}>
              {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%
            </span>
          )}
        </div>

        <div className="mt-3">
          {hist === null ? (
            <div className="h-[240px] animate-pulse rounded-lg bg-panel" />
          ) : (
            <ProbChart points={hist} start={m.createdAt} end={Math.min(now, m.closeTime)} />
          )}
        </div>

        <div className="tabular mt-3 flex flex-wrap gap-x-5 gap-y-1 border-b border-line pb-4 text-sm text-muted">
          <span>{formatUsdc(total)} kUSDC hacim</span>
          <span>{open ? `${formatDuration(m.closeTime - now)} kaldı` : `Bitiş ${formatTR(m.closeTime)}`}</span>
          {meta?.myProbability !== undefined && <span>Agent tahmini %{Math.round(meta.myProbability * 100)}</span>}
        </div>
      </div>

      {/* işlem paneli */}
      <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="lg:sticky lg:top-20">
          {p ? (
            <BetPanel m={m} now={now} disputeWindow={p.disputeWindow} disputeBond={p.disputeBond} feeBps={p.feeBps} onDone={market.refresh} />
          ) : (
            <div className="card h-72 animate-pulse" />
          )}
        </div>
      </aside>

      {/* alt: kurallar + kanıt */}
      <div className="min-w-0 space-y-6 lg:col-start-1">
        <section>
          <h2 className="text-base font-semibold">Kurallar</h2>
          <p className={`mt-2 text-sm leading-relaxed text-[#c9d1dc] ${ruleOpen ? "" : "line-clamp-2"}`}>{rule}</p>
          <button className="mt-1 text-sm text-muted hover:text-text" onClick={() => setRuleOpen((x) => !x)}>
            {ruleOpen ? "Daha az" : "Daha fazla"}
          </button>
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-line px-4 py-3 text-sm">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-accent/15">
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
                <circle cx="12" cy="12" r="4" fill="var(--accent)" />
              </svg>
            </span>
            <div className="min-w-0">
              <div className="text-xs text-muted">Çözümleyen</div>
              <div>KAHİN agent · OKX verisi · Avalanche&apos;ta kanıt</div>
            </div>
            {m.status >= 1 && (
              <Link href="/verify" className="ml-auto shrink-0 text-xs text-muted hover:text-text">
                Doğrula →
              </Link>
            )}
          </div>
        </section>

        <section>
          <div className={`mb-3 flex gap-5 border-b border-line ${m.templateId === 3 ? "hidden" : ""}`}>
            {(
              [
                ["evidence", "Kanıt"],
                ["agent", "Agent'ın notu"],
              ] as const
            )
              .filter(([k]) => k !== "agent" || m.templateId !== 3)
              .map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`-mb-px border-b-2 pb-2.5 text-sm ${tab === k ? "border-text font-medium" : "border-transparent text-muted hover:text-text"}`}
                >
                  {label}
                </button>
              ))}
          </div>
          {tab === "evidence" && <EvidenceCard m={m} />}
          {tab === "agent" && (
            <div className="text-sm leading-relaxed text-[#c9d1dc]">
              {meta === undefined && <span className="text-muted">Yükleniyor…</span>}
              {meta === null && <span className="text-muted">Agent şu an çevrim dışı.</span>}
              {meta && <p>{meta.rationale_tr}</p>}
              {meta?.createdTx && (
                <a className="mt-2 inline-block text-xs text-muted hover:text-text" href={txUrl(meta.createdTx)} target="_blank" rel="noreferrer">
                  Açılış işlemi ↗
                </a>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
