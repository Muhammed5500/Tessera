"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BetPanel } from "@/components/BetPanel";
import { EvidenceCard } from "@/components/EvidenceCard";
import { PriceChart } from "@/components/PriceChart";
import { ProbChart } from "@/components/ProbChart";
import { AssetIcon } from "@/components/ui";
import { getMeta, type MarketMeta } from "@/lib/agentApi";
import { addrUrl, decodeSpec, formatTime, formatUsdc, getMarket, impliedYes, marketQuestion, marketRule, outcomeLabel, priceSpec, readContractParams, txUrl } from "@/lib/chain";
import { getProbHistory, type Activity, type ProbPoint } from "@/lib/history";
import { useNow, usePoll } from "@/lib/hooks";
import { walletLabel } from "@/lib/traders";

const AGENT = "0x6b3882eD566e21d74Cea2341895F442100e36212";
const NAMES: Record<string, string> = { BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", AVAX: "Avalanche", DOGE: "Dogecoin", XRP: "XRP" };
function ago(t: number, now: number) {
  const s = Math.max(0, now - t);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/** Polymarket tarzı geri sayım (kırmızı rakamlar). */
function Countdown({ to, now }: { to: number; now: number }) {
  const s = Math.max(0, to - now);
  const parts = [
    [Math.floor(s / 3600), "HRS"],
    [Math.floor((s % 3600) / 60), "MINS"],
    [s % 60, "SECS"],
  ] as const;
  return (
    <div className="flex gap-3">
      {parts.map(([v, l]) => (
        <div key={l} className="text-center">
          <div className="tabular text-2xl font-semibold leading-none text-no">{String(v).padStart(2, "0")}</div>
          <div className="mt-1 text-[10px] text-muted">{l}</div>
        </div>
      ))}
    </div>
  );
}

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const marketId = BigInt(id);
  const now = useNow();
  const market = usePoll(() => getMarket(marketId), 8_000, [id]);
  const params = usePoll(readContractParams, 60_000);
  const [meta, setMeta] = useState<MarketMeta | null | undefined>(undefined);
  const [hist, setHist] = useState<{ points: ProbPoint[]; activity: Activity[] } | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [bottom, setBottom] = useState<"activity" | "evidence">("activity");
  const [side, setSide] = useState(true);

  useEffect(() => {
    getMeta(id).then(setMeta);
  }, [id]);

  const m = market.data;
  const poolKey = m ? `${m.yesPool}-${m.noPool}-${m.status}` : "";
  useEffect(() => {
    if (!m) return;
    getProbHistory(m)
      .then(setHist)
      .catch(() => setHist({ points: [], activity: [] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, poolKey]);
  useEffect(() => {
    if (m && m.status >= 1) setBottom("evidence");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.status]);

  if (!m) {
    return (
      <div className="space-y-4">
        <div className="h-14 w-full max-w-xl animate-pulse rounded-lg bg-panel" />
        <div className="h-72 w-full animate-pulse rounded-lg bg-panel" />
        {market.error && <div className="text-sm text-no">Couldn&apos;t load this market.</div>}
      </div>
    );
  }

  const yes = impliedYes(m);
  const spec = priceSpec(m.templateId, m.params);
  const instId = spec?.instId ?? decodeSpec(m.templateId, m.params).instId;
  const base = instId?.split("-")[0] ?? "";
  const p = params.data;
  const total = m.yesPool + m.noPool;
  const open = m.status === 0 && now < m.closeTime;
  const final = m.status === 3;
  const rule = marketRule(m);

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 lg:col-start-1">
        {/* başlık */}
        <div className="flex items-start gap-4">
          <AssetIcon instId={instId} size={56} />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-muted">
              <Link href={m.templateId === 3 ? "/grid" : "/"} className="hover:text-text">
                Crypto
              </Link>
              {base && ` · ${NAMES[base] ?? base}`}
            </div>
            <h1 className="mt-0.5 text-2xl font-semibold leading-tight tracking-tight">{marketQuestion(m)}</h1>
          </div>
          <div className="hidden shrink-0 sm:block">
            {open ? (
              <Countdown to={m.closeTime} now={now} />
            ) : final ? null : (
              <span className="text-sm text-muted">{m.status === 0 ? "Awaiting result" : "Result proposed"}</span>
            )}
          </div>
        </div>

        {/* grafik */}
        <div className="mt-6">
          {spec ? (
            <PriceChart
              instId={spec.instId}
              from={m.createdAt - 15 * 60}
              resolveTime={m.resolveTime}
              target={spec.target}
              band={spec.band}
              live={!final}
            />
          ) : (
            <>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="tabular text-2xl font-semibold text-info">{yes === null ? "—" : `${yes.toFixed(0)}% chance`}</span>
              </div>
              {hist === null ? (
                <div className="h-[240px] animate-pulse rounded-lg bg-panel" />
              ) : (
                <ProbChart points={hist.points} start={m.createdAt} end={Math.min(now, m.closeTime)} />
              )}
            </>
          )}
        </div>

        <div className="tabular mt-3 flex gap-5 text-sm text-muted">
          <span>${formatUsdc(total, 0)} Vol.</span>
          <span>{formatTime(m.resolveTime)}</span>
        </div>

        {/* sonuç satırı */}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-line py-4">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium">{outcomeLabel(m)}</div>
          </div>
          {final ? (
            <span
              className={`text-xl font-semibold ${m.finalOutcome === 1 ? "text-yes" : m.finalOutcome === 2 ? "text-no" : "text-muted"}`}
            >
              {["—", "Yes", "No", "Void"][m.finalOutcome]}
            </span>
          ) : (
            <span className="tabular w-16 text-center text-2xl font-semibold">{yes === null ? "—" : `${yes.toFixed(0)}%`}</span>
          )}
          {open && (
            <div className="flex gap-2">
              <button
                onClick={() => setSide(true)}
                className={`tabular w-32 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                  side ? "bg-yes text-[#04130d]" : "bg-yes/12 text-yes hover:bg-yes/20"
                }`}
              >
                Buy Yes {yes === null ? "" : `${yes.toFixed(0)}¢`}
              </button>
              <button
                onClick={() => setSide(false)}
                className={`tabular w-32 rounded-lg py-2.5 text-sm font-medium transition-colors ${
                  !side ? "bg-no text-white" : "bg-no/12 text-no hover:bg-no/20"
                }`}
              >
                Buy No {yes === null ? "" : `${(100 - yes).toFixed(0)}¢`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* işlem paneli */}
      <aside className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="lg:sticky lg:top-20">
          {p ? (
            <BetPanel
              m={m}
              now={now}
              disputeWindow={p.disputeWindow}
              disputeBond={p.disputeBond}
              feeBps={p.feeBps}
              onDone={market.refresh}
              side={side}
              onSideChange={setSide}
            />
          ) : (
            <div className="card h-72 animate-pulse" />
          )}
        </div>
      </aside>

      <div className="min-w-0 space-y-8 lg:col-start-1">
        {/* kurallar */}
        <section>
          <div className="flex gap-5 border-b border-line">
            <span className="-mb-px border-b-2 border-text pb-2.5 text-[15px] font-medium">Rules</span>
          </div>
          <p className={`mt-3 text-sm leading-relaxed text-[#c9d1dc] ${ruleOpen ? "" : "line-clamp-3"}`}>{rule}</p>
          <button className="mt-1 text-sm font-medium text-muted hover:text-text" onClick={() => setRuleOpen((x) => !x)}>
            {ruleOpen ? "Show less" : "Show more"}
          </button>
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted">Market opened:</dt>
              <dd>
                {formatTime(m.createdAt)}
                {meta?.createdTx && (
                  <a className="ml-2 text-muted hover:text-text" href={txUrl(meta.createdTx)} target="_blank" rel="noreferrer">
                    ↗
                  </a>
                )}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">Resolution source:</dt>
              <dd>
                OKX {instId ?? ""} {m.templateId === 2 ? "funding rate" : "1-minute candle"}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-line px-4 py-3 text-sm">
            <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden>
              <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent)" strokeWidth="2" />
              <circle cx="12" cy="12" r="4" fill="var(--accent)" />
            </svg>
            <div>
              <div className="text-xs text-muted">Resolver</div>
              <a className="mono text-info hover:underline" href={addrUrl(AGENT)} target="_blank" rel="noreferrer">
                {AGENT.slice(0, 10)}…
              </a>
            </div>
          </div>
        </section>

        {/* aktivite / kanıt */}
        <section>
          <div className="flex gap-5 border-b border-line">
            {(
              [
                ["activity", "Activity"],
                ["evidence", "Evidence"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setBottom(k)}
                className={`-mb-px border-b-2 pb-2.5 text-[15px] ${bottom === k ? "border-text font-medium" : "border-transparent text-muted hover:text-text"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {bottom === "activity" ? (
            <ul className="divide-y divide-line">
              {hist === null && <li className="h-24 animate-pulse" />}
              {hist?.activity.length === 0 && <li className="py-6 text-center text-sm text-muted">No trades yet</li>}
              {hist?.activity.slice(0, 25).map((a) => (
                <li key={a.tx + a.user + a.amount} className="flex items-center gap-3 py-3 text-sm">
                  <span
                    className="h-7 w-7 shrink-0 rounded-full"
                    style={{ background: `linear-gradient(135deg, #${a.user.slice(2, 8)}, #${a.user.slice(-6)})` }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="mono">
                      {walletLabel(a.user) ?? `${a.user.slice(0, 6)}…${a.user.slice(-4)}`}
                    </span>{" "}
                    <span className="text-muted">bought</span>{" "}
                    <span className={a.yes ? "text-yes" : "text-no"}>{a.yes ? "Yes" : "No"}</span>{" "}
                    <span className="tabular text-muted">· ${formatUsdc(a.amount, 0)}</span>
                  </span>
                  <a className="tabular shrink-0 text-xs text-muted hover:text-text" href={txUrl(a.tx)} target="_blank" rel="noreferrer">
                    {ago(a.t, now)}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="pt-4">
              <EvidenceCard m={m} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
