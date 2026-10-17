"use client";

import { useEffect, useState } from "react";
import { fetchEvidence, type Evidence } from "@/lib/agentApi";
import { hashCore } from "@/lib/canonical";
import { OUTCOME, txUrl, type Market } from "@/lib/chain";

const OUT_TR: Record<string, string> = { YES: "EVET", NO: "HAYIR", VOID: "GEÇERSİZ" };

function obsTime(o: Record<string, string>) {
  const ms = o.openTimeMs ?? o.fundingTimeMs;
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
}

/** Kanıt kartı (MIMARI §9): gözlemler, kural, sonuç, hash — hash tarayıcıda yeniden hesaplanır. */
export function EvidenceCard({ m }: { m: Market }) {
  const [ev, setEv] = useState<Evidence | null | undefined>(undefined);
  const proposed = m.status >= 1;

  useEffect(() => {
    if (!proposed) return;
    fetchEvidence(m.id, m.evidenceURI).then(setEv);
  }, [m.id, m.evidenceURI, proposed]);

  if (!proposed) {
    return (
      <div className="card p-4 text-sm text-muted">
        Kanıt, ölçüm zamanından sonra agent sonucu önerdiğinde burada görünecek.
      </div>
    );
  }

  const localHash = ev ? hashCore(ev.core) : null;
  const match = localHash && localHash.toLowerCase() === m.evidenceHash.toLowerCase();

  return (
    <div className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Kanıt</h3>
        <span className="pill pill-final">Önerilen sonuç: {OUTCOME[m.proposedOutcome]}</span>
      </div>

      {ev === undefined && <div className="text-sm text-muted">Kanıt dosyası yükleniyor…</div>}
      {ev === null && (
        <div className="text-sm text-warn">
          Kanıt dosyasına şu an ulaşılamıyor (agent API kapalı olabilir). Zincirdeki hash yine de geçerli; komutla doğrulanabilir.
        </div>
      )}

      {ev && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Rol</th>
                  <th className="py-1 pr-3 font-medium">Kaynak</th>
                  <th className="py-1 pr-3 font-medium">Enstrüman</th>
                  <th className="py-1 pr-3 font-medium">Dakika (TR)</th>
                  <th className="py-1 pr-3 font-medium">Değer</th>
                </tr>
              </thead>
              <tbody className="mono">
                {ev.core.observations.map((o, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-1.5 pr-3">{o.role === "primary" ? "birincil" : "çapraz kontrol"}</td>
                    <td className="py-1.5 pr-3">
                      OKX {o.site} · {o.kind}
                    </td>
                    <td className="py-1.5 pr-3">{o.instId}</td>
                    <td className="py-1.5 pr-3">{obsTime(o)}</td>
                    <td className="py-1.5 pr-3">{o.close ?? o.realizedRate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted">Kural</div>
              <div className="mono text-xs">{ev.core.rule}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Sonuç</div>
              <div className="font-semibold">
                {OUT_TR[ev.core.outcome] ?? ev.core.outcome}
                {ev.core.reason ? ` · ${ev.core.reason}` : ""}
              </div>
            </div>
            {ev.core.crossCheck && (
              <div className="sm:col-span-2">
                <div className="text-xs text-muted">Çapraz kontrol</div>
                <div className="text-xs">
                  Fark {ev.core.crossCheck.diffBps} bps (sınır {ev.core.crossCheck.maxBps}) · referans {ev.core.crossCheck.reference} ·{" "}
                  {ev.core.crossCheck.ok === "true" ? <span className="text-yes">geçti</span> : <span className="text-no">geçmedi</span>}
                </div>
              </div>
            )}
          </div>

          <div className={`rounded-lg border p-3 text-xs ${match ? "border-yes/50 bg-yes/5" : "border-no/50 bg-no/5"}`}>
            <div className="mb-1 font-semibold">{match ? "✅ Bu kanıt dosyası zincirdeki hash ile eşleşiyor" : "❌ Kanıt dosyası zincirdeki hash ile eşleşmiyor"}</div>
            <div className="mono break-all text-muted">zincir: {m.evidenceHash}</div>
            <div className="mono break-all text-muted">tarayıcı: {localHash}</div>
          </div>

          <div>
            <div className="mb-1 text-xs text-muted">Kendin doğrula (OKX verisini yeniden çeker, aynı hash'i üretir)</div>
            <pre className="mono overflow-x-auto rounded-lg bg-panel-2 p-3 text-xs">{`cd agent && npm run verify -- ${m.id}`}</pre>
            <details className="mt-2 text-xs text-muted">
              <summary className="cursor-pointer">Çalıştırılan ATK komutları</summary>
              <pre className="mono mt-2 overflow-x-auto rounded-lg bg-panel-2 p-3">{ev.meta.commands.join("\n")}</pre>
            </details>
          </div>
          {ev.meta.tx && (
            <a className="link text-xs" href={txUrl(ev.meta.tx)} target="_blank" rel="noreferrer">
              Öneri işlemi (Snowtrace)
            </a>
          )}
        </>
      )}
    </div>
  );
}
