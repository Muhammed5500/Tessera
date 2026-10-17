"use client";

import { useEffect, useState } from "react";
import { parseUnits, type Address } from "viem";
import { mockUsdcAbi, predictionMarketAbi } from "@/lib/abi";
import { formatUsdc, PM_ADDRESS, publicClient, USDC_ADDRESS, type Market } from "@/lib/chain";
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
      label: `Tahmin: ${side ? "EVET" : "HAYIR"} · ${amount} kUSDC`,
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

  return (
    <div className="card space-y-4 p-4">
      {open && (
        <>
          <h3 className="font-semibold">Tahminde bulun</h3>
          <div className="grid grid-cols-2 gap-2">
            <button className={`btn btn-yes ${side ? "active" : ""}`} onClick={() => setSide(true)}>
              EVET
            </button>
            <button className={`btn btn-no ${!side ? "active" : ""}`} onClick={() => setSide(false)}>
              HAYIR
            </button>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Miktar (kUSDC)</label>
            <input className="field mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="mt-2 flex gap-2">
              {["5", "10", "50"].map((v) => (
                <button key={v} className="pill hover:text-text" onClick={() => setAmount(v)}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          {estPayout !== null && (
            <div className="text-xs text-muted">
              Şu anki havuzla kazanırsan yaklaşık <span className="text-text">{formatUsdc(estPayout)} kUSDC</span> alırsın (havuz değiştikçe
              değişir, %{feeBps / 100} ücret dahil).
            </div>
          )}
          {!address ? (
            <button className="btn btn-accent w-full" onClick={connect}>
              Cüzdan bağla
            </button>
          ) : (
            <button className="btn btn-accent w-full" disabled={!amt || amt <= 0n || !!busy} onClick={placeBet}>
              {busy ?? "Tahmini gönder"}
            </button>
          )}
          {user && <div className="text-xs text-muted">Bakiyen: {formatUsdc(user.balance)} kUSDC · test kUSDC için üstteki butonu kullan</div>}
        </>
      )}

      {finalized && (
        <div>
          <div className="text-xs text-muted">Kesin sonuç</div>
          <div className="mt-1 text-2xl font-bold">{["—", "EVET", "HAYIR", "GEÇERSİZ"][m.finalOutcome]}</div>
          <div className="mt-1 text-xs text-muted">
            {m.finalOutcome === 3 ? "Market geçersiz sayıldı; herkes yatırdığını geri alır." : `Kazanan taraf havuzu %${feeBps / 100} ücret düşülerek paylaşır.`}
            {!address && " Pozisyonunu görmek için cüzdan bağla."}
          </div>
        </div>
      )}

      {!open && !finalized && !inDispute && (
        <div className="text-sm text-muted">Tahminler kapandı. Agent ölçüm zamanından sonra sonucu kanıtla önerecek.</div>
      )}

      {inDispute && (
        <div className="space-y-2">
          <div className="text-sm">
            Agent sonucu önerdi. İtiraz süresi: <span className="mono">{Math.max(0, m.proposedAt + disputeWindow - now)} sn</span>
          </div>
          <div className="text-xs text-muted">
            Kanıtı kendin doğrulayabilirsin. Yanlış olduğunu düşünüyorsan {formatUsdc(disputeBond)} kUSDC teminatla itiraz aç; komite haklı bulursa
            teminat iade edilir.
          </div>
          {address && (
            <button className="btn btn-ghost" disabled={!!busy} onClick={dispute}>
              İtiraz et
            </button>
          )}
        </div>
      )}

      {user && (user.yes > 0n || user.no > 0n) && (
        <div className="rounded-lg bg-panel-2 p-3 text-sm">
          <div className="text-xs text-muted">Pozisyonun</div>
          <div className="mt-1 flex gap-4">
            <span className="text-yes">EVET {formatUsdc(user.yes)}</span>
            <span className="text-no">HAYIR {formatUsdc(user.no)}</span>
          </div>
          {finalized && (
            <div className="mt-3">
              {user.claimed ? (
                <span className="text-xs text-muted">Ödül alındı.</span>
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
