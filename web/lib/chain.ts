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

export const STATUS = ["Açık", "Önerildi", "İtirazda", "Kesinleşti"] as const;
export const OUTCOME = ["—", "EVET", "HAYIR", "GEÇERSİZ"] as const;

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

/** Şablon parametrelerini insan diline çevirir (agent/src/templates ile aynı ABI). */
export function describeParams(templateId: number, params: Hex): Record<string, string> {
  try {
    if (templateId === 1) {
      const [site, instId, thresholdE8] = decodeAbiParameters(
        [{ type: "string" }, { type: "string" }, { type: "int256" }],
        params,
      );
      return { şablon: "PRICE_ABOVE", site, enstrüman: instId, eşik: formatE8(thresholdE8) };
    }
    if (templateId === 2) {
      const [instId, fundingTime] = decodeAbiParameters([{ type: "string" }, { type: "uint64" }], params);
      return { şablon: "FUNDING_POSITIVE", enstrüman: instId, "funding zamanı": formatTR(Number(fundingTime)) };
    }
  } catch {
    /* yoksay */
  }
  return { şablon: `#${templateId}` };
}

export function formatE8(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const i = (a / 100_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const f = (a % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${i}${f ? "," + f : ""}`;
}

const trFmt = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
export const formatTR = (sec: number) => trFmt.format(new Date(sec * 1000)).replace(",", "");

/** kUSDC (6 decimals) → "12,5" */
export function formatUsdc(v: bigint, digits = 2): string {
  const n = Number(v) / 1e6;
  return n.toLocaleString("tr-TR", { maximumFractionDigits: digits });
}

export function impliedYes(m: Pick<Market, "yesPool" | "noPool">): number | null {
  const total = m.yesPool + m.noPool;
  if (total === 0n) return null;
  return Number((m.yesPool * 10_000n) / total) / 100;
}

/** Kullanıcıya gösterilecek durum etiketi (zamana göre) */
export function phase(m: Market, nowSec: number): { label: string; tone: "open" | "closed" | "proposed" | "disputed" | "final" } {
  if (m.status === 3) return { label: `Kesinleşti · ${OUTCOME[m.finalOutcome]}`, tone: "final" };
  if (m.status === 2) return { label: "İtirazda", tone: "disputed" };
  if (m.status === 1) return { label: `Önerildi · ${OUTCOME[m.proposedOutcome]}`, tone: "proposed" };
  if (nowSec < m.closeTime) return { label: "Tahmine açık", tone: "open" };
  return { label: "Çözüm bekleniyor", tone: "closed" };
}
