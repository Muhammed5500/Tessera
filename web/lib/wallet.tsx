"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createWalletClient, custom, type Abi, type Address, type Hash } from "viem";
import { CHAIN, publicClient, txUrl } from "./chain";

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>;
  on?: (event: string, cb: (...a: any[]) => void) => void;
  removeListener?: (event: string, cb: (...a: any[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export type Toast = { id: number; kind: "ok" | "err" | "info"; text: string; href?: string };

type WriteArgs = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; label: string };

type WalletCtx = {
  address?: Address;
  chainId?: number;
  hasWallet: boolean;
  onFuji: boolean;
  connect: () => Promise<void>;
  switchToFuji: () => Promise<void>;
  write: (w: WriteArgs) => Promise<{ hash: Hash; confirmMs: number } | null>;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  busy: string | null;
};

const Ctx = createContext<WalletCtx | null>(null);
const FUJI_HEX = `0x${CHAIN.id.toString(16)}`;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [hasWallet, setHasWallet] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 9000);
  }, []);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    setHasWallet(true);
    eth.request({ method: "eth_accounts" }).then((a: string[]) => a[0] && setAddress(a[0] as Address)).catch(() => {});
    eth.request({ method: "eth_chainId" }).then((c: string) => setChainId(parseInt(c, 16))).catch(() => {});
    const onAcc = (a: string[]) => setAddress(a[0] as Address | undefined);
    const onChain = (c: string) => setChainId(parseInt(c, 16));
    eth.on?.("accountsChanged", onAcc);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAcc);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const switchToFuji = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) return;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: FUJI_HEX }] });
    } catch (e: any) {
      if (e?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: FUJI_HEX,
              chainName: "Avalanche Fuji C-Chain",
              nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
              rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
              blockExplorerUrls: ["https://testnet.snowtrace.io"],
            },
          ],
        });
      } else throw e;
    }
  }, []);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) {
      pushToast({ kind: "err", text: "Tarayıcıda cüzdan bulunamadı. Core veya MetaMask kur." });
      return;
    }
    const accs: string[] = await eth.request({ method: "eth_requestAccounts" });
    setAddress(accs[0] as Address);
    const c = parseInt(await eth.request({ method: "eth_chainId" }), 16);
    setChainId(c);
    if (c !== CHAIN.id) await switchToFuji().catch(() => {});
  }, [pushToast, switchToFuji]);

  /** simulate → imzala → gönder → onay; gönderim→onay süresi ölçülür (Avalanche hızı). */
  const write = useCallback(
    async (w: WriteArgs) => {
      const eth = window.ethereum;
      if (!eth || !address) {
        pushToast({ kind: "err", text: "Önce cüzdanı bağla." });
        return null;
      }
      setBusy(w.label);
      try {
        if (chainId !== CHAIN.id) await switchToFuji();
        const wallet = createWalletClient({ account: address, chain: CHAIN, transport: custom(eth) });
        const { request } = await publicClient.simulateContract({
          account: address,
          address: w.address,
          abi: w.abi,
          functionName: w.functionName,
          args: w.args ?? [],
        } as any);
        const hash = await wallet.writeContract(request as any);
        const submitted = performance.now();
        const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 250 });
        const confirmMs = Math.round(performance.now() - submitted);
        if (receipt.status !== "success") throw new Error("işlem başarısız");
        pushToast({ kind: "ok", text: `${w.label} · ${(confirmMs / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn'de kesinleşti`, href: txUrl(hash) });
        return { hash, confirmMs };
      } catch (e: any) {
        const msg = e?.shortMessage ?? e?.message ?? String(e);
        pushToast({ kind: "err", text: `${w.label}: ${msg.slice(0, 160)}` });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [address, chainId, pushToast, switchToFuji],
  );

  const value = useMemo(
    () => ({ address, chainId, hasWallet, onFuji: chainId === CHAIN.id, connect, switchToFuji, write, toasts, pushToast, busy }),
    [address, chainId, hasWallet, connect, switchToFuji, write, toasts, pushToast, busy],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("WalletProvider eksik");
  return c;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
