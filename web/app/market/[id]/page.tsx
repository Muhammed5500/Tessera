"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BetPanel } from "@/components/BetPanel";
import { EvidenceCard } from "@/components/EvidenceCard";
import { OddsBar, PhasePill } from "@/components/MarketCard";
import { getMeta, type MarketMeta } from "@/lib/agentApi";
import { describeParams, formatTR, formatUsdc, getMarket, impliedYes, readContractParams, txUrl } from "@/lib/chain";
import { formatDuration, useNow, usePoll } from "@/lib/hooks";

const RULE_FALLBACK: Record<number, string> = {
  1: "OKX 1 dakikalık mumunun ölçüm anındaki kapanış fiyatı eşikten büyükse EVET, değilse HAYIR. İkinci kaynakla %0,5'ten fazla fark varsa market geçersiz sayılır.",
  2: "OKX perp için belirtilen ödeme zamanında gerçekleşen funding oranı sıfırdan büyükse EVET, değilse HAYIR.",
  3: "OKX 1 dakikalık mumunun ölçüm anındaki kapanış fiyatı aralığın içindeyse (alt sınır dahil, üst sınır hariç) EVET, değilse HAYIR.",
};

const PARAM_LABEL: Record<string, string> = { site: "OKX sitesi", enstrüman: "Enstrüman", eşik: "Eşik", aralık: "Aralık", "funding zamanı": "Funding zamanı" };

function shortTool(name: string) {
  return name.replace(/^mcp__okx_/, "").replace(/^(global|tr)__/, "$1 · ").replace("__", " · ");
}

function AssetIcon({ instId }: { instId?: string }) {
  const base = instId?.split("-")[0] ?? "";
  const color = base === "BTC" ? "#f7931a" : base === "ETH" ? "#627eea" : base === "SOL" ? "#14f195" : "#3a4350";
  const glyph = base === "BTC" ? "₿" : base === "ETH" ? "Ξ" : base.slice(0, 1) || "?";
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg font-bold text-white" style={{ background: color }}>
      {glyph}
    </span>
  );
}

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const marketId = BigInt(id);
  const now = useNow();
  const market = usePoll(() => getMarket(marketId), 8_000, [id]);
  const params = usePoll(readContractParams, 60_000);
  const [meta, setMeta] = useState<MarketMeta | null | undefined>(undefined);
  const [showTrace, setShowTrace] = useState(false);

  useEffect(() => {
    getMeta(id).then(setMeta);
  }, [id]);

  const m = market.data;
  if (!m) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-40 animate-pulse rounded bg-panel" />
        <div className="h-10 w-full max-w-xl animate-pulse rounded bg-panel" />
        {market.error && <div className="text-sm text-no">Market okunamadı. Bağlantını kontrol edip sayfayı yenile.</div>}
      </div>
    );
  }
  const yes = impliedYes(m);
  const desc = describeParams(m.templateId, m.params);
  const p = params.data;
  const total = m.yesPool + m.noPool;
  const agentP = meta?.myProbability;
  const open = m.status === 0 && now < m.closeTime;

  const steps = [
    { label: "Açıldı", at: m.createdAt, done: true },
    { label: "Tahminler kapanır", at: m.closeTime, done: now >= m.closeTime },
    { label: "Ölçüm", at: m.resolveTime, done: now >= m.resolveTime },
    { label: "Sonuç önerildi", at: m.proposedAt || undefined, done: m.status >= 1 },
    { label: "Kesinleşti", at: m.status === 3 && p ? m.proposedAt + p.disputeWindow : undefined, done: m.status === 3 },
  ];

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm text-muted">
        <Link href={m.templateId === 3 ? "/grid" : "/"} className="hover:text-text">
          {m.templateId === 3 ? "Canlı ızgara" : "Marketler"}
        </Link>
        <span>/</span>
        <span className="tabular">#{id}</span>
      </nav>

      <header className="flex items-start gap-4">
        <AssetIcon instId={desc.enstrüman} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{m.question}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <PhasePill m={m} now={now} />
            <span className="tabular">{formatUsdc(total)} kUSDC hacim</span>
            <span className="tabular">{open ? `${formatDuration(m.closeTime - now)} sonra kapanıyor` : `Ölçüm ${formatTR(m.resolveTime)}`}</span>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {/* olasılık */}
          <div className="card p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="tabular text-4xl font-semibold tracking-tight text-yes">{yes === null ? "—" : `%${yes.toFixed(0)}`}</div>
                <div className="mt-1 text-sm text-muted">{yes === null ? "Henüz tahmin yok" : "evet olasılığı (havuz oranı)"}</div>
              </div>
              {agentP !== undefined && (
                <div className="text-right">
                  <div className="tabular text-xl font-semibold">%{Math.round(agentP * 100)}</div>
                  <div className="mt-0.5 text-xs text-muted">agent&apos;ın tahmini</div>
                </div>
              )}
            </div>
            <div className="mt-5">
              <OddsBar yes={yes} />
              <div className="tabular mt-2 flex justify-between text-xs text-muted">
                <span>
                  <span className="text-yes">Evet</span> · {formatUsdc(m.yesPool)} kUSDC
                </span>
                <span>
                  {formatUsdc(m.noPool)} kUSDC · <span className="text-no">Hayır</span>
                </span>
              </div>
            </div>
          </div>

          {/* kural */}
          <section>
            <h2 className="mb-2 text-[15px] font-medium">Nasıl sonuçlanır?</h2>
            <p className="text-sm leading-relaxed text-muted">{meta?.rule ?? RULE_FALLBACK[m.templateId] ?? "—"}</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              {Object.entries(desc)
                .filter(([k]) => k !== "şablon")
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted">{PARAM_LABEL[k] ?? k}</dt>
                    <dd className="tabular mt-0.5">{v}</dd>
                  </div>
                ))}
              <div>
                <dt className="text-xs text-muted">Tahmin kapanışı</dt>
                <dd className="tabular mt-0.5">{formatTR(m.closeTime)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Ölçüm</dt>
                <dd className="tabular mt-0.5">{formatTR(m.resolveTime)}</dd>
              </div>
            </dl>
          </section>

          {/* süreç */}
          <section>
            <h2 className="mb-3 text-[15px] font-medium">Süreç</h2>
            <ol className="grid grid-cols-5 gap-1">
              {steps.map((s) => (
                <li key={s.label} className="min-w-0">
                  <div className={`h-1 rounded-full ${s.done ? "bg-accent" : "bg-line"}`} />
                  <div className={`mt-2 truncate text-xs ${s.done ? "text-text" : "text-muted"}`}>{s.label}</div>
                  <div className="tabular truncate text-[11px] text-muted">{s.at ? formatTR(s.at).split(" ").at(-1) : "—"}</div>
                </li>
              ))}
            </ol>
          </section>

          {/* gerekçe */}
          {m.templateId !== 3 && (
            <section className="card p-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-[15px] font-medium">Agent bu marketi neden açtı?</h2>
                {meta?.model && <span className="text-xs text-muted">{meta.model}</span>}
              </div>
              {meta === undefined && <p className="text-sm text-muted">Yükleniyor…</p>}
              {meta === null && <p className="text-sm text-muted">Agent şu an çevrim dışı; gerekçe gösterilemiyor.</p>}
              {meta && <p className="text-sm leading-relaxed text-[#c9d1dc]">{meta.rationale_tr}</p>}
              {meta?.toolTrace && meta.toolTrace.length > 0 && (
                <div className="mt-4">
                  <button className="text-xs text-muted hover:text-text" onClick={() => setShowTrace((x) => !x)}>
                    {showTrace ? "Veri çağrılarını gizle" : `Kullandığı ${meta.toolTrace.length} OKX veri çağrısını göster`}
                  </button>
                  {showTrace && (
                    <ol className="mt-2 divide-y divide-line rounded-lg border border-line">
                      {meta.toolTrace.map((t, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                          <span className="mono min-w-0 truncate">
                            {shortTool(t.tool)} <span className="text-muted">{JSON.stringify(t.args)}</span>
                          </span>
                          <span className={`tabular shrink-0 ${t.ok ? "text-muted" : "text-no"}`}>{t.ms} ms</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
              {meta?.createdTx && (
                <a className="mt-3 inline-block text-xs text-muted hover:text-text" href={txUrl(meta.createdTx)} target="_blank" rel="noreferrer">
                  Açılış işlemi ↗
                </a>
              )}
            </section>
          )}

          <EvidenceCard m={m} />
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          {p ? (
            <BetPanel m={m} now={now} disputeWindow={p.disputeWindow} disputeBond={p.disputeBond} feeBps={p.feeBps} onDone={market.refresh} />
          ) : (
            <div className="card h-64 animate-pulse" />
          )}
        </aside>
      </div>
    </div>
  );
}
