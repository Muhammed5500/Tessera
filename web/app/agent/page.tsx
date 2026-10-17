"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { mockUsdcAbi } from "@/lib/abi";
import { AGENT_API, getFeed, getStats, type FeedEvent } from "@/lib/agentApi";
import { addrUrl, formatUsdc, publicClient, txUrl, USDC_ADDRESS } from "@/lib/chain";
import { usePoll } from "@/lib/hooks";

const AGENT_ADDRESS = "0x6b3882eD566e21d74Cea2341895F442100e36212" as const;

const TYPE: Record<string, { label: string; color: string }> = {
  market_created: { label: "Market açtı", color: "var(--yes)" },
  seed: { label: "Likidite", color: "var(--muted)" },
  resolution_proposed: { label: "Sonuç önerdi", color: "var(--info)" },
  finalized: { label: "Kesinleşti", color: "var(--accent)" },
  proposal_rejected: { label: "Politika reddi", color: "var(--warn)" },
  no_market: { label: "Market açmadı", color: "var(--muted)" },
  resolve_waiting: { label: "Veri bekliyor", color: "var(--muted)" },
  hedge: { label: "Hedge", color: "var(--info)" },
  bet: { label: "Dış tahmin", color: "var(--accent)" },
  error: { label: "Hata", color: "var(--no)" },
  info: { label: "Bilgi", color: "var(--muted)" },
};

function timeTR(iso: string) {
  return new Date(iso).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function EventRow({ e }: { e: FeedEvent }) {
  const t = TYPE[e.type] ?? { label: e.type, color: "var(--muted)" };
  const rationale = (e.data?.rationale_tr as string | undefined) ?? undefined;
  const tools = (e.data?.tools as string[] | undefined) ?? undefined;
  return (
    <li className="border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="mono text-muted">{timeTR(e.at)}</span>
        <span className="pill" style={{ color: t.color, borderColor: t.color }}>
          {t.label}
        </span>
        {e.marketId && (
          <Link href={`/market/${e.marketId}`} className="link">
            #{e.marketId}
          </Link>
        )}
        {e.confirmMs !== undefined && <span className="text-muted">{(e.confirmMs / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn onay</span>}
        {e.tx && (
          <a className="link" href={txUrl(e.tx)} target="_blank" rel="noreferrer">
            tx
          </a>
        )}
      </div>
      <div className="mt-1 text-sm [overflow-wrap:anywhere]">{e.message.length > 280 ? `${e.message.slice(0, 280)}…` : e.message}</div>
      {rationale && <div className="mt-1 text-xs text-muted">{rationale}</div>}
      {tools && tools.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {tools.map((x, i) => (
            <span key={i} className="pill mono">
              {x.replace(/^mcp__okx_/, "")}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

export default function AgentPage() {
  const stats = usePoll(getStats, 5_000);
  const [events, setEvents] = useState<FeedEvent[] | null>(null);
  const [live, setLive] = useState(false);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Agent</h1>
        <p className="mt-1 text-sm text-muted">
          Üç rol: <b className="text-text">Scout</b> piyasayı ATK ile tarayıp market açar (LLM), <b className="text-text">Resolver</b> sonucu OKX
          verisiyle deterministik olarak hesaplar ve kanıtlar (LLM yok), <b className="text-text">Policy</b> her öneriyi zincire gitmeden önce
          süzer.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs text-muted">Agent cüzdanı</div>
          <a className="mono link text-sm" href={addrUrl(AGENT_ADDRESS)} target="_blank" rel="noreferrer">
            {AGENT_ADDRESS.slice(0, 10)}…{AGENT_ADDRESS.slice(-6)}
          </a>
          <div className="mt-2 text-xs text-muted">
            {wallet.data
              ? `${Number(formatEther(wallet.data.avax)).toLocaleString("tr-TR", { maximumFractionDigits: 4 })} AVAX · ${formatUsdc(wallet.data.usdc)} kUSDC`
              : "…"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">Marketler</div>
          <div className="mt-1 text-sm">
            {s ? `${s.markets.created} açıldı · ${s.markets.proposed} çözüldü · ${s.markets.finalized} kesinleşti · ${s.markets.rejectedProposals} öneri reddedildi` : "agent erişilemiyor"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">Zincir onay süresi (gönderim → kesinleşme)</div>
          <div className="mt-1 text-xl font-bold">
            {s?.chain.avgConfirmMs ? `${(s.chain.avgConfirmMs / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} sn` : "—"}
          </div>
          <div className="text-xs text-muted">
            {s?.chain.txCount ?? 0} işlem · en hızlı {s?.chain.minConfirmMs ? `${(s.chain.minConfirmMs / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} sn` : "—"}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Canlı akış</h2>
            <span className={`pill ${live ? "pill-open" : ""}`}>{live ? "● canlı" : "bağlantı yok"}</span>
          </div>
          {events === null && <div className="text-sm text-muted">Yükleniyor…</div>}
          {events?.length === 0 && <div className="text-sm text-muted">Henüz olay yok ya da agent API'ye ulaşılamıyor.</div>}
          <ul>{events?.map((e) => <EventRow key={e.id} e={e} />)}</ul>
        </div>

        <div className="card h-fit p-4">
          <h2 className="font-semibold">ATK kullanımı</h2>
          <div className="mt-1 text-xs text-muted">
            {s ? `${s.atk.totalCalls} çağrı · ${s.atk.distinctTools} farklı araç · ${s.atk.errors} hata` : "—"}
          </div>
          <ul className="mt-3 space-y-2">
            {tools.map(([k, v]) => (
              <li key={k} className="text-xs">
                <div className="flex justify-between">
                  <span className="mono">{k}</span>
                  <span className="text-muted">{v}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-panel-2">
                  <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(v / maxTool) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
