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
};

function shortTool(name: string) {
  return name.replace(/^mcp__okx_/, "").replace(/^(global|tr)__/, "$1 · ").replace("__", " · ");
}

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const marketId = BigInt(id);
  const now = useNow();
  const market = usePoll(() => getMarket(marketId), 8_000, [id]);
  const params = usePoll(readContractParams, 60_000);
  const [meta, setMeta] = useState<MarketMeta | null | undefined>(undefined);

  useEffect(() => {
    getMeta(id).then(setMeta);
  }, [id]);

  const m = market.data;
  if (!m) {
    return <div className="text-sm text-muted">{market.error ? `Market okunamadı: ${market.error}` : "Yükleniyor…"}</div>;
  }
  const yes = impliedYes(m);
  const desc = describeParams(m.templateId, m.params);
  const p = params.data;

  const steps = [
    { label: "Açıldı", at: m.createdAt, done: true },
    { label: "Tahminler kapanır", at: m.closeTime, done: now >= m.closeTime },
    { label: "Ölçüm", at: m.resolveTime, done: now >= m.resolveTime },
    { label: "Agent sonucu önerdi", at: m.proposedAt || undefined, done: m.status >= 1 },
    { label: "Kesinleşti", at: m.status === 3 && p ? m.proposedAt + p.disputeWindow : undefined, done: m.status === 3 },
  ];

  return (
    <div className="space-y-5">
      <Link href="/" className="text-sm text-muted hover:text-text">
        ← Marketler
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-xs text-muted">#{id}</span>
        <PhasePill m={m} now={now} />
        <span className="pill">{desc.şablon}</span>
      </div>
      <h1 className="text-xl font-bold leading-snug sm:text-2xl">{m.question}</h1>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <div className="card space-y-3 p-4">
            <OddsBar yes={yes} />
            <div className="flex items-center justify-between text-sm">
              <span className="text-yes">
                EVET {yes === null ? "—" : `%${yes.toFixed(1)}`} · {formatUsdc(m.yesPool)}
              </span>
              <span className="text-no">
                {formatUsdc(m.noPool)} · HAYIR {yes === null ? "—" : `%${(100 - yes).toFixed(1)}`}
              </span>
            </div>
            {meta?.myProbability !== undefined && (
              <div className="text-xs text-muted">
                Agent'ın EVET tahmini: <span className="text-accent">%{Math.round(meta.myProbability * 100)}</span> · havuzdaki oran katılımcıların
                tahminlerinden oluşur
              </div>
            )}
            {m.status === 0 && now < m.closeTime && (
              <div className="text-xs text-muted">Tahmin kapanışına {formatDuration(m.closeTime - now)}</div>
            )}
          </div>

          <div className="card space-y-2 p-4">
            <h3 className="font-semibold">Kural</h3>
            <p className="text-sm text-muted">{meta?.rule ?? RULE_FALLBACK[m.templateId] ?? "—"}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {Object.entries(desc)
                .filter(([k]) => k !== "şablon")
                .map(([k, v]) => (
                  <span key={k} className="pill">
                    {k}: <span className="mono text-text">{v}</span>
                  </span>
                ))}
            </div>
          </div>

          <div className="card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Agent neden açtı?</h3>
              {meta?.model && <span className="pill">{meta.model}</span>}
            </div>
            {meta === undefined && <p className="text-sm text-muted">Yükleniyor…</p>}
            {meta === null && <p className="text-sm text-muted">Agent API'ye ulaşılamıyor; gerekçe şu an gösterilemiyor.</p>}
            {meta && <p className="text-sm leading-relaxed">{meta.rationale_tr}</p>}
            {meta?.toolTrace && meta.toolTrace.length > 0 && (
              <div>
                <div className="mb-1 text-xs text-muted">Agent'ın kendi seçtiği ATK araç çağrıları</div>
                <ol className="space-y-1">
                  {meta.toolTrace.map((t, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-md bg-panel-2 px-2.5 py-1.5 text-xs">
                      <span className="mono">
                        {i + 1}. {shortTool(t.tool)} <span className="text-muted">{JSON.stringify(t.args)}</span>
                      </span>
                      <span className={t.ok ? "text-muted" : "text-no"}>{t.ms} ms</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {meta?.createdTx && (
              <a className="link text-xs" href={txUrl(meta.createdTx)} target="_blank" rel="noreferrer">
                Market açılış işlemi (Snowtrace)
              </a>
            )}
          </div>

          <EvidenceCard m={m} />
        </div>

        <div className="space-y-5">
          {p && (
            <BetPanel m={m} now={now} disputeWindow={p.disputeWindow} disputeBond={p.disputeBond} feeBps={p.feeBps} onDone={market.refresh} />
          )}
          <div className="card p-4">
            <h3 className="mb-3 font-semibold">Zaman çizelgesi</h3>
            <ol className="space-y-2.5">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-3 text-sm">
                  <span className={`h-2.5 w-2.5 rounded-full ${s.done ? "bg-accent" : "bg-line"}`} />
                  <span className={s.done ? "" : "text-muted"}>{s.label}</span>
                  <span className="mono ml-auto text-xs text-muted">{s.at ? formatTR(s.at) : "—"}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
