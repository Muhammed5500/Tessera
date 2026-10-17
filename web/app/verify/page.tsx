"use client";

import Link from "next/link";
import { useState } from "react";
import { CodeBlock, PageHeader } from "@/components/ui";
import { fetchEvidence } from "@/lib/agentApi";
import { canonicalJSON, hashCore } from "@/lib/canonical";
import { getAllMarkets, OUTCOME, type Market } from "@/lib/chain";
import { usePoll } from "@/lib/hooks";

type Result = { market: Market; canonical: string; localHash: string; match: boolean; outcome: string; commands: string[] };

const OUT_TR: Record<string, string> = { YES: "EVET", NO: "HAYIR", VOID: "GEÇERSİZ" };

export default function VerifyPage() {
  const markets = usePoll(getAllMarkets, 30_000);
  const [selected, setSelected] = useState<string>("");
  const [pasted, setPasted] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resolved = (markets.data ?? []).filter((m) => m.status >= 1).sort((a, b) => Number(b.id - a.id));

  async function run(id = selected) {
    setErr(null);
    setResult(null);
    const m = resolved.find((x) => x.id.toString() === id);
    if (!m) return setErr("Bir market seç.");
    setLoading(true);
    try {
      let core: Record<string, unknown>;
      let commands: string[] = [];
      if (pasted.trim()) {
        const j = JSON.parse(pasted);
        core = j.core ?? j;
        commands = j.meta?.commands ?? [];
      } else {
        const ev = await fetchEvidence(m.id, m.evidenceURI);
        if (!ev) throw new Error("Kanıt dosyasına ulaşılamadı. JSON'u kendin yapıştırarak da doğrulayabilirsin.");
        core = ev.core;
        commands = ev.meta.commands;
      }
      const localHash = hashCore(core);
      setResult({
        market: m,
        canonical: canonicalJSON(core),
        localHash,
        match: localHash.toLowerCase() === m.evidenceHash.toLowerCase(),
        outcome: OUT_TR[String(core.outcome)] ?? String(core.outcome ?? "?"),
        commands,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader title="Doğrula">
        Kanıt dosyasının parmak izini zincirdekiyle karşılaştır.
      </PageHeader>

      <div className="card space-y-4 p-5">
        <div>
          <label className="mb-1.5 block text-xs text-muted">Market</label>
          <select
            className="field"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              if (e.target.value && !pasted.trim()) run(e.target.value);
            }}
          >
            <option value="">{markets.data ? `Sonuçlanmış ${resolved.length} market arasından seç…` : "Yükleniyor…"}</option>
            {resolved.map((m) => (
              <option key={m.id.toString()} value={m.id.toString()}>
                #{m.id.toString()} · {m.question}
              </option>
            ))}
          </select>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-muted hover:text-text">JSON yapıştır</summary>
          <textarea
            className="field mono mt-2 h-32 text-xs"
            placeholder='{"core": {...}, "meta": {...}}'
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <button className="btn btn-accent mt-2" disabled={!selected || loading} onClick={() => run()}>
            Yapıştırılanı doğrula
          </button>
        </details>
        {loading && <div className="h-16 animate-pulse rounded-lg bg-panel-2" />}
        {err && <div className="text-sm text-no">{err}</div>}

        {result && (
          <div className="space-y-5 border-t border-line pt-5">
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${
                  result.match ? "bg-yes/15 text-yes" : "bg-no/15 text-no"
                }`}
              >
                {result.match ? "✓" : "✕"}
              </span>
              <div>
                <div className="text-lg font-semibold">{result.match ? "Parmak izi eşleşiyor" : "Parmak izi eşleşmiyor"}</div>
                <div className="mt-0.5 text-sm text-muted">
                  Kanıttaki sonuç <span className="text-text">{result.outcome}</span>, zincirde önerilen{" "}
                  <span className="text-text">{OUTCOME[result.market.proposedOutcome]}</span>.{" "}
                  <Link href={`/market/${result.market.id}`} className="hover:text-text">
                    Markete git →
                  </Link>
                </div>
              </div>
            </div>
            <div className="mono grid grid-cols-[72px_1fr] gap-x-2 gap-y-1 text-xs">
              <span className="text-muted">zincir</span>
              <span className="break-all">{result.market.evidenceHash}</span>
              <span className="text-muted">tarayıcı</span>
              <span className="break-all">{result.localHash}</span>
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted hover:text-text">Hash&apos;lenen veri (kanonik JSON)</summary>
              <pre className="mono mt-2 max-h-72 overflow-auto rounded-lg border border-line bg-[#0d1015] p-3 text-xs">{result.canonical}</pre>
            </details>
          </div>
        )}
      </div>

      <section>
        <h2 className="text-[15px] font-medium">Sonucu baştan hesapla</h2>
        <div className="mt-3 space-y-3">
          <CodeBlock label="terminal">{`cd agent && npm run verify -- ${result?.market.id ?? "<market-no>"}`}</CodeBlock>
          {result && result.commands.length > 0 && <CodeBlock label="agent'ın çalıştırdığı OKX komutları">{result.commands.join("\n")}</CodeBlock>}
        </div>
      </section>
    </div>
  );
}
