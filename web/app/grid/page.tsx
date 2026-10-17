"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { decodeAbiParameters, parseUnits, type Address } from "viem";
import { AssetIcon } from "@/components/ui";
import { GridCanvas, type GridCell } from "@/components/grid/GridCanvas";
import { mockUsdcAbi, predictionMarketAbi } from "@/lib/abi";
import { bandLabel, getMarket, PM_ADDRESS, publicClient, readContractParams, USDC_ADDRESS, type Market } from "@/lib/chain";
import { useNow, usePoll } from "@/lib/hooks";
import { useLivePrice } from "@/lib/livePrice";
import { useWallet } from "@/lib/wallet";

const INST = "BTC-USDT";
const STEP = 180; // agent'ın GRID_STEP_SEC'i ile aynı
const PAST = 6 * 60;
const FUTURE = 15 * 60;
const QUICK = [5, 10, 25, 50];

type Cell = Market & GridCell;

/** Kesinleşmiş ya da ızgara dışı marketler değişmez → bir kez okunur. */
const frozen = new Map<string, Cell | null>();

async function getGridCells(): Promise<Cell[]> {
  const n = await publicClient.readContract({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "marketCount" });
  const from = n > 200n ? n - 199n : 1n;
  const ids = Array.from({ length: Number(n - from + 1n) }, (_, i) => from + BigInt(i));
  const out = await Promise.all(
    ids.map(async (id): Promise<Cell | null> => {
      const k = id.toString();
      if (frozen.has(k)) return frozen.get(k)!;
      const m = await getMarket(id);
      if (m.templateId !== 3) {
        frozen.set(k, null);
        return null;
      }
      const [, , low, high] = decodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "int256" }, { type: "int256" }], m.params);
      const cell = { ...m, low: Number(low) / 1e8, high: Number(high) / 1e8 };
      if (m.status === 3) frozen.set(k, cell);
      return cell;
    }),
  );
  // Agent'ın başlangıç likiditesi tamamlanmamış kareler gösterilmez
  const cells = out.filter((c): c is Cell => c !== null && (c.status !== 0 || (c.yesPool > 0n && c.noPool > 0n)));
  // Aynı sütun + bant için birden fazla market varsa (eski çift açılış hatası) havuzu en büyük olanı göster;
  // aksi halde kareler üst üste çizilir
  const best = new Map<string, Cell>();
  for (const c of cells) {
    const k = `${c.resolveTime}|${c.low}|${c.high}`;
    const cur = best.get(k);
    if (!cur || c.yesPool + c.noPool > cur.yesPool + cur.noPool) best.set(k, c);
  }
  return [...best.values()];
}

type Position = { id: string; yes: bigint; payout: bigint; claimed: boolean };

/** Kullanıcının son ~1 saatteki tahminleri (BetPlaced olayları) + ödül durumu. */
async function getPositions(user: Address): Promise<Position[]> {
  const head = await publicClient.getBlockNumber();
  const logs = await publicClient.getContractEvents({
    address: PM_ADDRESS,
    abi: predictionMarketAbi,
    eventName: "BetPlaced",
    fromBlock: head > 1800n ? head - 1800n : 0n,
    toBlock: head,
    args: { user },
  });
  const ids = [...new Set(logs.map((l) => (l.args.id as bigint).toString()))];
  return Promise.all(
    ids.map(async (k) => {
      const id = BigInt(k);
      const [pos, payout] = await Promise.all([
        publicClient.readContract({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "getPosition", args: [id, user] }),
        publicClient.readContract({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "previewPayout", args: [id, user] }),
      ]);
      return { id: k, yes: pos[0], payout, claimed: pos[2] };
    }),
  );
}

const usd = (p: number, d = 0) => p.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const hhmm = (t: number) => new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.floor(s) % 60)).padStart(2, "0")}`;
const kusdc = (v: bigint) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });

function multOf(c: Cell, feeBps: number) {
  const total = c.yesPool + c.noPool;
  return c.yesPool > 0n ? (Number(total) * (1 - feeBps / 10_000)) / Number(c.yesPool) : 0;
}
function probOf(c: Cell) {
  const total = c.yesPool + c.noPool;
  return total > 0n ? Number((c.yesPool * 10_000n) / total) / 10_000 : 0;
}

export default function GridPage() {
  const now = useNow();
  const { ticks, last, open24h, status } = useLivePrice(INST);
  const cells = usePoll(getGridCells, 5_000);
  const params = usePoll(readContractParams, 60_000);
  const { address, connect, write, busy } = useWallet();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [preview, setPreview] = useState(10);
  const [positions, setPositions] = useState<Position[]>([]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [height, setHeight] = useState(460);

  useEffect(() => {
    const f = () => setHeight(window.innerWidth < 640 ? 360 : 460);
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!address) return;
    const [bal, allw, pos] = await Promise.all([
      publicClient.readContract({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "balanceOf", args: [address] }),
      publicClient.readContract({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "allowance", args: [address, PM_ADDRESS] }),
      getPositions(address).catch(() => null),
    ]);
    setBalance(bal);
    setAllowance(allw);
    if (pos) setPositions(pos);
  }, [address]);

  useEffect(() => {
    refreshUser();
    const t = setInterval(refreshUser, 12_000);
    return () => clearInterval(t);
  }, [refreshUser]);

  const feeBps = params.data?.feeBps ?? 100;
  const all = cells.data ?? [];
  const byId = useMemo(() => new Map(all.map((c) => [c.id.toString(), c])), [all]);
  const mine = useMemo(() => Object.fromEntries(positions.map((p) => [p.id, p.yes])), [positions]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const nextClose = all.filter((c) => c.status === 0 && c.closeTime > now).sort((a, b) => a.closeTime - b.closeTime)[0];
  const change = last && open24h ? ((last.p - open24h) / open24h) * 100 : null;

  async function bet(c: Cell, amountStr: string) {
    if (!address) return connect();
    let amt: bigint;
    try {
      amt = parseUnits(amountStr.replace(",", "."), 6);
    } catch {
      return;
    }
    if (amt <= 0n) return;
    if ((balance ?? 0n) < amt) {
      const ok = await write({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "faucet", label: "Received 1,000 test kUSDC" });
      if (!ok) return;
    }
    if (allowance < amt) {
      const want = amt > parseUnits("100", 6) ? amt : parseUnits("100", 6);
      const ok = await write({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "approve", args: [PM_ADDRESS, want], label: "Quick mode on (100 kUSDC approved)" });
      if (!ok) return;
      setAllowance(want);
    }
    const ok = await write({
      address: PM_ADDRESS,
      abi: predictionMarketAbi,
      functionName: "bet",
      args: [c.id, true, amt],
      label: `${hhmm(c.resolveTime)} · ${bandLabel(c.low, c.high)} · ${amountStr} kUSDC`,
    });
    if (ok) {
      cells.refresh();
      refreshUser();
    }
  }

  async function claim(id: string) {
    const ok = await write({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "claim", args: [BigInt(id)], label: "Payout claimed" });
    if (ok) refreshUser();
  }

  return (
    <div className="space-y-5">
      {/* Üst şerit */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div className="mr-auto">
          <div className="flex items-center gap-2">
            <AssetIcon instId="BTC-USDT" size={28} />
            <h1 className="text-lg font-semibold">BTC · 3-minute grid</h1>
            <span className={`ml-1 inline-flex items-center gap-1.5 text-xs ${status === "live" ? "text-yes" : "text-muted"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "animate-pulse bg-yes" : "bg-muted"}`} />
              {status === "live" ? "LIVE" : "Connecting"}
            </span>
          </div>
        </div>
        <div>
          <div className="label">BTC</div>
          <div className="tabular text-2xl font-semibold text-accent">{last ? usd(last.p, 1) : "—"}</div>
          {change !== null && (
            <div className={`tabular text-xs ${change >= 0 ? "text-yes" : "text-no"}`}>
              {change >= 0 ? "+" : "−"}
              {Math.abs(change).toFixed(2)}%
            </div>
          )}
        </div>
        <div>
          <div className="label">Next close</div>
          <div className="tabular text-2xl font-semibold text-no">{nextClose ? mmss(nextClose.closeTime - now) : "—"}</div>
        </div>
        {address && (
          <div>
            <div className="label">Balance</div>
            <div className="tabular text-2xl font-semibold">{balance !== null ? kusdc(balance) : "—"}</div>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        {/* Grafik */}
        <div className="card overflow-hidden p-2 sm:p-3">
          {cells.data || last ? (
            <GridCanvas
              ticks={ticks}
              cells={all}
              mine={mine}
              selectedId={selectedId}
              onSelect={(id) => setSelectedId(id)}
              feeBps={feeBps}
              step={STEP}
              past={PAST}
              future={FUTURE}
              height={height}
              previewAmount={preview}
            />
          ) : (
            <div className="grid place-items-center text-sm text-muted" style={{ height }}>
              Loading…
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 pt-2 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-sm border-2 border-info" /> your position
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-sm bg-yes/50" /> winning square
            </span>
          </div>
        </div>

        {/* İşlem paneli */}
        <aside className="card h-fit p-4 lg:sticky lg:top-20">
          {!selected ? (
            <div className="space-y-4">
              <div>
                <div className="text-[15px] font-medium">Pick a square</div>
                <p className="mt-1 text-sm text-muted">Tap the square where you think the price will close.</p>
              </div>
              {!address && (
                <button className="btn btn-accent w-full" onClick={connect}>
                  Connect wallet
                </button>
              )}
            </div>
          ) : (
            <SelectedPanel
              c={selected}
              now={now}
              feeBps={feeBps}
              address={address}
              busy={busy}
              position={positions.find((p) => p.id === selectedId)}
              custom={custom}
              setCustom={setCustom}
              onPreview={setPreview}
              onBet={(a) => bet(selected, a)}
              onClaim={() => claim(selected.id.toString())}
              onClose={() => setSelectedId(null)}
              connect={connect}
            />
          )}
        </aside>
      </div>

      {/* Pozisyonlarım */}
      {address && (
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">My positions</h2>
          </div>
          {positions.length === 0 ? (
            <p className="text-sm text-muted">No positions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tabular w-full text-sm">
                <thead className="label text-left">
                  <tr>
                    <th className="py-1.5 pr-4 font-normal">Time</th>
                    <th className="py-1.5 pr-4 font-normal">Range</th>
                    <th className="py-1.5 pr-4 font-normal">Stake</th>
                    <th className="py-1.5 pr-4 font-normal">Status</th>
                    <th className="py-1.5 font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {[...positions]
                    .sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)))
                    .map((p) => {
                      const c = byId.get(p.id);
                      if (!c) return null;
                      const won = c.status === 3 && c.finalOutcome === 1;
                      const lost = c.status === 3 && c.finalOutcome === 2;
                      const stat =
                        c.status === 0 && now < c.closeTime
                          ? { t: `open · ${mmss(c.closeTime - now)}`, cls: "text-text" }
                          : c.status === 3
                            ? won
                              ? { t: "won", cls: "text-yes" }
                              : lost
                                ? { t: "lost", cls: "text-no" }
                                : { t: "void · refunded", cls: "text-muted" }
                            : c.status === 1
                              ? { t: c.proposedOutcome === 1 ? "proposed Yes · finalizing" : "proposed No · finalizing", cls: "text-muted" }
                              : { t: "awaiting close", cls: "text-muted" };
                      return (
                        <tr key={p.id} className="border-t border-line">
                          <td className="py-2 pr-4">{hhmm(c.resolveTime)}</td>
                          <td className="py-2 pr-4">
                            {bandLabel(c.low, c.high)}
                          </td>
                          <td className="py-2 pr-4">{kusdc(p.yes)} kUSDC</td>
                          <td className={`py-2 pr-4 ${stat.cls}`}>{stat.t}</td>
                          <td className="py-2 text-right">
                            {p.payout > 0n && !p.claimed ? (
                              <button className="btn btn-accent px-3 py-1 text-xs" disabled={!!busy} onClick={() => claim(p.id)}>
                                Claim {kusdc(p.payout)}
                              </button>
                            ) : p.claimed ? (
                              <span className="label">claimed</span>
                            ) : (
                              <Link className="label hover:text-text" href={`/market/${p.id}`}>
                                evidence →
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SelectedPanel(props: {
  c: Cell;
  now: number;
  feeBps: number;
  address?: Address;
  busy: string | null;
  position?: Position;
  custom: string;
  setCustom: (s: string) => void;
  onPreview: (n: number) => void;
  onBet: (amount: string) => void;
  onClaim: () => void;
  onClose: () => void;
  connect: () => void;
}) {
  const { c, now, feeBps } = props;
  const open = c.status === 0 && now < c.closeTime;
  const mult = multOf(c, feeBps);
  const prob = probOf(c);
  const est = (a: number) => {
    // kendi tahmininin havuzu büyütmesini de hesaba kat
    const total = Number(c.yesPool + c.noPool) / 1e6 + a;
    const yes = Number(c.yesPool) / 1e6 + a;
    return (a * total * (1 - feeBps / 10_000)) / yes;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="label">
            {hhmm(c.resolveTime)} close · square #{c.id.toString()}
          </div>
          <div className="tabular mt-0.5 text-lg font-semibold">
            {bandLabel(c.low, c.high)}
          </div>
        </div>
        <button className="text-muted hover:text-text" onClick={props.onClose} aria-label="Close">
          ✕
        </button>
      </div>

      {open ? (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-panel-2 py-2">
              <div className="tabular text-lg font-semibold text-accent">{mult >= 10 ? mult.toFixed(0) : mult.toFixed(1)}x</div>
              <div className="label">payout</div>
            </div>
            <div className="rounded-lg bg-panel-2 py-2">
              <div className="tabular text-lg font-semibold">{Math.round(prob * 100)}%</div>
              <div className="label">chance</div>
            </div>
            <div className="rounded-lg bg-panel-2 py-2">
              <div className="tabular text-lg font-semibold">{mmss(c.closeTime - now)}</div>
              <div className="label">closes in</div>
            </div>
          </div>

          <div>
            <div className="grid grid-cols-2 gap-2">
              {QUICK.map((a) => (
                <button
                  key={a}
                  className="rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-left transition hover:border-accent/70 disabled:opacity-50"
                  disabled={!!props.busy}
                  onMouseEnter={() => props.onPreview(a)}
                  onClick={() => (props.address ? props.onBet(String(a)) : props.connect())}
                >
                  <div className="tabular font-semibold">{a} kUSDC</div>
                  <div className="tabular text-xs text-yes">to win {est(a).toFixed(1)}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <input
              className="field tabular"
              inputMode="decimal"
              placeholder="Other amount"
              value={props.custom}
              onChange={(e) => props.setCustom(e.target.value)}
            />
            <button className="btn btn-accent shrink-0" disabled={!!props.busy || !props.custom} onClick={() => props.onBet(props.custom)}>
              Buy
            </button>
          </div>
          {props.busy && <div className="text-xs text-accent">{props.busy}…</div>}
        </>
      ) : (
        <div className="space-y-3 text-sm">
          {c.status === 3 ? (
            <div className={`rounded-lg p-3 ${c.finalOutcome === 1 ? "bg-yes/15 text-yes" : "bg-panel-2 text-muted"}`}>
              {c.finalOutcome === 1 ? "Winning square" : c.finalOutcome === 2 ? "Price didn't close here" : "Void · refunded"}
            </div>
          ) : c.status === 1 ? (
            <div className="rounded-lg bg-panel-2 p-3 text-muted">
              Result proposed: <b className="text-text">{c.proposedOutcome === 1 ? "Yes" : "No"}</b>
            </div>
          ) : (
            <div className="rounded-lg bg-panel-2 p-3 text-muted">
              {now < c.resolveTime ? `Locked · closes in ${mmss(c.resolveTime - now)}` : "Resolving…"}
            </div>
          )}
          {props.position && props.position.payout > 0n && !props.position.claimed && (
            <button className="btn btn-accent w-full" disabled={!!props.busy} onClick={props.onClaim}>
              Claim {kusdc(props.position.payout)} kUSDC
            </button>
          )}
        </div>
      )}

      {props.position && props.position.yes > 0n && (
        <div className="rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs text-info">Your position: {kusdc(props.position.yes)} kUSDC</div>
      )}
      <Link href={`/market/${c.id}`} className="label block hover:text-text">
        Details →
      </Link>
    </div>
  );
}

