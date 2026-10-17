"use client";

import { useEffect, useState } from "react";
import { fetchEvidence, type Evidence } from "@/lib/agentApi";
import { hashCore } from "@/lib/canonical";
import { OUTCOME, txUrl, type Market } from "@/lib/chain";
import { CodeBlock } from "./ui";

const OUT_TR: Record<string, string> = { YES: "Yes", NO: "No", VOID: "Void" };

function obsTime(o: Record<string, string>) {
  const ms = o.openTimeMs ?? o.fundingTimeMs;
  if (!ms) return "";
  return new Date(Number(ms)).toLocaleTimeString("en-US", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
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
      <div className="card p-5">
        <h2 className="text-[15px] font-medium">Evidence</h2>
        <p className="mt-1 text-sm text-muted">Shown once a result is proposed.</p>
      </div>
    );
  }

  const localHash = ev ? hashCore(ev.core) : null;
  const match = localHash && localHash.toLowerCase() === m.evidenceHash.toLowerCase();

  return (
    <div className="card space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-medium">Evidence</h2>
        <span className="text-sm text-muted">
          Proposed result: <span className="text-text">{OUTCOME[m.proposedOutcome]}</span>
        </span>
      </div>

      {ev === undefined && <div className="h-24 animate-pulse rounded-lg bg-panel-2" />}
      {ev === null && (
        <div className="text-sm text-muted">
          The evidence file isn&apos;t reachable right now (the agent may be offline). The on-chain hash is still valid and can be checked with the command below.
        </div>
      )}

      {ev && (
        <>
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted">
                <tr>
                  <th className="px-1 pb-2 font-normal">Role</th>
                  <th className="px-1 pb-2 font-normal">Source</th>
                  <th className="px-1 pb-2 font-normal">Instrument</th>
                  <th className="px-1 pb-2 font-normal">Minute</th>
                  <th className="px-1 pb-2 text-right font-normal">Value</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {ev.core.observations.map((o, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-1 py-2">{o.role === "primary" ? "Primary" : "Cross-check"}</td>
                    <td className="px-1 py-2 text-muted">
                      OKX {o.site} · {o.kind}
                    </td>
                    <td className="px-1 py-2">{o.instId}</td>
                    <td className="px-1 py-2">{obsTime(o)}</td>
                    <td className="px-1 py-2 text-right">{o.close ?? o.realizedRate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs text-muted">Rule</div>
              <div className="mono mt-1 text-xs text-[#c9d1dc]">{ev.core.rule}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Result</div>
              <div className="mt-1 font-medium">
                {OUT_TR[ev.core.outcome] ?? ev.core.outcome}
                {ev.core.reason ? <span className="font-normal text-muted"> · {ev.core.reason}</span> : null}
              </div>
            </div>
            {ev.core.crossCheck && (
              <div className="sm:col-span-2">
                <div className="text-xs text-muted">Cross-check</div>
                <div className="tabular mt-1 text-xs">
                  Difference {ev.core.crossCheck.diffBps} bps (limit {ev.core.crossCheck.maxBps}) · reference {ev.core.crossCheck.reference} ·{" "}
                  {ev.core.crossCheck.ok === "true" ? <span className="text-yes">passed</span> : <span className="text-no">failed</span>}
                </div>
              </div>
            )}
          </div>

          <div className={`rounded-lg border p-3 text-xs ${match ? "border-yes/30 bg-yes/5" : "border-no/30 bg-no/5"}`}>
            <div className={`mb-2 flex items-center gap-2 text-sm font-medium ${match ? "text-yes" : "text-no"}`}>
              <span className={`h-2 w-2 rounded-full ${match ? "bg-yes" : "bg-no"}`} />
              {match ? "Matches the on-chain hash" : "Does not match the on-chain hash"}
            </div>
            <div className="mono grid grid-cols-[64px_1fr] gap-x-2 gap-y-0.5 text-muted">
              <span>chain</span>
              <span className="break-all">{m.evidenceHash}</span>
              <span>browser</span>
              <span className="break-all">{localHash}</span>
            </div>
          </div>

          <div>
            <CodeBlock label="terminal">{`cd agent && npm run verify -- ${m.id}`}</CodeBlock>
            <details className="mt-3 text-xs text-muted">
              <summary className="cursor-pointer hover:text-text">OKX commands the agent ran</summary>
              <div className="mt-2">
                <CodeBlock label="ATK">{ev.meta.commands.join("\n")}</CodeBlock>
              </div>
            </details>
          </div>
          {ev.meta.tx && (
            <a className="inline-block text-xs text-muted hover:text-text" href={txUrl(ev.meta.tx)} target="_blank" rel="noreferrer">
              Proposal transaction ↗
            </a>
          )}
        </>
      )}
    </div>
  );
}
