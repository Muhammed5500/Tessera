"use client";

import { useState } from "react";
import { fetchEvidence } from "@/lib/agentApi";
import { canonicalJSON, hashCore } from "@/lib/canonical";
import { getAllMarkets, OUTCOME, type Market } from "@/lib/chain";
import { usePoll } from "@/lib/hooks";

type Result = { market: Market; canonical: string; localHash: string; match: boolean; outcome: string; commands: string[] };

export default function VerifyPage() {
  const markets = usePoll(getAllMarkets, 30_000);
  const [selected, setSelected] = useState<string>("");
  const [pasted, setPasted] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resolved = (markets.data ?? []).filter((m) => m.status >= 1).sort((a, b) => Number(b.id - a.id));

  async function run() {
    setErr(null);
    setResult(null);
    const m = resolved.find((x) => x.id.toString() === selected);
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
        if (!ev) throw new Error("Kanıt dosyasına ulaşılamadı. JSON'u aşağıya yapıştırarak da doğrulayabilirsin.");
        core = ev.core;
        commands = ev.meta.commands;
      }
      const localHash = hashCore(core);
      setResult({
        market: m,
        canonical: canonicalJSON(core),
        localHash,
        match: localHash.toLowerCase() === m.evidenceHash.toLowerCase(),
        outcome: ({ YES: "EVET", NO: "HAYIR", VOID: "GEÇERSİZ" } as Record<string, string>)[String(core.outcome)] ?? String(core.outcome ?? "?"),
        commands,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Doğrula</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Agent her çözümde kanıtın hash'ini zincire yazar. Burada iki şeyi kontrol edebilirsin: (1) kanıt dosyasının değiştirilmediğini — tarayıcın
          dosyayı kanonik JSON'a çevirip keccak256 ile hash'ler ve zincirdekiyle karşılaştırır; (2) sonucun doğru olduğunu — CLI komutu OKX verisini
          kendisi yeniden çeker ve aynı hash'i üretir.
        </p>
      </div>

      <div className="card space-y-3 p-4">
        <label className="block text-xs text-muted">Market</label>
        <select className="field" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Seç…</option>
          {resolved.map((m) => (
            <option key={m.id.toString()} value={m.id.toString()}>
              #{m.id.toString()} · {m.question}
            </option>
          ))}
        </select>
        <details>
          <summary className="cursor-pointer text-xs text-muted">Kanıt JSON'unu kendin yapıştır (isteğe bağlı)</summary>
          <textarea
            className="field mono mt-2 h-32 text-xs"
            placeholder='{"core": {...}, "meta": {...}}'
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
        </details>
        <button className="btn btn-accent" disabled={!selected || loading} onClick={run}>
          {loading ? "Doğrulanıyor…" : "Hash'i doğrula"}
        </button>
        {err && <div className="text-sm text-no">{err}</div>}
      </div>

      {result && (
        <div className="card space-y-4 p-4">
          <div className={`rounded-lg border p-3 ${result.match ? "border-yes/50 bg-yes/5" : "border-no/50 bg-no/5"}`}>
            <div className="text-lg font-bold">{result.match ? "✅ Eşleşiyor" : "❌ Eşleşmiyor"}</div>
            <div className="mt-1 text-sm text-muted">
              Kanıttaki sonuç: <b className="text-text">{result.outcome}</b> · zincirde önerilen: <b className="text-text">{OUTCOME[result.market.proposedOutcome]}</b>
            </div>
          </div>
          <div className="space-y-1 text-xs">
            <div className="mono break-all">
              <span className="text-muted">zincir   </span>
              {result.market.evidenceHash}
            </div>
            <div className="mono break-all">
              <span className="text-muted">tarayıcı </span>
              {result.localHash}
            </div>
          </div>
          <details>
            <summary className="cursor-pointer text-xs text-muted">Hash'lenen kanonik JSON</summary>
            <pre className="mono mt-2 max-h-72 overflow-auto rounded-lg bg-panel-2 p-3 text-xs">{result.canonical}</pre>
          </details>
          <div>
            <div className="mb-1 text-xs text-muted">Sonucun doğruluğunu bağımsız kontrol et (repo içinde):</div>
            <pre className="mono overflow-x-auto rounded-lg bg-panel-2 p-3 text-xs">{`cd agent && npm run verify -- ${result.market.id}`}</pre>
            {result.commands.length > 0 && (
              <>
                <div className="mb-1 mt-3 text-xs text-muted">Agent'ın çalıştırdığı ATK komutları:</div>
                <pre className="mono overflow-x-auto rounded-lg bg-panel-2 p-3 text-xs">{result.commands.join("\n")}</pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
