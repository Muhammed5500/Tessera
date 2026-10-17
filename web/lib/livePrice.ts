"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Canlı fiyat (yalnız GÖSTERİM için): OKX herkese açık websocket'i + son 5 dk'lık 1 sn mumları.
 * Market sonuçları her zaman agent'ta ATK ile, kapanmış 1 dk mumlarından hesaplanır.
 *
 * Grafik 60 fps çizildiği için tik verisi React state'inde değil ref'te tutulur; metin göstergeleri için
 * saniyede ~4 kez güncellenen `last` state'i ayrıca verilir.
 */
export type PricePoint = { t: number; p: number }; // t: Unix saniye (ondalıklı)

const WS_URL = "wss://ws.okx.com:8443/ws/v5/public";
const REST = "https://www.okx.com/api/v5/market/candles";
const KEEP_SEC = 12 * 60;

export function useLivePrice(instId: string) {
  const ticks = useRef<PricePoint[]>([]);
  const [last, setLast] = useState<PricePoint | null>(null);
  const [open24h, setOpen24h] = useState<number | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");

  useEffect(() => {
    let alive = true;
    let lastUi = 0;
    const push = (pt: PricePoint) => {
      const arr = ticks.current;
      if (arr.length && pt.t <= arr[arr.length - 1].t) return;
      arr.push(pt);
      while (arr.length && arr[0].t < pt.t - KEEP_SEC) arr.shift();
      const now = performance.now();
      if (now - lastUi > 250) {
        lastUi = now;
        setLast(pt);
      }
    };

    // Geçmiş: önce 1 dk (eski kısım), sonra 1 sn (son 5 dk) mumlar
    Promise.all([
      fetch(`${REST}?instId=${instId}&bar=1m&limit=15`).then((r) => r.json()),
      fetch(`${REST}?instId=${instId}&bar=1s&limit=300`).then((r) => r.json()),
    ])
      .then(([m1, s1]: { data?: string[][] }[]) => {
        if (!alive) return;
        const sec = (s1.data ?? []).map((r) => ({ t: Number(r[0]) / 1000 + 1, p: Number(r[4]) })).reverse();
        const firstSec = sec[0]?.t ?? Infinity;
        const min = (m1.data ?? []).map((r) => ({ t: Number(r[0]) / 1000 + 60, p: Number(r[4]) })).reverse().filter((x) => x.t < firstSec);
        const live = ticks.current.filter((x) => x.t > (sec.at(-1)?.t ?? 0));
        ticks.current = [...min, ...sec, ...live];
        const lp = ticks.current.at(-1);
        if (lp) setLast(lp);
      })
      .catch(() => {});

    let ws: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (!alive) return;
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        setStatus("live");
        ws?.send(JSON.stringify({ op: "subscribe", args: [{ channel: "tickers", instId }] }));
        ping = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 20_000);
      };
      ws.onmessage = (ev) => {
        if (ev.data === "pong") return;
        try {
          const m = JSON.parse(ev.data as string) as { data?: { last: string; ts: string; open24h?: string }[] };
          const d = m.data?.[0];
          if (!d) return;
          if (d.open24h) setOpen24h(Number(d.open24h));
          push({ t: Number(d.ts) / 1000, p: Number(d.last) });
        } catch {
          /* yoksay */
        }
      };
      ws.onclose = () => {
        setStatus("offline");
        if (ping) clearInterval(ping);
        if (alive) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
    };
    // React geliştirme modundaki çift bağlama/sökme sırasında boşuna açılıp kapanmasın diye kısa gecikme
    const start = setTimeout(connect, 50);
    return () => {
      alive = false;
      clearTimeout(start);
      if (ping) clearInterval(ping);
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [instId]);

  return { ticks, last, open24h, status };
}
