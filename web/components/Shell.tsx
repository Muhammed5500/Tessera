"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { mockUsdcAbi } from "@/lib/abi";
import { addrUrl, PM_ADDRESS, USDC_ADDRESS } from "@/lib/chain";
import { shortAddr, useWallet, WalletProvider } from "@/lib/wallet";

const NAV = [
  { href: "/", label: "Marketler" },
  { href: "/grid", label: "Canlı ızgara" },
  { href: "/agent", label: "Agent" },
  { href: "/verify", label: "Doğrula" },
  { href: "/oracle", label: "Oracle" },
];

function WalletButton() {
  const { address, hasWallet, onFuji, connect, switchToFuji, write, busy } = useWallet();
  if (!address) {
    return (
      <button className="btn btn-accent" onClick={connect}>
        {hasWallet ? "Cüzdan bağla" : "Cüzdan yok"}
      </button>
    );
  }
  if (!onFuji) {
    return (
      <button className="btn btn-accent" onClick={switchToFuji}>
        Fuji'ye geç
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        className="btn btn-ghost"
        disabled={!!busy}
        title="Saatte bir 1000 test kUSDC"
        onClick={() => write({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "faucet", label: "Test kUSDC alındı" })}
      >
        Test kUSDC al
      </button>
      <span className="pill mono">{shortAddr(address)}</span>
    </div>
  );
}

function Toasts() {
  const { toasts } = useWallet();
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="card px-4 py-3 text-sm shadow-xl"
          style={{ borderColor: t.kind === "ok" ? "var(--yes)" : t.kind === "err" ? "var(--no)" : "var(--line)" }}
        >
          {t.text}
          {t.href && (
            <>
              {" · "}
              <a className="link" href={t.href} target="_blank" rel="noreferrer">
                Snowtrace
              </a>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function WrongNetworkBanner() {
  const { address, onFuji, switchToFuji } = useWallet();
  if (!address || onFuji) return null;
  return (
    <div className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-center text-sm text-warn">
      Cüzdanın Avalanche Fuji ağında değil.{" "}
      <button className="underline" onClick={switchToFuji}>
        Fuji'ye geç
      </button>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <WalletProvider>
      <WrongNetworkBanner />
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-lg font-black text-accent-ink">K</span>
            <span className="text-lg font-bold tracking-wide">KAHİN</span>
          </Link>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:ml-4 sm:w-auto">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" || path.startsWith("/market") : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${active ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">
            <WalletButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-line px-4 py-5 text-xs text-muted">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1">
          <span>Avalanche Fuji · test token, gerçek para yok</span>
          <a className="hover:text-text" href={addrUrl(PM_ADDRESS)} target="_blank" rel="noreferrer">
            PredictionMarket {shortAddr(PM_ADDRESS)}
          </a>
          <a className="hover:text-text" href={addrUrl(USDC_ADDRESS)} target="_blank" rel="noreferrer">
            kUSDC {shortAddr(USDC_ADDRESS)}
          </a>
          <span>Veri: OKX Agent Trade Kit</span>
        </div>
      </footer>
      <Toasts />
    </WalletProvider>
  );
}
