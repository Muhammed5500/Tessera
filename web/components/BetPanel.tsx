"use client";

import { useEffect, useState } from "react";
import { parseUnits, type Address } from "viem";
import { mockUsdcAbi, predictionMarketAbi } from "@/lib/abi";
import { formatUsdc, PM_ADDRESS, publicClient, USDC_ADDRESS, type Market } from "@/lib/chain";
import { formatDuration } from "@/lib/hooks";
import { useWallet } from "@/lib/wallet";

async function readUser(addr: Address, id: bigint) {
  const [balance, allowance, pos, payout] = await Promise.all([
    publicClient.readContract({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "balanceOf", args: [addr] }),
    publicClient.readContract({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "allowance", args: [addr, PM_ADDRESS] }),
    publicClient.readContract({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "getPosition", args: [id, addr] }),
    publicClient.readContract({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "previewPayout", args: [id, addr] }),
  ]);
  return { balance, allowance, yes: pos[0], no: pos[1], claimed: pos[2], payout };
}

/** Tahmin, claim ve itiraz paneli. */
export function BetPanel({
  m,
  now,
  disputeWindow,
  disputeBond,
  feeBps,
  onDone,
  side: sideProp,
  onSideChange,
}: {
  m: Market;
  now: number;
  disputeWindow: number;
  disputeBond: bigint;
  feeBps: number;
  onDone: () => void;
  /** Sayfadaki satır butonlarıyla taraf seçilebilsin diye isteğe bağlı kontrol */
  side?: boolean;
  onSideChange?: (yes: boolean) => void;
}) {
  const { address, connect, write, busy } = useWallet();
  const [sideState, setSideState] = useState<boolean>(true);
  const side = sideProp ?? sideState;
  const setSide = (v: boolean) => (onSideChange ? onSideChange(v) : setSideState(v));
  const [amount, setAmount] = useState("10");
  const [user, setUser] = useState<Awaited<ReturnType<typeof readUser>> | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!address) return setUser(null);
    readUser(address, m.id).then(setUser).catch(() => {});
  }, [address, m.id, m.status, tick]);

  const refresh = () => {
    setTick((t) => t + 1);
    onDone();
  };

  const open = m.status === 0 && now < m.closeTime;
  const inDispute = m.status === 1 && now < m.proposedAt + disputeWindow;
  const finalized = m.status === 3;

  let amt: bigint | null = null;
  try {
    amt = amount ? parseUnits(amount.replace(",", "."), 6) : null;
  } catch {
    amt = null;
  }

  const total = m.yesPool + m.noPool;
  const sidePool = side ? m.yesPool : m.noPool;
  const estPayout =
    amt && amt > 0n ? ((amt * (total + amt) * BigInt(10_000 - feeBps)) / 10_000n) / (sidePool + amt) : null;

  async function placeBet() {
    if (!address || !amt) return;
    if ((user?.balance ?? 0n) < amt) {
      const ok = await write({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "faucet", label: "Low balance → received 1,000 test kUSDC" });
      if (!ok) return;
    }
    if ((user?.allowance ?? 0n) < amt) {
      const ok = await write({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "approve", args: [PM_ADDRESS, amt], label: "Approved" });
      if (!ok) return;
    }
    const ok = await write({
      address: PM_ADDRESS,
      abi: predictionMarketAbi,
      functionName: "bet",
      args: [m.id, side, amt],
      label: `Bought ${side ? "Yes" : "No"} · ${amount} kUSDC`,
    });
    if (ok) refresh();
  }

  async function claim() {
    const ok = await write({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "claim", args: [m.id], label: "Payout claimed" });
    if (ok) refresh();
  }

  async function dispute() {
    if ((user?.allowance ?? 0n) < disputeBond) {
      const ok = await write({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "approve", args: [PM_ADDRESS, disputeBond], label: "Bond approved" });
      if (!ok) return;
    }
    const ok = await write({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "dispute", args: [m.id], label: "Dispute opened" });
    if (ok) refresh();
  }

  const yesPct = total > 0n ? Number((m.yesPool * 10_000n) / total) / 100 : null;
  const sidePct = yesPct === null ? null : side ? yesPct : 100 - yesPct;

  return (
    <div className="card overflow-hidden">
      {open && (
        <div className="p-4">
          <div className="mb-4 flex items-center gap-4 border-b border-line text-sm">
            <span className="-mb-px border-b-2 border-text pb-2.5 font-medium">Buy</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {([true, false] as const).map((v) => {
              const active = side === v;
              const pct = yesPct === null ? 50 : v ? yesPct : 100 - yesPct;
              return (
                <button
                  key={String(v)}
                  onClick={() => setSide(v)}
                  className={`rounded-lg py-3 text-[15px] font-semibold transition-colors ${
                    active ? (v ? "bg-yes text-[#04130d]" : "bg-no text-white") : "bg-panel-2 text-muted hover:text-text"
                  }`}
                >
                  {v ? "Yes" : "No"} <span className="tabular">{pct.toFixed(0)}¢</span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <div>
              <div className="text-[15px] font-medium">Amount</div>
              {user && (
                <button className="tabular text-xs text-muted hover:text-text" onClick={() => setAmount((Number(user.balance) / 1e6).toFixed(0))}>
                  Balance {formatUsdc(user.balance, 0)}
                </button>
              )}
            </div>
            <div className="flex min-w-0 items-baseline justify-end">
              <span className="mr-0.5 text-2xl font-semibold text-muted">$</span>
              <input
                className="tabular min-w-[1ch] max-w-[7ch] bg-transparent text-right text-3xl font-semibold outline-none placeholder:text-muted"
                style={{ width: `${Math.max(1, amount.length) + 0.3}ch` }}
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-1.5">
            {[1, 5, 10, 100].map((v) => (
              <button
                key={v}
                className="tabular rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:border-[#3a4350] hover:text-text"
                onClick={() => setAmount(String((Number(amount.replace(",", ".")) || 0) + v))}
              >
                +{v}
              </button>
            ))}
          </div>

          {estPayout !== null && amt && amt > 0n && (
            <div className="mt-5 flex items-end justify-between border-t border-line pt-4">
              <div>
                <div className="text-[15px] font-medium">To win</div>
                <div className="tabular text-xs text-muted">Avg. price {sidePct === null ? "—" : `${sidePct.toFixed(0)}¢`}</div>
              </div>
              <div className="tabular text-3xl font-semibold text-yes">${formatUsdc(estPayout)}</div>
            </div>
          )}

          {!address ? (
            <button className="btn btn-accent mt-5 w-full py-3 text-[15px]" onClick={connect}>
              Connect wallet
            </button>
          ) : (
            <button
              className={`mt-5 w-full rounded-lg py-3 text-[15px] font-semibold transition-opacity disabled:opacity-40 ${
                side ? "bg-yes text-[#04130d]" : "bg-no text-white"
              }`}
              disabled={!amt || amt <= 0n || !!busy}
              onClick={placeBet}
            >
              {busy ?? `Buy ${side ? "Yes" : "No"}`}
            </button>
          )}
        </div>
      )}

      {finalized && (
        <div className="p-4">
          <div className="text-xs text-muted">Result</div>
          <div
            className={`mt-1 text-3xl font-semibold ${m.finalOutcome === 1 ? "text-yes" : m.finalOutcome === 2 ? "text-no" : "text-muted"}`}
          >
            {["—", "Yes", "No", "Void"][m.finalOutcome]}
          </div>
          {m.finalOutcome === 3 && <div className="mt-2 text-sm text-muted">All stakes are refunded.</div>}
        </div>
      )}

      {!open && !finalized && !inDispute && (
        <div className="p-4">
          <div className="text-[15px] font-medium">Trading closed</div>
          <p className="mt-1 text-sm text-muted">Waiting for the result.</p>
        </div>
      )}

      {inDispute && (
        <div className="space-y-3 p-4">
          <div>
            <div className="text-[15px] font-medium">Result proposed</div>
            <div className="tabular mt-1 text-sm text-muted">
              Final in <span className="text-text">{formatDuration(Math.max(0, m.proposedAt + disputeWindow - now))}</span>
            </div>
          </div>
          <p className="text-xs text-muted">Dispute bond: {formatUsdc(disputeBond)} kUSDC</p>
          {address && (
            <button className="btn btn-ghost w-full" disabled={!!busy} onClick={dispute}>
              Dispute
            </button>
          )}
        </div>
      )}

      {user && (user.yes > 0n || user.no > 0n) && (
        <div className="border-t border-line bg-panel-2/50 p-4 text-sm">
          <div className="text-xs text-muted">Your position</div>
          <div className="tabular mt-1.5 flex gap-5">
            {user.yes > 0n && <span>Yes <span className="text-yes">{formatUsdc(user.yes)}</span></span>}
            {user.no > 0n && <span>No <span className="text-no">{formatUsdc(user.no)}</span></span>}
          </div>
          {finalized && (
            <div className="mt-3">
              {user.claimed ? (
                <span className="text-xs text-muted">Claimed.</span>
              ) : user.payout > 0n ? (
                <button className="btn btn-accent w-full" disabled={!!busy} onClick={claim}>
                  Claim {formatUsdc(user.payout)} kUSDC
                </button>
              ) : (
                <span className="text-xs text-muted">Nothing to claim.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
