"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { PricePoint } from "@/lib/livePrice";

export type GridCell = {
  id: bigint;
  low: number;
  high: number;
  resolveTime: number;
  closeTime: number;
  status: number;
  proposedOutcome: number;
  finalOutcome: number;
  yesPool: bigint;
  noPool: bigint;
};

type Props = {
  ticks: MutableRefObject<PricePoint[]>;
  cells: GridCell[];
  mine: Record<string, bigint>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  feeBps: number;
  step: number;
  past: number;
  future: number;
  height: number;
  previewAmount: number;
};

const C = {
  grid: "rgba(255,255,255,0.045)",
  axis: "#7d8797",
  text: "#e7eaf0",
  muted: "#7d8797",
  accent: [240, 185, 11] as const,
  yes: [22, 199, 132] as const,
  info: [59, 130, 246] as const,
};
const rgba = (c: readonly number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const AXIS_W = 70;
const TOP_H = 30;
const BOTTOM_H = 8;

function fmtPrice(p: number) {
  return p.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function hhmm(t: number) {
  return new Date(t * 1000).toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Canlı fiyat çizgisi + önünde akan tahmin kareleri (60 fps canvas). */
export function GridCanvas(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const props = useRef(p);
  props.current = p;
  const hover = useRef<{ id: string | null; x: number; y: number }>({ id: null, x: 0, y: 0 });
  const rects = useRef<{ id: string; x: number; y: number; w: number; h: number; open: boolean }[]>([]);
  const view = useRef({ yMin: 0, yMax: 0, shown: 0, init: false });

  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    // Canvas CSS değişkenlerini çözmez: gerçek font ailelerini sayfadan oku
    const SANS = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
    const probe = document.createElement("span");
    probe.className = "mono";
    document.body.appendChild(probe);
    const MONO = getComputedStyle(probe).fontFamily || "ui-monospace, monospace";
    probe.remove();
    let raf = 0;
    let W = 0;
    let H = 0;

    const resize = () => {
      const r = wrap.current!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      W = Math.max(280, Math.floor(r.width));
      H = props.current.height;
      cv.width = W * dpr;
      cv.height = H * dpr;
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap.current!);
    resize();

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const { ticks, cells, mine, selectedId, feeBps, step, past, future, previewAmount } = props.current;
      const now = Date.now() / 1000;
      const plotR = W - AXIS_W;
      const top = TOP_H;
      const bot = H - BOTTOM_H;
      const t0 = now - past;
      const t1 = now + future;
      const x = (t: number) => ((t - t0) / (t1 - t0)) * plotR;

      // --- veri ---
      const pts = ticks.current;
      const lastP = pts.length ? pts[pts.length - 1].p : 0;
      const v = view.current;
      if (!v.init && lastP) {
        v.shown = lastP;
        v.yMin = lastP - 120;
        v.yMax = lastP + 120;
        v.init = true;
      }
      if (!v.init) {
        ctx.clearRect(0, 0, W, H);
        return;
      }
      v.shown += (lastP - v.shown) * 0.18;

      const visible = cells.filter((c) => c.resolveTime + step / 2 >= t0 && c.resolveTime - step / 2 <= t1);
      let lo = v.shown;
      let hi = v.shown;
      for (const pt of pts) if (pt.t >= t0) {
        lo = Math.min(lo, pt.p);
        hi = Math.max(hi, pt.p);
      }
      for (const c of visible) {
        lo = Math.min(lo, c.low);
        hi = Math.max(hi, c.high);
      }
      const pad = 12;
      let tMin = lo - pad;
      let tMax = hi + pad;
      if (tMax - tMin < 180) {
        const mid = (tMax + tMin) / 2;
        tMin = mid - 90;
        tMax = mid + 90;
      }
      v.yMin += (tMin - v.yMin) * 0.06;
      v.yMax += (tMax - v.yMax) * 0.06;
      const y = (pr: number) => bot - ((pr - v.yMin) / (v.yMax - v.yMin)) * (bot - top);

      ctx.clearRect(0, 0, W, H);

      // --- gelecek bölgesi ---
      const xNow = x(now);
      ctx.fillStyle = "rgba(255,255,255,0.018)";
      ctx.fillRect(xNow, top, plotR - xNow, bot - top);

      // --- yatay ızgara + sağ eksen ---
      ctx.font = `11px ${MONO}`;
      ctx.textBaseline = "middle";
      const gStep = 50;
      for (let g = Math.ceil(v.yMin / gStep) * gStep; g <= v.yMax; g += gStep) {
        const yy = Math.round(y(g)) + 0.5;
        if (yy < top || yy > bot) continue;
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(plotR, yy);
        ctx.stroke();
        ctx.fillStyle = C.axis;
        ctx.textAlign = "left";
        ctx.fillText(g.toLocaleString("tr-TR"), plotR + 8, yy);
      }

      // --- kareler ---
      const nextRects: typeof rects.current = [];
      let firstOpen: number | null = null;
      for (const c of visible) {
        const key = c.id.toString();
        const xa = Math.max(0, x(c.resolveTime - step / 2) + 2);
        const xb = Math.min(plotR, x(c.resolveTime + step / 2) - 2);
        const ya = Math.max(top, y(c.high) + 2);
        const yb = Math.min(bot, y(c.low) - 2);
        const w = xb - xa;
        const h = yb - ya;
        if (w < 6 || h < 6) continue;
        const total = c.yesPool + c.noPool;
        const prob = total > 0n ? Number((c.yesPool * 10_000n) / total) / 10_000 : 0;
        const mult = c.yesPool > 0n ? (Number(total) * (1 - feeBps / 10_000)) / Number(c.yesPool) : 0;
        const open = c.status === 0 && now < c.closeTime;
        if (open && (firstOpen === null || c.resolveTime < firstOpen)) firstOpen = c.resolveTime;
        const finalYes = c.status === 3 && c.finalOutcome === 1;
        const propYes = c.status === 1 && c.proposedOutcome === 1;
        const isHover = hover.current.id === key;
        const isSel = selectedId === key;
        const myAmt = mine[key] ?? 0n;
        const liveInside = Math.abs(now - c.resolveTime) <= step / 2 && v.shown >= c.low && v.shown < c.high;

        let fill: string;
        if (finalYes) fill = rgba(C.yes, 0.34);
        else if (propYes) fill = rgba(C.yes, 0.18);
        else if (open) fill = rgba(C.accent, 0.035 + prob * 0.2 + (isHover ? 0.08 : 0));
        else fill = "rgba(255,255,255,0.025)";
        roundRect(ctx, xa, ya, w, h, 6);
        ctx.fillStyle = fill;
        ctx.fill();

        let stroke = "rgba(255,255,255,0.05)";
        let lw = 1;
        if (finalYes || propYes) stroke = rgba(C.yes, 0.6);
        if (liveInside) {
          stroke = rgba(C.yes, 0.9);
          lw = 1.5;
        }
        if (myAmt > 0n) {
          stroke = rgba(C.info, 0.95);
          lw = 2;
        }
        if (isHover && open) {
          stroke = rgba(C.accent, 0.8);
          lw = 1.5;
        }
        if (isSel) {
          stroke = rgba(C.accent, 1);
          lw = 2;
        }
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lw;
        roundRect(ctx, xa + lw / 2, ya + lw / 2, w - lw, h - lw, 6);
        ctx.stroke();

        // içerik
        const cx = xa + w / 2;
        const cy = ya + h / 2;
        ctx.textAlign = "center";
        if (open) {
          ctx.fillStyle = C.text;
          ctx.font = `600 ${w > 70 ? 13 : 11}px ${SANS}`;
          const label = mult >= 10 ? `${mult.toFixed(0)}x` : `${mult.toFixed(1)}x`;
          if (isHover && previewAmount > 0 && h > 40) {
            ctx.fillText(label, cx, cy - 8);
            ctx.fillStyle = rgba(C.accent, 1);
            ctx.font = `500 10px ${SANS}`;
            const tot = Number(total) / 1e6 + previewAmount;
            const yp = Number(c.yesPool) / 1e6 + previewAmount;
            const win = (previewAmount * tot * (1 - feeBps / 10_000)) / yp; // kendi tahmininin havuza etkisi dahil
            ctx.fillText(`${previewAmount} → ${win.toFixed(1)}`, cx, cy + 9);
          } else {
            ctx.fillText(label, cx, h > 38 ? cy - 6 : cy);
            if (h > 38) {
              ctx.fillStyle = C.muted;
              ctx.font = `10px ${SANS}`;
              ctx.fillText(`%${Math.round(prob * 100)}`, cx, cy + 9);
            }
          }
        } else if (c.status === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.22)";
          ctx.font = `500 10px ${SANS}`;
          if (h > 18 && w > 54) ctx.fillText(now < c.resolveTime ? "kilitli" : "çözülüyor", cx, cy);
        } else if (finalYes || propYes) {
          ctx.fillStyle = rgba(C.yes, 1);
          ctx.font = `600 12px ${SANS}`;
          ctx.fillText(w > 64 ? (finalYes ? "kapandı ✓" : "öneri ✓") : "✓", cx, cy);
        }
        if (myAmt > 0n && h > 22) {
          ctx.textAlign = "left";
          ctx.fillStyle = rgba(C.info, 1);
          ctx.font = `600 10px ${SANS}`;
          ctx.fillText(`● ${(Number(myAmt) / 1e6).toLocaleString("tr-TR")}`, xa + 6, ya + 10);
        }
        nextRects.push({ id: key, x: xa, y: ya, w, h, open });
      }
      rects.current = nextRects;

      // --- sütun başlıkları ---
      const cols = [...new Set(visible.map((c) => c.resolveTime))];
      ctx.textBaseline = "middle";
      for (const T of cols) {
        const xx = x(T);
        if (xx < 20 || xx > plotR - 10) continue;
        const sample = visible.find((c) => c.resolveTime === T)!;
        const open = sample.status === 0 && now < sample.closeTime;
        ctx.textAlign = "center";
        ctx.font = `600 11px ${SANS}`;
        ctx.fillStyle = open ? C.text : C.muted;
        ctx.fillText(hhmm(T), xx, 11);
        if (T === firstOpen) {
          const left = Math.max(0, Math.round(sample.closeTime - now));
          ctx.font = `500 10px ${SANS}`;
          ctx.fillStyle = rgba(C.accent, 1);
          ctx.fillText(`kapanış ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, xx, 24);
        }
      }

      // --- şimdi çizgisi ---
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(xNow) + 0.5, top);
      ctx.lineTo(Math.round(xNow) + 0.5, bot);
      ctx.stroke();
      ctx.setLineDash([]);

      // --- fiyat çizgisi (yumuşatılmış) + alan ---
      const path: [number, number][] = [];
      for (const pt of pts) if (pt.t >= t0 - 3 && pt.t <= now) path.push([x(pt.t), y(pt.p)]);
      path.push([xNow, y(v.shown)]);
      if (path.length > 1) {
        const trace = () => {
          ctx.moveTo(path[0][0], path[0][1]);
          for (let i = 1; i < path.length - 1; i++) {
            const mx = (path[i][0] + path[i + 1][0]) / 2;
            const my = (path[i][1] + path[i + 1][1]) / 2;
            ctx.quadraticCurveTo(path[i][0], path[i][1], mx, my);
          }
          ctx.lineTo(path[path.length - 1][0], path[path.length - 1][1]);
        };
        const grad = ctx.createLinearGradient(0, top, 0, bot);
        grad.addColorStop(0, rgba(C.accent, 0.16));
        grad.addColorStop(1, rgba(C.accent, 0));
        ctx.beginPath();
        trace();
        ctx.lineTo(xNow, bot);
        ctx.lineTo(path[0][0], bot);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        trace();
        ctx.strokeStyle = rgba(C.accent, 1);
        ctx.lineWidth = 2;
        ctx.shadowColor = rgba(C.accent, 0.55);
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // --- uç noktası, fiyat çizgisi ve eksen hapı ---
      const yHead = y(v.shown);
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = rgba(C.accent, 0.45);
      ctx.beginPath();
      ctx.moveTo(xNow, yHead);
      ctx.lineTo(plotR, yHead);
      ctx.stroke();
      ctx.setLineDash([]);
      const phase = (now % 1.6) / 1.6;
      ctx.beginPath();
      ctx.arc(xNow, yHead, 4 + phase * 9, 0, Math.PI * 2);
      ctx.fillStyle = rgba(C.accent, 0.35 * (1 - phase));
      ctx.fill();
      ctx.beginPath();
      ctx.arc(xNow, yHead, 4, 0, Math.PI * 2);
      ctx.fillStyle = rgba(C.accent, 1);
      ctx.fill();

      const pill = fmtPrice(v.shown);
      ctx.font = `600 11px ${MONO}`;
      const pw = Math.min(AXIS_W - 4, ctx.measureText(pill).width + 12);
      roundRect(ctx, plotR + 2, yHead - 10, pw, 20, 5);
      ctx.fillStyle = rgba(C.accent, 1);
      ctx.fill();
      ctx.fillStyle = "#171200";
      ctx.textAlign = "left";
      ctx.fillText(pill, plotR + 8, yHead + 0.5);

      // imleç
      const h0 = hover.current;
      const over = nextRects.find((r) => h0.x >= r.x && h0.x <= r.x + r.w && h0.y >= r.y && h0.y <= r.y + r.h);
      cv.style.cursor = over ? "pointer" : "default";
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const pick = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    return { px, py, hit: rects.current.find((c) => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h) };
  };

  return (
    <div ref={wrap} className="relative w-full select-none" style={{ height: p.height }}>
      <canvas
        ref={canvas}
        onPointerMove={(e) => {
          const { px, py, hit } = pick(e);
          hover.current = { id: hit?.id ?? null, x: px, y: py };
        }}
        onPointerLeave={() => (hover.current = { id: null, x: -1, y: -1 })}
        onClick={(e) => {
          const { hit } = pick(e as unknown as React.PointerEvent);
          if (hit) p.onSelect(hit.id);
        }}
      />
    </div>
  );
}
