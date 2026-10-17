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
}: {
  m: Market;
  now: number;
  disputeWindow: number;
  disputeBond: bigint;
  feeBps: number;
  onDone: () => void;
}) {
  const { address, connect, write, busy } = useWallet();
  const [side, setSide] = useState<boolean>(true);
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
      const ok = await write({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "faucet", label: "Bakiye yetersizdi → 1000 test kUSDC alındı" });
      if (!ok) return;
    }
    if ((user?.allowance ?? 0n) < amt) {
      const ok = await write({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "approve", args: [PM_ADDRESS, amt], label: "Onay verildi" });
      if (!ok) return;
    }
    const ok = await write({
      address: PM_ADDRESS,
      abi: predictionMarketAbi,
      functionName: "bet",
      args: [m.id, side, amt],
      label: `Tahmin: ${side ? "Evet" : "Hayır"} · ${amount} kUSDC`,
    });
    if (ok) refresh();
  }

  async function claim() {
    const ok = await write({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "claim", args: [m.id], label: "Ödül alındı" });
    if (ok) refresh();
  }

  async function dispute() {
    if ((user?.allowance ?? 0n) < disputeBond) {
      const ok = await write({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "approve", args: [PM_ADDRESS, disputeBond], label: "Teminat onayı" });
      if (!ok) return;
    }
    const ok = await write({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "dispute", args: [m.id], label: "İtiraz açıldı" });
    if (ok) refresh();
  }

  const yesPct = total > 0n ? Number((m.yesPool * 10_000n) / total) / 100 : null;
  const sidePct = yesPct === null ? null : side ? yesPct : 100 - yesPct;

  return (
    <div className="card overflow-hidden">
      {open && (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-2">
            {([true, false] as const).map((v) => {
              const active = side === v;
              const pct = yesPct === null ? null : v ? yesPct : 100 - yesPct;
              return (
                <button
                  key={String(v)}
                  onClick={() => setSide(v)}
                  className={`rounded-lg py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? v
                        ? "bg-yes text-[#04130d]"
                        : "bg-no text-white"
                      : "bg-panel-2 text-muted hover:text-text"
                  }`}
                >
                  {v ? "Evet" : "Hayır"}
                  {pct !== null && <span className="tabular ml-1.5 opacity-80">%{pct.toFixed(0)}</span>}
                </button>
              );
            })}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
              <span>Miktar</span>
              {user && (
                <button className="tabular hover:text-text" onClick={() => setAmount((Number(user.balance) / 1e6).toFixed(0))}>
                  Bakiye {formatUsdc(user.balance)}
                </button>
              )}
            </div>
            <div className="flex items-center rounded-lg border border-line bg-panel-2 pr-3 focus-within:border-[#3a4350]">
              <input
                className="tabular w-full bg-transparent px-3 py-2.5 text-lg font-medium outline-none"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <span className="text-sm text-muted">kUSDC</span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {["5", "10", "25", "50"].map((v) => (
                <button
                  key={v}
                  className={`tabular rounded-md py-1.5 text-xs transition-colors ${
                    amount === v ? "bg-[#2a313c] text-text" : "bg-panel-2 text-muted hover:text-text"
                  }`}
                  onClick={() => setAmount(v)}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 border-t border-line pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Kazanırsan</span>
              <span className="tabular font-medium text-yes">{estPayout !== null ? `${formatUsdc(estPayout)} kUSDC` : "—"}</span>
            </div>
            <div className="flex justify-between text-xs text-muted">
              <span>Çarpan</span>
              <span className="tabular">
                {estPayout !== null && amt ? `${(Number(estPayout) / Number(amt)).toFixed(2)}x` : "—"}
                {sidePct !== null && ` · ücret %${feeBps / 100}`}
              </span>
            </div>
          </div>

          {!address ? (
            <button className="btn btn-accent w-full py-3" onClick={connect}>
              Cüzdan bağla
            </button>
          ) : (
            <button className="btn btn-accent w-full py-3" disabled={!amt || amt <= 0n || !!busy} onClick={placeBet}>
              {busy ?? `${side ? "Evet" : "Hayır"} al`}
            </button>
          )}
          <p className="text-[11px] leading-relaxed text-muted">
            Ödeme havuzdan paylaşılır; tutar, kapanışa kadar gelen tahminlere göre değişebilir. Test ağı, gerçek para yok.
          </p>
        </div>
      )}

      {finalized && (
        <div className="p-4">
          <div className="text-xs text-muted">Sonuç</div>
          <div
            className={`mt-1 text-3xl font-semibold ${m.finalOutcome === 1 ? "text-yes" : m.finalOutcome === 2 ? "text-no" : "text-muted"}`}
          >
            {["—", "Evet", "Hayır", "Geçersiz"][m.finalOutcome]}
          </div>
          <div className="mt-2 text-sm text-muted">
            {m.finalOutcome === 3 ? "Market geçersiz sayıldı; herkes yatırdığını geri alır." : `Kazananlar havuzu paylaşır (%${feeBps / 100} ücret).`}
            {!address && " Pozisyonunu görmek için cüzdanını bağla."}
          </div>
        </div>
      )}

      {!open && !finalized && !inDispute && (
        <div className="p-4">
          <div className="text-[15px] font-medium">Tahminler kapandı</div>
          <p className="mt-1 text-sm text-muted">Ölçüm zamanı geçince agent sonucu OKX verisiyle hesaplayıp kanıtıyla birlikte önerecek.</p>
        </div>
      )}

      {inDispute && (
        <div className="space-y-3 p-4">
          <div>
            <div className="text-[15px] font-medium">Sonuç önerildi</div>
            <div className="tabular mt-1 text-sm text-muted">
              İtiraz için kalan süre: <span className="text-text">{formatDuration(Math.max(0, m.proposedAt + disputeWindow - now))}</span>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Kanıtı aşağıdan kontrol edebilirsin. Yanlış olduğunu düşünüyorsan {formatUsdc(disputeBond)} kUSDC teminatla itiraz aç; haklı
            çıkarsan teminat iade edilir.
          </p>
          {address && (
            <button className="btn btn-ghost w-full" disabled={!!busy} onClick={dispute}>
              İtiraz et
            </button>
          )}
        </div>
      )}

      {user && (user.yes > 0n || user.no > 0n) && (
        <div className="border-t border-line bg-panel-2/50 p-4 text-sm">
          <div className="text-xs text-muted">Pozisyonun</div>
          <div className="tabular mt-1.5 flex gap-5">
            {user.yes > 0n && <span>Evet <span className="text-yes">{formatUsdc(user.yes)}</span></span>}
            {user.no > 0n && <span>Hayır <span className="text-no">{formatUsdc(user.no)}</span></span>}
          </div>
          {finalized && (
            <div className="mt-3">
              {user.claimed ? (
                <span className="text-xs text-muted">Ödülünü aldın.</span>
              ) : user.payout > 0n ? (
                <button className="btn btn-accent w-full" disabled={!!busy} onClick={claim}>
                  {formatUsdc(user.payout)} kUSDC al
                </button>
              ) : (
                <span className="text-xs text-muted">Bu markette alacağın yok.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
