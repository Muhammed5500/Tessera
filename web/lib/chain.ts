import { createPublicClient, decodeAbiParameters, fallback, http, type Address, type Hex } from "viem";
import { avalancheFuji } from "viem/chains";
import { predictionMarketAbi } from "./abi";

export const PM_ADDRESS = (process.env.NEXT_PUBLIC_PM_ADDRESS ?? "0x3Bf77E4712101E8AB41aB4622B14E5261a144336") as Address;
export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "0xC89189F5336E41e8FE32d69D09040Ad1bf0a5Aa4") as Address;
export const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER ?? "https://testnet.snowtrace.io";
export const CHAIN = avalancheFuji;

const RPC = process.env.NEXT_PUBLIC_FUJI_RPC_URL ?? "https://avalanche-fuji-c-chain-rpc.publicnode.com";
const RPC_FALLBACK = process.env.NEXT_PUBLIC_FUJI_RPC_FALLBACK ?? "https://api.avax-test.network/ext/bc/C/rpc";

/**
 * Okuma istemcisi: okumalar Multicall3 ile birleştirilir; JSON-RPC paketleri küçük tutulur
 * (publicnode büyük paketleri "Request exceeds defined limit" ile reddediyor).
 */
export const publicClient = createPublicClient({
  chain: avalancheFuji,
  transport: fallback([http(RPC, { batch: { batchSize: 10 } }), http(RPC_FALLBACK, { batch: { batchSize: 10 } })]),
  batch: { multicall: { batchSize: 4096 } },
  pollingInterval: 250,
});

/** İşlem istemcisi: simülasyon ve onay takibi paketlemesiz, ayrı bağlantıdan (yoğun okumalardan etkilenmesin). */
export const txClient = createPublicClient({
  chain: avalancheFuji,
  transport: fallback([http(RPC), http(RPC_FALLBACK)]),
  pollingInterval: 250,
});

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;

export const STATUS = ["Open", "Proposed", "Disputed", "Final"] as const;
export const OUTCOME = ["—", "Yes", "No", "Void"] as const;

export type Market = {
  id: bigint;
  templateId: number;
  params: Hex;
  question: string;
  metadataURI: string;
  createdAt: number;
  closeTime: number;
  resolveTime: number;
  proposedAt: number;
  status: number;
  proposedOutcome: number;
  finalOutcome: number;
  yesPool: bigint;
  noPool: bigint;
  fee: bigint;
  evidenceHash: Hex;
  evidenceURI: string;
  disputer: Address;
};

export async function getMarket(id: bigint): Promise<Market> {
  const m = await publicClient.readContract({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "getMarket", args: [id] });
  return {
    id,
    templateId: Number(m.templateId),
    params: m.params,
    question: m.question,
    metadataURI: m.metadataURI,
    createdAt: Number(m.createdAt),
    closeTime: Number(m.closeTime),
    resolveTime: Number(m.resolveTime),
    proposedAt: Number(m.proposedAt),
    status: Number(m.status),
    proposedOutcome: Number(m.proposedOutcome),
    finalOutcome: Number(m.finalOutcome),
    yesPool: m.yesPool,
    noPool: m.noPool,
    fee: m.fee,
    evidenceHash: m.evidenceHash,
    evidenceURI: m.evidenceURI,
    disputer: m.disputer,
  };
}

export async function getAllMarkets(): Promise<Market[]> {
  const n = await publicClient.readContract({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName: "marketCount" });
  const ids = Array.from({ length: Number(n) }, (_, i) => BigInt(i + 1));
  return Promise.all(ids.map(getMarket));
}

export async function readContractParams() {
  const read = (functionName: "disputeWindow" | "disputeBond" | "minBet" | "feeBps") =>
    publicClient.readContract({ address: PM_ADDRESS, abi: predictionMarketAbi, functionName });
  const [disputeWindow, disputeBond, minBet, feeBps] = await Promise.all([
    read("disputeWindow"),
    read("disputeBond"),
    read("minBet"),
    read("feeBps"),
  ]);
  return { disputeWindow: Number(disputeWindow), disputeBond: disputeBond as bigint, minBet: minBet as bigint, feeBps: Number(feeBps) };
}

/** Şablon parametreleri (agent/src/templates ile aynı ABI), sayısal ve okunur halde. */
export type Spec = {
  template: "PRICE_ABOVE" | "FUNDING_POSITIVE" | "PRICE_IN_BAND" | "UNKNOWN";
  site?: string;
  instId?: string;
  threshold?: number;
  low?: number;
  high?: number;
  fundingTime?: number;
};

export function decodeSpec(templateId: number, params: Hex): Spec {
  try {
    if (templateId === 1) {
      const [site, instId, th] = decodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "int256" }], params);
      return { template: "PRICE_ABOVE", site, instId, threshold: Number(th) / 1e8 };
    }
    if (templateId === 2) {
      const [instId, fundingTime] = decodeAbiParameters([{ type: "string" }, { type: "uint64" }], params);
      return { template: "FUNDING_POSITIVE", instId, fundingTime: Number(fundingTime) };
    }
    if (templateId === 3) {
      const [site, instId, lo, hi] = decodeAbiParameters(
        [{ type: "string" }, { type: "string" }, { type: "int256" }, { type: "int256" }],
        params,
      );
      return { template: "PRICE_IN_BAND", site, instId, low: Number(lo) / 1e8, high: Number(hi) / 1e8 };
    }
  } catch {
    /* yoksay */
  }
  return { template: "UNKNOWN" };
}

/** Izgaranın açık uçlu kenar kareleri; agent/src/grid/model.ts ile aynı eşikler. */
export const isLowTail = (low: number) => low <= 1;
export const isHighTail = (high: number) => high >= 1_000_000;

/** $81,500 / $2,425.5 / $9.85 */
export const usd = (v: number) =>
  `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 100 ? 3 : v < 10_000 ? 2 : 1 })}`;

export function bandLabel(low: number, high: number, fmt: (v: number) => string = usd) {
  if (isLowTail(low)) return `Below ${fmt(high)}`;
  if (isHighTail(high)) return `${fmt(low)} or above`;
  return `${fmt(low)} – ${fmt(high)}`;
}

const base = (instId?: string) => (instId ?? "").split("-")[0];

/** Zincirdeki soru metni Türkçe; arayüz soruyu parametrelerden İngilizce kurar. */
export function marketQuestion(m: Pick<Market, "templateId" | "params" | "resolveTime" | "question">): string {
  const s = decodeSpec(m.templateId, m.params);
  const at = formatTime(m.resolveTime);
  if (s.template === "PRICE_ABOVE") return `${base(s.instId)} above ${usd(s.threshold!)} on ${at}?`;
  if (s.template === "FUNDING_POSITIVE") return `${base(s.instId)} perp funding positive on ${formatTime(s.fundingTime!)}?`;
  if (s.template === "PRICE_IN_BAND") {
    if (isLowTail(s.low!)) return `${base(s.instId)} below ${usd(s.high!)} on ${at}?`;
    if (isHighTail(s.high!)) return `${base(s.instId)} at ${usd(s.low!)} or above on ${at}?`;
    return `${base(s.instId)} between ${usd(s.low!)} and ${usd(s.high!)} on ${at}?`;
  }
  return m.question;
}

/** Sonuç satırı etiketi: "Above $81,500", "$81,500 – $81,550", "Funding positive" */
export function outcomeLabel(m: Pick<Market, "templateId" | "params">): string {
  const s = decodeSpec(m.templateId, m.params);
  if (s.template === "PRICE_ABOVE") return `Above ${usd(s.threshold!)}`;
  if (s.template === "PRICE_IN_BAND") return bandLabel(s.low!, s.high!);
  if (s.template === "FUNDING_POSITIVE") return "Funding positive";
  return "Yes";
}

/** Kural metni (İngilizce), agent'taki ruleTR ile aynı kural. */
export function marketRule(m: Pick<Market, "templateId" | "params" | "resolveTime">): string {
  const s = decodeSpec(m.templateId, m.params);
  const at = formatTime(m.resolveTime);
  const src = `the OKX (${s.site ?? "global"}) ${s.instId} 1-minute candle closing at ${at} (Istanbul time)`;
  const cross = " If an independent second source (OKX index price) differs by more than 0.5%, the market resolves Void.";
  if (s.template === "PRICE_ABOVE")
    return `Resolves Yes if ${src} closes above ${usd(s.threshold!)}. Otherwise No.${cross}`;
  if (s.template === "PRICE_IN_BAND") {
    const cond = isLowTail(s.low!)
      ? `below ${usd(s.high!)}`
      : isHighTail(s.high!)
        ? `at ${usd(s.low!)} or above`
        : `at or above ${usd(s.low!)} and below ${usd(s.high!)}`;
    return `Resolves Yes if ${src} closes ${cond}. Otherwise No.${cross}`;
  }
  if (s.template === "FUNDING_POSITIVE")
    return `Resolves Yes if the realized OKX funding rate of ${s.instId} at the ${formatTime(s.fundingTime!)} payment is greater than zero. Otherwise No.`;
  return "—";
}

/** Fiyat marketleri için grafikte kullanılacak sayısal değerler (yalnız gösterim). */
export function priceSpec(templateId: number, params: Hex): { instId: string; target?: number; band?: [number, number] } | null {
  const s = decodeSpec(templateId, params);
  if (s.template === "PRICE_ABOVE") return { instId: s.instId!, target: s.threshold };
  if (s.template === "PRICE_IN_BAND") {
    // Açık uçlu kenar karesi: grafikte bant yerine sonlu kenarı hedef çizgisi olarak göster
    if (isLowTail(s.low!)) return { instId: s.instId!, target: s.high };
    if (isHighTail(s.high!)) return { instId: s.instId!, target: s.low };
    return { instId: s.instId!, band: [s.low!, s.high!] };
  }
  return null;
}

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Istanbul",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** "Oct 17, 17:26" (İstanbul saati) */
export const formatTime = (sec: number) => timeFmt.format(new Date(sec * 1000));

const clockFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "17:26" */
export const formatClock = (sec: number) => clockFmt.format(new Date(sec * 1000));

/** kUSDC (6 decimals) → "12.5" */
export function formatUsdc(v: bigint, digits = 2): string {
  const n = Number(v) / 1e6;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function impliedYes(m: Pick<Market, "yesPool" | "noPool">): number | null {
  const total = m.yesPool + m.noPool;
  if (total === 0n) return null;
  return Number((m.yesPool * 10_000n) / total) / 100;
}

/** Kullanıcıya gösterilecek durum etiketi (zamana göre) */
export function phase(m: Market, nowSec: number): { label: string; tone: "open" | "closed" | "proposed" | "disputed" | "final" } {
  if (m.status === 3) return { label: `Resolved · ${OUTCOME[m.finalOutcome]}`, tone: "final" };
  if (m.status === 2) return { label: "Disputed", tone: "disputed" };
  if (m.status === 1) return { label: `Proposed · ${OUTCOME[m.proposedOutcome]}`, tone: "proposed" };
  if (nowSec < m.closeTime) return { label: "Open", tone: "open" };
  return { label: "Awaiting result", tone: "closed" };
}
