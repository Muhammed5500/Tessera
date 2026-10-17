import { predictionMarketAbi } from "./abi";
import { PM_ADDRESS, publicClient, type Market } from "./chain";

export type ProbPoint = { t: number; yes: number }; // t: Unix sn, yes: 0–100
export type Activity = { t: number; user: string; yes: boolean; amount: bigint; price: number | null; tx: string };

const CHUNK = 2000n; // publicnode getLogs sınırı
const MAX_CHUNKS = 24; // ~24 bin blok geriye (Fuji'de birkaç saat)

/**
 * Bir marketin EVET olasılığının (havuz oranı) zaman içindeki değişimi, BetPlaced olaylarından.
 * Blok zamanları tek tek çekilmez; iki uç bloğun zamanından doğrusal tahmin edilir (grafik için yeterli).
 */
export async function getProbHistory(m: Market): Promise<{ points: ProbPoint[]; activity: Activity[] }> {
  const head = await publicClient.getBlock();
  const headNum = head.number;
  const headTs = Number(head.timestamp);
  // Blok süresi sabit değil (Fuji'de ~1–2 sn): gerçek hızı ölç, market açılışından biraz önceye git;
  // tahmin kısa kaldıysa (başlangıç bloğu açılıştan sonraysa) bir kez daha geri çekil.
  const probe = headNum > 5000n ? headNum - 5000n : 0n;
  const probeTs = Number((await publicClient.getBlock({ blockNumber: probe })).timestamp);
  const rate = headNum > probe ? Math.max(0.2, (headTs - probeTs) / Number(headNum - probe)) : 1;
  const maxBack = CHUNK * BigInt(MAX_CHUNKS);
  const backFor = (sec: number) => {
    const b = BigInt(Math.ceil(sec / rate)) + 300n;
    return b > maxBack ? maxBack : b;
  };
  let from = headNum > backFor(headTs - m.createdAt) ? headNum - backFor(headTs - m.createdAt) : 0n;
  let fromBlock = await publicClient.getBlock({ blockNumber: from });
  if (Number(fromBlock.timestamp) > m.createdAt && from > 0n) {
    const extra = backFor(Number(fromBlock.timestamp) - m.createdAt + 120);
    from = from > extra ? from - extra : 0n;
    if (headNum - from > maxBack) from = headNum - maxBack;
    fromBlock = await publicClient.getBlock({ blockNumber: from });
  }
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
  const activity: Activity[] = [];
  for (const l of logs) {
    const a = l.args as { yes?: boolean; amount?: bigint; user?: string };
    if (a.yes) yesPool += a.amount ?? 0n;
    else noPool += a.amount ?? 0n;
    const total = yesPool + noPool;
    const t = Math.round(fromTs + Number(l.blockNumber - from) * secPerBlock);
    const side = a.yes ? yesPool : noPool;
    activity.push({
      t,
      user: a.user ?? "",
      yes: !!a.yes,
      amount: a.amount ?? 0n,
      // Karşı taraf henüz boşken "fiyat" anlamsız (her zaman 100¢); gösterme
      price: yesPool > 0n && noPool > 0n ? Number((side * 100n) / total) : null,
      tx: l.transactionHash ?? "",
    });
    if (yesPool === 0n || noPool === 0n) continue;
    const pt = { t, yes: Number((yesPool * 10_000n) / total) / 100 };
    // Aynı bloktaki olaylar (ör. açılış likiditesi iki taraf) tek nokta sayılır
    if (pts.length && pts[pts.length - 1].t === t) pts[pts.length - 1] = pt;
    else pts.push(pt);
  }
  return { points: pts, activity: activity.reverse() };
}
