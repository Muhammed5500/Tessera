"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { LiveDot, Metric, PageHeader } from "@/components/ui";
import { mockUsdcAbi } from "@/lib/abi";
import { AGENT_API, getFeed, getStats, type FeedEvent } from "@/lib/agentApi";
import { addrUrl, formatUsdc, publicClient, txUrl, USDC_ADDRESS } from "@/lib/chain";
import { usePoll } from "@/lib/hooks";

const AGENT_ADDRESS = "0x6b3882eD566e21d74Cea2341895F442100e36212" as const;

const TYPE: Record<string, { label: string; color: string }> = {
  market_created: { label: "Market açtı", color: "var(--yes)" },
  seed: { label: "Likidite ekledi", color: "var(--muted)" },
  resolution_proposed: { label: "Sonuç önerdi", color: "var(--info)" },
  finalized: { label: "Kesinleşti", color: "var(--accent)" },
  proposal_rejected: { label: "Politika reddetti", color: "var(--warn)" },
  no_market: { label: "Market açmadı", color: "var(--muted)" },
  resolve_waiting: { label: "Veri bekliyor", color: "var(--muted)" },
  hedge: { label: "Hedge", color: "var(--info)" },
  bet: { label: "Kullanıcı tahmini", color: "var(--accent)" },
  error: { label: "Hata", color: "var(--no)" },
  info: { label: "Bilgi", color: "var(--muted)" },
};

const FILTERS = [
  ["all", "Tümü"],
  ["markets", "Marketler"],
  ["bets", "Tahminler"],
  ["errors", "Hatalar"],
] as const;
type Filter = (typeof FILTERS)[number][0];

function keep(f: Filter, e: FeedEvent) {
  if (f === "all") return e.type !== "seed";
  if (f === "markets") return ["market_created", "resolution_proposed", "finalized", "proposal_rejected", "no_market"].includes(e.type);
  if (f === "bets") return e.type === "bet";
  return e.type === "error";
}

function timeTR(iso: string) {
  return new Date(iso).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const sec = (ms: number, d = 1) => `${(ms / 1000).toLocaleString("tr-TR", { maximumFractionDigits: d })} sn`;

function EventRow({ e }: { e: FeedEvent }) {
  const t = TYPE[e.type] ?? { label: e.type, color: "var(--muted)" };
  const rationale = (e.data?.rationale_tr as string | undefined) ?? undefined;
  return (
    <li className="grid grid-cols-[58px_1fr] gap-3 py-3 sm:grid-cols-[72px_1fr]">
      <span className="tabular pt-0.5 text-xs text-muted">{timeTR(e.at)}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="flex items-center gap-1.5 font-medium" style={{ color: t.color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />
            {t.label}
          </span>
          {e.marketId && (
            <Link href={`/market/${e.marketId}`} className="tabular text-muted hover:text-text">
              #{e.marketId}
            </Link>
          )}
          {e.confirmMs !== undefined && <span className="tabular text-muted">{sec(e.confirmMs)} onay</span>}
          {e.tx && (
            <a className="text-muted hover:text-text" href={txUrl(e.tx)} target="_blank" rel="noreferrer">
              işlem ↗
            </a>
          )}
        </div>
        <div className="mt-1 text-sm text-[#c9d1dc] [overflow-wrap:anywhere]">
          {e.message.length > 240 ? `${e.message.slice(0, 240)}…` : e.message}
        </div>
        {rationale && <div className="mt-1 text-xs leading-relaxed text-muted">{rationale}</div>}
      </div>
    </li>
  );
}

export default function AgentPage() {
  const stats = usePoll(getStats, 5_000);
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [live, setLive] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(30);
  const wallet = usePoll(
    async () => {
      const [avax, usdc] = await Promise.all([
        publicClient.getBalance({ address: AGENT_ADDRESS }),
        publicClient.readContract({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "balanceOf", args: [AGENT_ADDRESS] }),
      ]);
      return { avax, usdc };
    },
    20_000,
  );

  useEffect(() => {
    getFeed(100).then((f) => setEvents(f ?? []));
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${AGENT_API}/api/stream`);
      es.onopen = () => setLive(true);
      es.onerror = () => setLive(false);
      es.onmessage = (msg) => {
        const e = JSON.parse(msg.data) as FeedEvent;
        setEvents((x) => [e, ...(x ?? []).filter((y) => y.id !== e.id)]);
      };
    } catch {
      setLive(false);
    }
    return () => es?.close();
  }, []);

  const s = stats.data;
  const tools = Object.entries(s?.atk.byTool ?? {}).sort((a, b) => b[1] - a[1]);
  const maxTool = tools[0]?.[1] ?? 1;
  const shown = (events ?? []).filter((e) => keep(filter, e));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Agent"
        right={
          <span className="flex items-center gap-2 text-sm text-muted">
            <LiveDot on={live} />
            {live ? "Çalışıyor" : "Bağlantı yok"}
          </span>
        }
      >
        Marketleri açan, sonuçlandıran ve kanıtlayan tek bir yazılım. Piyasayı OKX verisiyle tarayıp soru seçer; süre dolunca sonucu
        yapay zekâ kullanmadan, kurala göre hesaplar.
      </PageHeader>

      <div className="card grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
        <Metric
          label="Açtığı market"
          value={s ? s.markets.created : "—"}
          sub={s ? `${s.markets.finalized} kesinleşti` : "agent çevrim dışı"}
        />
        <Metric label="Reddedilen öneri" value={s ? s.markets.rejectedProposals : "—"} sub="politika süzgecinden" />
        <Metric
          label="Ortalama zincir onayı"
          value={s?.chain.avgConfirmMs ? sec(s.chain.avgConfirmMs, 2) : "—"}
          sub={s?.chain.minConfirmMs ? `en hızlı ${sec(s.chain.minConfirmMs, 2)} · ${s.chain.txCount} işlem` : undefined}
        />
        <div>
          <div className="text-xs text-muted">Cüzdan</div>
          <a className="mono mt-1 block text-sm hover:text-accent" href={addrUrl(AGENT_ADDRESS)} target="_blank" rel="noreferrer">
            {AGENT_ADDRESS.slice(0, 6)}…{AGENT_ADDRESS.slice(-4)} ↗
          </a>
          <div className="tabular mt-0.5 text-xs text-muted">
            {wallet.data
              ? `${Number(formatEther(wallet.data.avax)).toLocaleString("tr-TR", { maximumFractionDigits: 3 })} AVAX · ${formatUsdc(wallet.data.usdc, 0)} kUSDC`
              : "…"}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <section className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line">
            {FILTERS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`-mb-px border-b-2 pb-2.5 text-sm transition-colors ${
                  filter === k ? "border-text font-medium text-text" : "border-transparent text-muted hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {events === null && <div className="mt-4 h-40 animate-pulse rounded-lg bg-panel" />}
          {events !== null && shown.length === 0 && (
            <div className="py-10 text-center text-sm text-muted">
              {events.length === 0 ? "Henüz kayıt yok ya da agent çevrim dışı." : "Bu filtrede kayıt yok."}
            </div>
          )}
          <ul className="divide-y divide-line">
            {shown.slice(0, limit).map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ul>
          {shown.length > limit && (
            <button className="mt-2 w-full rounded-lg py-2 text-sm text-muted hover:bg-panel hover:text-text" onClick={() => setLimit((l) => l + 30)}>
              Daha fazla göster
            </button>
          )}
        </section>

        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <div className="card p-5">
            <h2 className="text-[15px] font-medium">Nasıl çalışır?</h2>
            <ol className="mt-3 space-y-3 text-sm">
              {[
                ["Tarar", "OKX Agent Trade Kit ile fiyat, funding ve vadeli verilerine bakıp soru seçer."],
                ["Süzer", "Her öneri zincire gitmeden önce sabit kurallardan geçer."],
                ["Çözer", "Süre dolunca sonucu kapanmış OKX verisinden hesaplar; yapay zekâ yok."],
                ["Kanıtlar", "Kanıtın hash'ini Avalanche'a yazar; herkes tekrar üretebilir."],
              ].map(([t, d], i) => (
                <li key={t} className="grid grid-cols-[20px_1fr] gap-2">
                  <span className="tabular text-muted">{i + 1}</span>
                  <span>
                    <span className="font-medium">{t}.</span> <span className="text-muted">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="card p-5">
            <h2 className="text-[15px] font-medium">OKX veri kullanımı</h2>
            <div className="tabular mt-1 text-xs text-muted">
              {s ? `${s.atk.totalCalls} çağrı · ${s.atk.distinctTools} araç · ${s.atk.errors} hata` : "—"}
            </div>
            <ul className="mt-4 space-y-3">
              {tools.slice(0, 10).map(([k, v]) => (
                <li key={k} className="text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="mono truncate text-[#c9d1dc]">{k}</span>
                    <span className="tabular text-muted">{v}</span>
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-panel-2">
                    <div className="h-1 rounded-full bg-[#5b6575]" style={{ width: `${(v / maxTool) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
