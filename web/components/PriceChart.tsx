"use client";

import { useEffect, useRef, useState } from "react";
import { useLivePrice } from "@/lib/livePrice";

const H = 280;
const PAD = { l: 4, r: 64, t: 14, b: 26 };
const REST = "https://www.okx.com/api/v5/market/history-candles";
const COLORS: Record<string, string> = { BTC: "#f7931a", ETH: "#8a9bff", SOL: "#14f195", AVAX: "#e84142" };

type Pt = { t: number; p: number };

const hhmm = (t: number) =>
  new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 3 : 1 });

/**
 * Fiyat marketleri için Polymarket tarzı grafik: OKX 1 dk kapanışları + canlı fiyat, hedef çizgisi (veya aralık),
 * ölçüm anında dikey çizgi. Yalnız gösterim; sonuç agent'ta ATK ile hesaplanır.
 */
export function PriceChart({
  instId,
  from,
  resolveTime,
  target,
  band,
  live,
}: {
  instId: string;
  from: number;
  resolveTime: number;
  target?: number;
  band?: [number, number];
  live: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hist, setHist] = useState<Pt[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const { ticks, last, open24h } = useLivePrice(instId);
  const base = instId.split("-")[0];
  const color = COLORS[base] ?? "#f0b90b";

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const end = Math.min(Date.now() / 1000, resolveTime + 120);
    const bars = Math.min(300, Math.ceil((end - from) / 60) + 2);
    fetch(`${REST}?instId=${instId}&bar=1m&limit=${bars}&after=${Math.ceil(end) * 1000}`)
      .then((r) => r.json())
      .then((j: { data?: string[][] }) =>
        setHist((j.data ?? []).map((r) => ({ t: Number(r[0]) / 1000 + 60, p: Number(r[4]) })).reverse()),
      )
      .catch(() => setHist([]));
  }, [instId, from, resolveTime]);

  // 1 dk geçmiş + (market açıksa) canlı tikler
  const lastHist = hist?.at(-1)?.t ?? 0;
  const tail = live ? ticks.current.filter((x) => x.t > lastHist) : [];
  const pts = [...(hist ?? []), ...tail];

  const t0 = from;
  const t1 = Math.max(resolveTime, pts.at(-1)?.t ?? resolveTime);
  const vis = pts.filter((x) => x.t >= t0 - 60);
  const ref = [...vis.map((x) => x.p), ...(target ? [target] : []), ...(band ?? [])];
  const minV = ref.length ? Math.min(...ref) : 0;
  const maxV = ref.length ? Math.max(...ref) : 1;
  const padV = (maxV - minV) * 0.15 || maxV * 0.001;
  const lo = minV - padV;
  const hi = maxV + padV;
  const iw = w - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * ih;

  const d = vis.map((pt, i) => `${i ? "L" : "M"}${x(Math.max(pt.t, t0)).toFixed(1)},${y(pt.p).toFixed(1)}`).join("");
  const area = vis.length ? `${d}V${PAD.t + ih}H${x(Math.max(vis[0].t, t0))}Z` : "";
  const yTicks = Array.from({ length: 5 }, (_, i) => lo + ((i + 0.5) / 5) * (hi - lo));
  const xTicks = Array.from({ length: 4 }, (_, i) => t0 + ((i + 0.5) / 4) * (t1 - t0));
  const cur = live ? last?.p ?? vis.at(-1)?.p : vis.at(-1)?.p;
  const chg = last && open24h ? ((last.p - open24h) / open24h) * 100 : null;
  const hv = hover !== null ? [...vis].reverse().find((p) => p.t <= hover) : undefined;

  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-sm font-medium text-muted">{base}</span>
        <span className="tabular text-lg font-semibold">{cur ? `$${fmt(cur)}` : "—"}</span>
        {chg !== null && (
          <span className={`tabular text-sm ${chg >= 0 ? "text-yes" : "text-no"}`}>
            {chg >= 0 ? "+" : ""}
            {chg.toFixed(2)}%
          </span>
        )}
      </div>
      <div ref={wrap} className="relative w-full select-none overflow-hidden">
        <svg
          width={w}
          height={H}
          className="block"
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGElement).getBoundingClientRect();
            const px = e.clientX - r.left;
            setHover(px < PAD.l || px > PAD.l + iw ? null : t0 + ((px - PAD.l) / iw) * (t1 - t0));
          }}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={`pf-${base}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={PAD.l + iw} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="2 4" />
              <text x={w - 4} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                {fmt(v)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {hhmm(t)}
            </text>
          ))}

          {band && (
            <rect
              x={PAD.l}
              width={iw}
              y={y(band[1])}
              height={Math.max(1, y(band[0]) - y(band[1]))}
              fill="var(--info)"
              fillOpacity="0.12"
              stroke="var(--info)"
              strokeOpacity="0.5"
              strokeDasharray="4 4"
            />
          )}
          {target !== undefined && (
            <line x1={PAD.l} x2={PAD.l + iw} y1={y(target)} y2={y(target)} stroke="var(--text)" strokeOpacity="0.55" strokeDasharray="5 5" />
          )}

          {/* ölçüm anı */}
          <line x1={x(resolveTime)} x2={x(resolveTime)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--muted)" strokeOpacity="0.6" strokeDasharray="3 3" />
          <text x={x(resolveTime) - 4} y={PAD.t + 10} textAnchor="end" fontSize="10" fill="var(--muted)">
            close
          </text>

          {vis.length > 0 && (
            <>
              <path d={area} fill={`url(#pf-${base})`} />
              <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
              <circle cx={x(vis[vis.length - 1].t)} cy={y(vis[vis.length - 1].p)} r="3.5" fill={color} />
            </>
          )}
          {hv && hover !== null && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--muted)" strokeOpacity="0.5" />
              <circle cx={x(hv.t)} cy={y(hv.p)} r="4" fill={color} stroke="var(--bg)" strokeWidth="2" />
            </>
          )}
        </svg>

        {/* sağ eksen etiketleri: hedef ve son fiyat */}
        {target !== undefined && (
          <span
            className="tabular absolute right-0 -translate-y-1/2 rounded bg-text px-1.5 py-0.5 text-[10px] font-semibold text-bg"
            style={{ top: y(target) }}
          >
            {fmt(target)}
          </span>
        )}
        {vis.length > 0 && (
          <span
            className="tabular absolute right-0 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold text-black"
            style={{ top: y(vis[vis.length - 1].p), background: color }}
          >
            {fmt(vis[vis.length - 1].p)}
          </span>
        )}
        {hv && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 rounded-md bg-panel-2 px-2 py-1 text-xs shadow"
            style={{ left: Math.min(Math.max(x(hover) - 50, 0), w - 120) }}
          >
            <span className="tabular font-medium">${fmt(hv.p)}</span> <span className="text-muted">{hhmm(hv.t)}</span>
          </div>
        )}
        {hist === null && <div className="absolute inset-0 animate-pulse rounded-lg bg-panel/60" />}
      </div>
    </div>
  );
}
