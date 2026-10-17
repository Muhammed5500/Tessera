"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { decodeAbiParameters, parseUnits, type Address } from "viem";
import { mockUsdcAbi, predictionMarketAbi } from "@/lib/abi";
import { formatTR, formatUsdc, getMarket, PM_ADDRESS, publicClient, readContractParams, USDC_ADDRESS, type Market } from "@/lib/chain";
import { formatDuration, useNow, usePoll } from "@/lib/hooks";
import { useLivePrice } from "@/lib/livePrice";
import { useWallet } from "@/lib/wallet";

const INST = "BTC-USDT";
const STEP = 180; // ızgara sütunu (sn) — agent'ın GRID_STEP_SEC'i ile aynı
const PAST = 9 * 60;
const FUTURE = 16 * 60;
const H = 420;

type Cell = Market & { low: number; high: number };

/** Son N marketten ızgara (şablon 3) karelerini okur. */
async function getGridCells(): Promise<Cell[]> {
  const n = await publicClient.readContract({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "marketCount" });
  const from = n > 160n ? n - 159n : 1n;
  const ids = Array.from({ length: Number(n - from + 1n) }, (_, i) => from + BigInt(i));
  const ms = await Promise.all(ids.map(getMarket));
  return ms
    .filter((m) => m.templateId === 3)
    .map((m) => {
      const [, , low, high] = decodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "int256" }, { type: "int256" }], m.params);
      return { ...m, low: Number(low) / 1e8, high: Number(high) / 1e8 };
    });
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

const fmtUsd = (p: number) => p.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
const OUT = ["", "EVET", "HAYIR", "GEÇERSİZ"];

export default function GridPage() {
  const now = useNow();
  const { points, last, status } = useLivePrice(INST);
  const cells = usePoll(getGridCells, 6_000);
  const params = usePoll(readContractParams, 60_000);
  const { address, connect, write, busy } = useWallet();
  const { ref, w } = useWidth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState("5");
  const [mine, setMine] = useState<Record<string, { yes: bigint; payout: bigint; claimed: boolean }>>({});
  const [allowance, setAllowance] = useState<bigint>(0n);

  const t0 = now - PAST;
  const t1 = now + FUTURE;
  // Agent'ın başlangıç likiditesi (iki taraf) tamamlanmamış yeni kareler gösterilmez
  const visible = useMemo(
    () =>
      (cells.data ?? []).filter(
        (c) => c.resolveTime + STEP / 2 >= t0 && c.resolveTime - STEP / 2 <= t1 && (c.status !== 0 || (c.yesPool > 0n && c.noPool > 0n)),
      ),
    [cells.data, t0, t1],
  );

  // Kullanıcının pozisyonları ve onay miktarı
  useEffect(() => {
    if (!address || !visible.length) return;
    (async () => {
      const res = await Promise.all(
        visible.map(async (c) => {
          const [pos, payout] = await Promise.all([
            publicClient.readContract({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "getPosition", args: [c.id, address as Address] }),
            publicClient.readContract({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "previewPayout", args: [c.id, address as Address] }),
          ]);
          return [c.id.toString(), { yes: pos[0], payout, claimed: pos[2] }] as const;
        }),
      );
      setMine(Object.fromEntries(res));
      setAllowance(await publicClient.readContract({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "allowance", args: [address as Address, PM_ADDRESS] }));
    })().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, cells.data]);

  // Y ekseni: görünen bantlar + fiyat noktaları
  const recent = points.filter((p) => p.t >= t0);
  const ys = [...visible.flatMap((c) => [c.low, c.high]), ...recent.map((p) => p.p), ...(last ? [last.p] : [])];
  const pad = 20;
  let yMin = ys.length ? Math.min(...ys) - pad : 0;
  let yMax = ys.length ? Math.max(...ys) + pad : 1;
  if (yMax - yMin < 200) {
    const mid = (yMax + yMin) / 2;
    yMin = mid - 100;
    yMax = mid + 100;
  }
  const x = (t: number) => ((t - t0) / (t1 - t0)) * w;
  const y = (p: number) => H - ((p - yMin) / (yMax - yMin)) * H;

  const feeBps = params.data?.feeBps ?? 100;
  const selected = visible.find((c) => c.id.toString() === selectedId) ?? (cells.data ?? []).find((c) => c.id.toString() === selectedId) ?? null;

  const path = recent.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / 50) * 50; v <= yMax; v += 50) yTicks.push(v);
  const columns = [...new Set(visible.map((c) => c.resolveTime))].sort();

  async function placeBet(c: Cell) {
    if (!address) return connect();
    let amt: bigint;
    try {
      amt = parseUnits(amount.replace(",", "."), 6);
    } catch {
      return;
    }
    if (amt <= 0n) return;
    if (allowance < amt) {
      const want = amt > parseUnits("100", 6) ? amt : parseUnits("100", 6);
      const ok = await write({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "approve", args: [PM_ADDRESS, want], label: "Hızlı mod: 100 kUSDC onayı" });
      if (!ok) return;
      setAllowance(want);
    }
    const ok = await write({
      address: PM_ADDRESS,
      abi: predictionMarketAbi,
      functionName: "bet",
      args: [c.id, true, amt],
      label: `Kare: ${fmtUsd(c.low)}–${fmtUsd(c.high)} $ · ${formatTR(c.resolveTime)} · ${amount} kUSDC`,
    });
    if (ok) {
      setAllowance((a) => (a > amt ? a - amt : 0n));
      cells.refresh();
    }
  }

  async function claim(c: Cell) {
    const ok = await write({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "claim", args: [c.id], label: "Ödül alındı" });
    if (ok) cells.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Canlı ızgara · BTC-USDT</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Her kare bir market: "BTC o saatte bu 50 $'lık aralıkta kapanır mı?" Kareye tıkla, tahminini koy. Sonucu agent OKX'in 1 dakikalık mumuyla
            çözer ve kanıtını Avalanche'a yazar. Çarpan havuzdan gelir: kalabalık az olan kare daha çok öder.
          </p>
        </div>
        <div className="text-right">
          <div className="mono text-2xl font-bold">{last ? `${fmtUsd(last.p)} $` : "…"}</div>
          <div className={`text-xs ${status === "live" ? "text-yes" : "text-warn"}`}>{status === "live" ? "● canlı · OKX" : status === "connecting" ? "bağlanıyor…" : "bağlantı yok"}</div>
        </div>
      </div>

      <div ref={ref} className="card relative overflow-hidden p-0" style={{ height: H }}>
        <svg width={w} height={H} className="absolute inset-0">
          {/* gelecek bölgesi */}
          <rect x={x(now)} y={0} width={Math.max(0, w - x(now))} height={H} fill="var(--panel-2)" opacity={0.5} />
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={0} x2={w} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray="2 4" />
              <text x={4} y={y(v) - 3} fontSize={10} fill="var(--muted)" className="mono">
                {fmtUsd(v)}
              </text>
            </g>
          ))}
          {columns.map((t) => (
            <text key={t} x={x(t)} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--muted)" className="mono">
              {formatTR(t).split(" ")[1]}
            </text>
          ))}
          <line x1={x(now)} x2={x(now)} y1={0} y2={H} stroke="var(--accent)" strokeWidth={1} opacity={0.7} />
          <text x={x(now) + 4} y={14} fontSize={10} fill="var(--accent)">
            şimdi
          </text>
          {path && <path d={path} fill="none" stroke="var(--text)" strokeWidth={1.8} />}
          {last && (
            <>
              <line x1={0} x2={w} y1={y(last.p)} y2={y(last.p)} stroke="var(--accent)" strokeDasharray="4 4" opacity={0.5} />
              <circle cx={x(Math.min(last.t, now))} cy={y(last.p)} r={4} fill="var(--accent)" />
            </>
          )}
        </svg>

        {/* Kareler */}
        {visible.map((c) => {
          const left = x(c.resolveTime - STEP / 2) + 1.5;
          const width = x(c.resolveTime + STEP / 2) - x(c.resolveTime - STEP / 2) - 3;
          const top = y(c.high) + 1;
          const height = y(c.low) - y(c.high) - 2;
          if (width < 8 || height < 8) return null;
          const total = c.yesPool + c.noPool;
          const prob = total > 0n ? Number((c.yesPool * 10_000n) / total) / 10_000 : 0;
          const mult = c.yesPool > 0n ? (Number(total) * (1 - feeBps / 10_000)) / Number(c.yesPool) : 0;
          const open = c.status === 0 && now < c.closeTime;
          const final = c.status === 3;
          const won = final && c.finalOutcome === 1;
          const pending = !open && !final;
          const my = mine[c.id.toString()];
          const isSel = c.id.toString() === selectedId;
          const bg = won
            ? "color-mix(in srgb, var(--yes) 55%, transparent)"
            : final
              ? "color-mix(in srgb, var(--line) 35%, transparent)"
              : open
                ? `color-mix(in srgb, var(--accent) ${Math.round(8 + prob * 60)}%, transparent)`
                : "color-mix(in srgb, var(--muted) 18%, transparent)";
          return (
            <button
              key={c.id.toString()}
              onClick={() => setSelectedId(c.id.toString())}
              title={c.question}
              className="absolute flex flex-col items-center justify-center rounded-md text-[10px] leading-tight transition hover:brightness-125"
              style={{
                left,
                top,
                width,
                height,
                background: bg,
                border: isSel ? "2px solid var(--accent)" : my && my.yes > 0n ? "2px solid var(--info)" : "1px solid var(--line)",
                cursor: "pointer",
                opacity: pending ? 0.7 : 1,
              }}
            >
              {open && <span className="mono font-bold">x{mult >= 10 ? mult.toFixed(0) : mult.toFixed(1)}</span>}
              {open && height > 30 && <span className="text-muted">%{Math.round(prob * 100)}</span>}
              {pending && <span className="text-muted">⏳</span>}
              {final && <span className={won ? "font-bold" : "text-muted"}>{won ? "✓" : c.finalOutcome === 3 ? "∅" : ""}</span>}
              {my && my.yes > 0n && height > 40 && <span className="text-info">● {formatUsdc(my.yes)}</span>}
            </button>
          );
        })}

        {cells.loading && !cells.data && <div className="absolute inset-0 grid place-items-center text-sm text-muted">Izgara yükleniyor…</div>}
        {cells.data && visible.length === 0 && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">
            Şu an görünür ızgara karesi yok. Agent'ın ızgara yapıcısı (GRID_ENABLED) çalışıyorsa birkaç dakika içinde sütunlar belirir.
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted">
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: "color-mix(in srgb, var(--accent) 50%, transparent)" }} />
          açık (renk = olasılık)
        </span>
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: "color-mix(in srgb, var(--muted) 30%, transparent)" }} />
          kapandı / çözülüyor ⏳
        </span>
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded-sm align-middle" style={{ background: "color-mix(in srgb, var(--yes) 55%, transparent)" }} />
          fiyat bu karede kapandı ✓
        </span>
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded-sm border-2 border-info align-middle" /> senin pozisyonun
        </span>
      </div>

      {selected && (
        <div className="card fixed bottom-3 left-1/2 z-40 w-[min(94vw,520px)] -translate-x-1/2 space-y-3 p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs text-muted">
                Kare #{selected.id.toString()} · ölçüm {formatTR(selected.resolveTime)}
              </div>
              <div className="font-semibold">
                BTC {fmtUsd(selected.low)} – {fmtUsd(selected.high)} $ aralığında kapanır mı?
              </div>
            </div>
            <button className="text-muted hover:text-text" onClick={() => setSelectedId(null)}>
              ✕
            </button>
          </div>

          {(() => {
            const c = selected;
            const total = c.yesPool + c.noPool;
            const open = c.status === 0 && now < c.closeTime;
            const my = mine[c.id.toString()];
            let amt = 0n;
            try {
              amt = parseUnits(amount.replace(",", ".") || "0", 6);
            } catch {
              amt = 0n;
            }
            const est = amt > 0n ? ((amt * (total + amt) * BigInt(10_000 - feeBps)) / 10_000n) / (c.yesPool + amt) : 0n;
            if (open) {
              return (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {["1", "5", "10", "25"].map((v) => (
                      <button key={v} className={`pill ${amount === v ? "pill-final" : ""}`} onClick={() => setAmount(v)}>
                        {v}
                      </button>
                    ))}
                    <input className="field mono w-24" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <span className="text-xs text-muted">kUSDC</span>
                  </div>
                  <div className="text-xs text-muted">
                    Kazanırsan yaklaşık <b className="text-text">{formatUsdc(est)} kUSDC</b> · tahminler {formatDuration(c.closeTime - now)} sonra kapanır
                    {allowance < amt && address ? " · ilk seferde 100 kUSDC hızlı mod onayı istenir" : ""}
                  </div>
                  <button className="btn btn-accent w-full" disabled={!!busy || amt <= 0n} onClick={() => placeBet(c)}>
                    {!address ? "Cüzdan bağla" : busy ?? "Bu kareye tahmin koy"}
                  </button>
                </>
              );
            }
            if (c.status === 3) {
              return (
                <div className="space-y-2 text-sm">
                  <div>
                    Sonuç: <b>{OUT[c.finalOutcome]}</b>{" "}
                    <Link className="link text-xs" href={`/market/${c.id}`}>
                      kanıtı gör
                    </Link>
                  </div>
                  {my && my.payout > 0n && !my.claimed && (
                    <button className="btn btn-accent w-full" disabled={!!busy} onClick={() => claim(c)}>
                      {formatUsdc(my.payout)} kUSDC al
                    </button>
                  )}
                </div>
              );
            }
            return (
              <div className="text-sm text-muted">
                Tahminler kapandı. {now < c.resolveTime ? `Ölçüme ${formatDuration(c.resolveTime - now)}.` : "Agent sonucu çözüyor."}{" "}
                <Link className="link" href={`/market/${c.id}`}>
                  Ayrıntı
                </Link>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
