"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { mockUsdcAbi } from "@/lib/abi";
import { addrUrl, PM_ADDRESS, USDC_ADDRESS } from "@/lib/chain";
import { shortAddr, useWallet, WalletProvider } from "@/lib/wallet";

const NAV = [
  { href: "/", label: "Markets" },
  { href: "/grid", label: "Live grid" },
  { href: "/docs", label: "Docs" },
];

function WalletButton() {
  const { address, hasWallet, onFuji, connect, disconnect, switchToFuji, write, busy, walletName } = useWallet();
  if (!address) {
    return (
      <button className="btn btn-accent" onClick={connect}>
        {hasWallet ? "Connect wallet" : "No wallet"}
      </button>
    );
  }
  if (!onFuji) {
    return (
      <button className="btn btn-accent" onClick={switchToFuji}>
        Switch to Fuji
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        className="btn btn-ghost hidden sm:inline-flex"
        disabled={!!busy}
        title="1,000 test kUSDC, once an hour"
        onClick={() => write({ address: USDC_ADDRESS, abi: mockUsdcAbi, functionName: "faucet", label: "Test kUSDC received" })}
      >
        Get test funds
      </button>
      <button
        className="flex items-center gap-2 rounded-[10px] border border-line bg-panel-2 px-3 py-[0.45rem] text-sm hover:border-[#2f3846]"
        title={`${walletName ?? "Wallet"} · disconnect / switch wallet`}
        onClick={() => {
          disconnect();
          connect();
        }}
      >
        <span className="h-4 w-4 rounded-full" style={{ background: `linear-gradient(135deg, #${address.slice(2, 8)}, #${address.slice(-6)})` }} />
        <span className="mono">{shortAddr(address)}</span>
      </button>
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
      Your wallet is not on Avalanche Fuji.{" "}
      <button className="underline" onClick={switchToFuji}>
        Switch to Fuji
      </button>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  return (
    <WalletProvider>
      <WrongNetworkBanner />
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
              <rect x="1" y="1" width="10" height="10" rx="2.5" fill="var(--accent)" />
              <rect x="13" y="1" width="10" height="10" rx="2.5" fill="var(--text)" fillOpacity="0.85" />
              <rect x="1" y="13" width="10" height="10" rx="2.5" fill="var(--text)" fillOpacity="0.35" />
              <rect x="13" y="13" width="10" height="10" rx="2.5" fill="var(--text)" fillOpacity="0.6" />
            </svg>
            <span className="text-[17px] font-semibold tracking-tight">tessera</span>
          </Link>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:ml-4 sm:w-auto">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" || path.startsWith("/market") : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`whitespace-nowrap px-2.5 py-1.5 text-sm transition-colors ${active ? "font-medium text-text" : "text-muted hover:text-text"}`}
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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-line px-4 py-5 text-xs text-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1">
          <span>Avalanche Fuji testnet · no real money</span>
          <a className="hover:text-text" href={addrUrl(PM_ADDRESS)} target="_blank" rel="noreferrer">
            PredictionMarket {shortAddr(PM_ADDRESS)}
          </a>
          <a className="hover:text-text" href={addrUrl(USDC_ADDRESS)} target="_blank" rel="noreferrer">
            kUSDC {shortAddr(USDC_ADDRESS)}
          </a>
          <span className="sm:ml-auto">Data: OKX Agent Trade Kit</span>
        </div>
      </footer>
      <Toasts />
    </WalletProvider>
  );
}
