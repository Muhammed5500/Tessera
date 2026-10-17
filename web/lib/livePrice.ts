"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Canlı fiyat (yalnız GÖSTERİM için): OKX herkese açık websocket'i + son 30 dk'lık 1 dk mumları.
 * Market sonuçları her zaman agent'ta ATK ile, kapanmış 1 dk mumlarından hesaplanır.
 */
export type PricePoint = { t: number; p: number }; // t: Unix saniye

const WS_URL = "wss://ws.okx.com:8443/ws/v5/public";
const REST = "https://www.okx.com/api/v5/market/candles";

export function useLivePrice(instId: string) {
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [last, setLast] = useState<PricePoint | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "offline">("connecting");
  const lastPush = useRef(0);

  useEffect(() => {
    let alive = true;
    fetch(`${REST}?instId=${instId}&bar=1m&limit=30`)
      .then((r) => r.json())
      .then((j: { data?: string[][] }) => {
        if (!alive || !j.data) return;
        const hist = j.data.map((row) => ({ t: Number(row[0]) / 1000 + 60, p: Number(row[4]) })).reverse();
        setPoints((cur) => [...hist, ...cur.filter((x) => x.t > (hist.at(-1)?.t ?? 0))]);
        if (hist.length) setLast((l) => l ?? hist.at(-1)!);
      })
      .catch(() => {});

    let ws: WebSocket | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        setStatus("live");
        ws?.send(JSON.stringify({ op: "subscribe", args: [{ channel: "tickers", instId }] }));
        ping = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 20_000);
      };
      ws.onmessage = (ev) => {
        if (ev.data === "pong") return;
        try {
          const m = JSON.parse(ev.data as string) as { data?: { last: string; ts: string }[] };
          const d = m.data?.[0];
          if (!d) return;
          const pt = { t: Number(d.ts) / 1000, p: Number(d.last) };
          setLast(pt);
          if (pt.t - lastPush.current >= 2) {
            lastPush.current = pt.t;
            setPoints((cur) => [...cur.filter((x) => x.t > pt.t - 40 * 60), pt]);
          }
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
    connect();
    return () => {
      alive = false;
      if (ping) clearInterval(ping);
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [instId]);

  return { points, last, status };
}
