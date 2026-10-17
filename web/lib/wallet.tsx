"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

/** EIP-6963: tarayıcıdaki her cüzdan eklentisi kendini ayrı duyurur (MetaMask, Rainbow, Core…). */
export type WalletOption = { uuid: string; name: string; icon: string; rdns: string; provider: Eip1193 };

export type Toast = { id: number; kind: "ok" | "err" | "info"; text: string; href?: string };

type WriteArgs = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; label: string };

type WalletCtx = {
  address?: Address;
  chainId?: number;
  hasWallet: boolean;
  onFuji: boolean;
  walletName?: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToFuji: () => Promise<void>;
  write: (w: WriteArgs) => Promise<{ hash: Hash; confirmMs: number } | null>;
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  busy: string | null;
};

const Ctx = createContext<WalletCtx | null>(null);
const FUJI_HEX = `0x${CHAIN.id.toString(16)}`;
const LS_KEY = "kahin.wallet.rdns";

const lsGet = () => {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
};
const lsSet = (v: string | null) => {
  try {
    if (v) localStorage.setItem(LS_KEY, v);
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* gizli pencere vb. */
  }
};

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [options, setOptions] = useState<WalletOption[]>([]);
  const [active, setActive] = useState<WalletOption | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const activeRef = useRef<WalletOption | null>(null);
  activeRef.current = active;

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 9000);
  }, []);

  // 1) Cüzdanları keşfet (EIP-6963) + eski tip window.ethereum yedeği
  useEffect(() => {
    const found = new Map<string, WalletOption>();
    const onAnnounce = (ev: Event) => {
      const d = (ev as CustomEvent).detail as { info: { uuid: string; name: string; icon: string; rdns: string }; provider: Eip1193 };
      if (!d?.info || !d.provider || found.has(d.info.rdns)) return;
      found.set(d.info.rdns, { ...d.info, provider: d.provider });
      setOptions([...found.values()]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const fallback = setTimeout(() => {
      if (found.size === 0 && window.ethereum) {
        found.set("injected", { uuid: "injected", name: "Tarayıcı cüzdanı", icon: "", rdns: "injected", provider: window.ethereum });
        setOptions([...found.values()]);
      }
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(fallback);
    };
  }, []);

  // 2) Daha önce seçilen cüzdanı sessizce geri yükle (izin isteme penceresi açmadan)
  useEffect(() => {
    if (active || options.length === 0) return;
    const saved = lsGet();
    const opt = options.find((o) => o.rdns === saved);
    if (!opt) return;
    opt.provider
      .request({ method: "eth_accounts" })
      .then(async (a: string[]) => {
        if (!a[0]) return;
        setActive(opt);
        setAddress(a[0] as Address);
        setChainId(parseInt(await opt.provider.request({ method: "eth_chainId" }), 16));
      })
      .catch(() => {});
  }, [options, active]);

  // 3) Seçili cüzdanın hesap/ağ değişikliklerini dinle
  useEffect(() => {
    const p = active?.provider;
    if (!p) return;
    const onAcc = (a: string[]) => setAddress(a[0] as Address | undefined);
    const onChain = (c: string) => setChainId(parseInt(c, 16));
    p.on?.("accountsChanged", onAcc);
    p.on?.("chainChanged", onChain);
    return () => {
      p.removeListener?.("accountsChanged", onAcc);
      p.removeListener?.("chainChanged", onChain);
    };
  }, [active]);

  const switchToFuji = useCallback(async () => {
    const eth = activeRef.current?.provider;
    if (!eth) return;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: FUJI_HEX }] });
    } catch (e: any) {
      if (e?.code === -32002) {
        pushToast({ kind: "info", text: "Cüzdanda bekleyen bir istek var; MetaMask penceresini aç ve onu tamamla." });
        return;
      }
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
  }, [pushToast]);

  // Cüzdana aynı anda tek istek: üst üste gelen istekler MetaMask onay penceresini bozabiliyor
  // ("Cannot read properties of undefined (reading 'origin')").
  const pending = useRef(false);
  const lastTxAt = useRef(0);

  const connectWith = useCallback(
    async (opt: WalletOption) => {
      setPickerOpen(false);
      if (pending.current) return;
      pending.current = true;
      try {
        const accs: string[] = await opt.provider.request({ method: "eth_requestAccounts" });
        setActive(opt);
        activeRef.current = opt;
        lsSet(opt.rdns);
        setAddress(accs[0] as Address);
        setChainId(parseInt(await opt.provider.request({ method: "eth_chainId" }), 16));
        // Ağ değişimi OTOMATİK yapılmaz; kullanıcı "Fuji'ye geç"e kendisi basar (ayrı onay penceresi).
      } catch (e: any) {
        pushToast({ kind: "err", text: `${opt.name}: ${(e?.message ?? "bağlantı reddedildi").slice(0, 120)}` });
      } finally {
        pending.current = false;
      }
    },
    [pushToast],
  );

  const connect = useCallback(async () => {
    if (options.length === 0) {
      pushToast({ kind: "err", text: "Tarayıcıda cüzdan bulunamadı. MetaMask, Core ya da Rabby kur." });
      return;
    }
    setPickerOpen(true); // her zaman seçim penceresi: hangi cüzdanın açılacağına kullanıcı karar verir
  }, [options, pushToast]);

  const disconnect = useCallback(() => {
    setActive(null);
    setAddress(undefined);
    setChainId(undefined);
    lsSet(null);
  }, []);

  /** simulate → imzala → gönder → onay; gönderim→onay süresi ölçülür (Avalanche hızı). */
  const write = useCallback(
    async (w: WriteArgs) => {
      const eth = activeRef.current?.provider;
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
        // Avalanche ~1 sn'de kesinleştiği için arka arkaya iki işlemde (onay → tahmin) cüzdanın nonce takibi
        // geride kalabiliyor ("nonce too low"). Önceki işlemden hemen sonraysa kısa bekle; nonce hatasında bir kez tekrar dene.
        const since = performance.now() - lastTxAt.current;
        if (since < 2500) await new Promise((r) => setTimeout(r, 2500 - since));
        let hash: Hash;
        try {
          hash = await wallet.writeContract(request as any);
        } catch (err: any) {
          const text = `${err?.shortMessage ?? ""} ${err?.details ?? ""} ${err?.message ?? ""}`.toLowerCase();
          if (!text.includes("nonce too low")) throw err;
          pushToast({ kind: "info", text: "Cüzdan bir önceki işlemi henüz görmedi; 3 sn sonra tekrar deneniyor…" });
          await new Promise((r) => setTimeout(r, 3000));
          hash = await wallet.writeContract(request as any);
        }
        const submitted = performance.now();
        const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 250 });
        const confirmMs = Math.round(performance.now() - submitted);
        lastTxAt.current = performance.now();
        if (receipt.status !== "success") throw new Error("işlem başarısız");
        pushToast({ kind: "ok", text: `${w.label} · ${(confirmMs / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} sn'de kesinleşti`, href: txUrl(hash) });
        return { hash, confirmMs };
      } catch (e: any) {
        const msg = explainError(e);
        pushToast({ kind: "err", text: `${w.label}: ${msg.slice(0, 200)}` });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [address, chainId, pushToast, switchToFuji],
  );

  const value = useMemo(
    () => ({
      address,
      chainId,
      hasWallet: options.length > 0,
      onFuji: chainId === CHAIN.id,
      walletName: active?.name,
      connect,
      disconnect,
      switchToFuji,
      write,
      toasts,
      pushToast,
      busy,
    }),
    [address, chainId, options.length, active, connect, disconnect, switchToFuji, write, toasts, pushToast, busy],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {pickerOpen && <WalletPicker options={options} onPick={connectWith} onClose={() => setPickerOpen(false)} />}
    </Ctx.Provider>
  );
}

function WalletPicker({ options, onPick, onClose }: { options: WalletOption[]; onPick: (o: WalletOption) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Cüzdan seç</h3>
          <button className="text-muted hover:text-text" onClick={onClose}>
            ✕
          </button>
        </div>
        <ul className="space-y-2">
          {options.map((o) => (
            <li key={o.rdns}>
              <button className="btn btn-ghost w-full justify-start gap-3" onClick={() => onPick(o)}>
                {o.icon ? <img src={o.icon} alt="" className="h-6 w-6 rounded" /> : <span className="h-6 w-6 rounded bg-panel" />}
                <span>{o.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Avalanche Fuji test ağı · test token, gerçek para yok.</p>
      </div>
    </div>
  );
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("WalletProvider eksik");
  return c;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Kontrat/cüzdan hatalarını anlaşılır Türkçeye çevirir (OpenZeppelin v5 ve PredictionMarket hata seçicileri). */
const KNOWN_ERRORS: Record<string, string> = {
  "0xe450d38c": "Yetersiz kUSDC bakiyesi — önce üstteki 'Test kUSDC al' butonunu kullan.",
  ERC20InsufficientBalance: "Yetersiz kUSDC bakiyesi — önce üstteki 'Test kUSDC al' butonunu kullan.",
  "0xfb8f41b2": "Harcama onayı yetersiz — onay adımını tekrar ver.",
  ERC20InsufficientAllowance: "Harcama onayı yetersiz — onay adımını tekrar ver.",
  BettingClosed: "Bu kare/marketin tahminleri kapandı.",
  BetTooSmall: "Tahmin miktarı en az 1 kUSDC olmalı.",
  FaucetCooldown: "Faucet saatte bir kullanılabilir; biraz sonra tekrar dene.",
  AlreadyClaimed: "Ödül zaten alınmış.",
  NothingToClaim: "Bu markette alacağın yok.",
  WrongStatus: "Market bu işlem için uygun durumda değil.",
  TooLate: "İtiraz süresi doldu.",
};

export function explainError(e: any): string {
  const raw = `${e?.shortMessage ?? ""} ${e?.details ?? ""} ${e?.message ?? ""} ${e?.cause?.data?.errorName ?? ""} ${e?.cause?.signature ?? ""}`;
  for (const [k, v] of Object.entries(KNOWN_ERRORS)) if (raw.includes(k)) return v;
  if (/user rejected|denied/i.test(raw)) return "İşlem cüzdanda reddedildi.";
  if (/insufficient funds/i.test(raw)) return "Gas için Fuji AVAX'ı yetersiz.";
  return (e?.shortMessage ?? e?.message ?? String(e)).toString();
}
