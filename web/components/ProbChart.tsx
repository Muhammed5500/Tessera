"use client";

import { useEffect, useRef, useState } from "react";
import type { ProbPoint } from "@/lib/history";

const H = 240;
const PAD = { l: 4, r: 44, t: 12, b: 26 };

const hhmm = (t: number) =>
  new Date(t * 1000).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });

/** Polymarket tarzı olasılık grafiği: basamaklı çizgi, sağda % ekseni, üzerine gelince değer. */
export function ProbChart({ points, start, end, color = "var(--info)" }: { points: ProbPoint[]; start: number; end: number; color?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const t0 = Math.min(start, points[0]?.t ?? start);
  const t1 = Math.max(end, t0 + 60);
  // Görünür olaylar + son değeri bitişe uzat
  const pts = points.length ? [...points, { t: t1, yes: points[points.length - 1].yes }] : [];

  const vMin = Math.min(...pts.map((p) => p.yes), 50) - 8;
  const vMax = Math.max(...pts.map((p) => p.yes), 50) + 8;
  const stepV = [5, 10, 20, 25].find((st) => (vMax - vMin) / st <= 4) ?? 25;
  const lo = Math.max(0, Math.floor(vMin / stepV) * stepV);
  const hi = Math.min(100, Math.ceil(vMax / stepV) * stepV);
  const iw = w - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * ih;

  let d = "";
  pts.forEach((p, i) => {
    if (i === 0) d += `M${x(p.t)},${y(p.yes)}`;
    else d += `H${x(p.t)}V${y(p.yes)}`;
  });
  const area = pts.length ? `${d}V${PAD.t + ih}H${x(pts[0].t)}Z` : "";

  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += stepV) ticks.push(v);
  const xTicks = 4;

  const hv = hover !== null ? [...pts].reverse().find((p) => p.t <= hover) ?? pts[0] : null;

  return (
    <div ref={wrap} className="relative w-full select-none overflow-hidden">
      <svg
        width={w}
        height={H}
        className="block"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGElement).getBoundingClientRect();
          const px = e.clientX - r.left;
          if (px < PAD.l || px > PAD.l + iw) return setHover(null);
          setHover(t0 + ((px - PAD.l) / iw) * (t1 - t0));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="pc-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={PAD.l + iw} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={w - 4} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="tabular">
              %{v}
            </text>
          </g>
        ))}
        {Array.from({ length: xTicks }, (_, i) => t0 + ((i + 0.5) / xTicks) * (t1 - t0)).map((t) => (
          <text key={t} x={x(t)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">
            {hhmm(t)}
          </text>
        ))}
        {pts.length > 0 && (
          <>
            <path d={area} fill="url(#pc-fill)" />
            <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
            <circle cx={x(pts[pts.length - 1].t)} cy={y(pts[pts.length - 1].yes)} r="3.5" fill={color} />
          </>
        )}
        {hv && hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--muted)" strokeOpacity="0.5" />
            <circle cx={x(hover)} cy={y(hv.yes)} r="4" fill={color} stroke="var(--bg)" strokeWidth="2" />
          </>
        )}
      </svg>
      {hv && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 rounded-md bg-panel-2 px-2 py-1 text-xs shadow"
          style={{ left: Math.min(Math.max(x(hover) - 40, 0), w - 90) }}
        >
          <span className="tabular font-medium">%{hv.yes.toFixed(0)}</span> <span className="text-muted">{hhmm(hover)}</span>
        </div>
      )}
      {pts.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted">Henüz işlem yok</div>
      )}
    </div>
  );
}
