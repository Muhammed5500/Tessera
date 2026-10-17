import { predictionMarketAbi } from "./abi";
import { PM_ADDRESS, publicClient, type Market } from "./chain";

export type ProbPoint = { t: number; yes: number }; // t: Unix sn, yes: 0–100

const CHUNK = 2000n; // publicnode getLogs sınırı
const MAX_CHUNKS = 12;

/**
 * Bir marketin EVET olasılığının (havuz oranı) zaman içindeki değişimi, BetPlaced olaylarından.
 * Blok zamanları tek tek çekilmez; iki uç bloğun zamanından doğrusal tahmin edilir (grafik için yeterli).
 */
export async function getProbHistory(m: Market): Promise<ProbPoint[]> {
  const head = await publicClient.getBlock();
  const headNum = head.number;
  const headTs = Number(head.timestamp);
  // Fuji ~2 sn/blok; güvenli tarafta kalmak için 1,5 sn varsayıp biraz daha geriden başla
  const back = BigInt(Math.ceil((headTs - m.createdAt) / 1.5)) + 50n;
  let from = headNum > back ? headNum - back : 0n;
  if ((headNum - from) / CHUNK > BigInt(MAX_CHUNKS)) from = headNum - CHUNK * BigInt(MAX_CHUNKS);
  const fromBlock = await publicClient.getBlock({ blockNumber: from });
  const fromTs = Number(fromBlock.timestamp);
  const secPerBlock = headNum > from ? (headTs - fromTs) / Number(headNum - from) : 2;

  const ranges: [bigint, bigint][] = [];
  for (let a = from; a <= headNum; a += CHUNK) ranges.push([a, a + CHUNK - 1n > headNum ? headNum : a + CHUNK - 1n]);
  const chunks = await Promise.all(
    ranges.map(([a, b]) =>
      publicClient.getContractEvents({
        address: PM_ADDRESS,
        abi: predictionMarketAbi,
        eventName: "BetPlaced",
        args: { id: m.id },
        fromBlock: a,
        toBlock: b,
      }),
    ),
  );
  const logs = chunks.flat().sort((x, y) => Number(x.blockNumber - y.blockNumber) || x.logIndex - y.logIndex);

  let yesPool = 0n;
  let noPool = 0n;
  const pts: ProbPoint[] = [];
  for (const l of logs) {
    const a = l.args as { yes?: boolean; amount?: bigint };
    if (a.yes) yesPool += a.amount ?? 0n;
    else noPool += a.amount ?? 0n;
    const total = yesPool + noPool;
    if (yesPool === 0n || noPool === 0n) continue;
    const t = Math.round(fromTs + Number(l.blockNumber - from) * secPerBlock);
    const pt = { t, yes: Number((yesPool * 10_000n) / total) / 100 };
    // Aynı bloktaki olaylar (ör. açılış likiditesi iki taraf) tek nokta sayılır
    if (pts.length && pts[pts.length - 1].t === t) pts[pts.length - 1] = pt;
    else pts.push(pt);
  }
  return pts;
}
