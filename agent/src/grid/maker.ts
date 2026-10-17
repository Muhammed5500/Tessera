import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseUnits } from "viem";
import { atkCli } from "../atk/cli.js";
import { config } from "../config.js";
import { mockUsdcAbi } from "../chain/abi.js";
import { agentWallet, loadDeployment, publicClient, sendAndConfirm } from "../chain/client.js";
import { bet, createMarket, getAllMarkets, readParams, WRITE_GAS } from "../chain/markets.js";
import { metadataURI } from "../evidence/store.js";
import { addEvent, saveMeta } from "../feed/store.js";
import { formatE8, parseE8 } from "../lib/decimal.js";
import { formatTR, nowSec } from "../lib/time.js";
import { priceInBand } from "../templates/priceInBand.js";
import { bandProbabilities, bandsAround, isTail, seedSplit, sigmaPerMinute, withTails } from "./model.js";

/**
 * Canlı ızgara yapıcı (deterministik, LLM yok).
 * Her GRID_STEP_SEC (3 dk) zaman noktası için, ufuk (GRID_HORIZON_MIN) içinde eksik olan sütunu açar:
 * spot fiyat etrafında GRID_BANDS adet GRID_BAND_USD genişliğinde PRICE_IN_BAND marketi + olasılığa göre seed.
 * Tahminler, kontrat kuralı gereği ölçümden minResolveGap (120 sn) önce kapanır.
 */

type GridState = { columns: Record<string, { marketIds: string[]; createdAt: string; spot: string }> };
const file = () => join(config.DATA_DIR, "grid.json");
const load = (): GridState => (existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : { columns: {} });
const save = (s: GridState) => {
  mkdirSync(config.DATA_DIR, { recursive: true });
  writeFileSync(file(), JSON.stringify(s, null, 2));
};

let running = false;
let gap: number | null = null;

async function ensureAllowance(neededMicro: bigint) {
  const dep = loadDeployment();
  const allowance = await publicClient.readContract({ address: dep.usdc, abi: mockUsdcAbi, functionName: "allowance", args: [dep.agent, dep.pm] });
  if (allowance >= neededMicro) return;
  // Agent'ın kendi seed'leri için sonlu, büyük bir onay (her market için ayrı approve işlemi göndermemek için)
  await sendAndConfirm("approve(grid)", () =>
    agentWallet().writeContract({ gas: WRITE_GAS, address: dep.usdc, abi: mockUsdcAbi, functionName: "approve", args: [dep.pm, parseUnits("5000", 6)] }),
  );
}

async function marketData(inst: string) {
  const res = await atkCli("global", ["market", "candles", inst, "--bar", "1m", "--limit", "60"]);
  const rows = res.json as string[][];
  const closes = rows.map((r) => Number(r[4])).reverse(); // eskiden yeniye
  return { spotStr: String(rows[0][4]), spot: Number(rows[0][4]), sigma: sigmaPerMinute(closes) };
}

export async function gridTick(): Promise<void> {
  if (!config.GRID_ENABLED || config.PAUSE_AGENT || running) return;
  running = true;
  try {
    gap ??= (await readParams()).minResolveGap;
    const step = config.GRID_STEP_SEC;
    const now = nowSec();
    const state = load();

    // Ufuk içindeki zaman noktaları; açılışa ve seed'e yetecek süre (kapanıştan ≥ 60 sn önce) olanlar
    const targets: number[] = [];
    for (let t = Math.ceil(now / step) * step; t <= now + config.GRID_HORIZON_MIN * 60; t += step) {
      if (t - gap - now >= 60 && !state.columns[String(t)]) targets.push(t);
    }
    if (targets.length === 0) return;

    // Zincir tek doğruluk kaynağı: bir sütunda zaten var olan kareler (önceki tur yarıda kaldıysa ya da başka bir
    // süreç açtıysa) tekrar AÇILMAZ, yalnız eksik bantlar tamamlanır. Böylece aynı bant için çift market oluşmaz.
    const onchain = (await getAllMarkets()).filter((m) => m.templateId === priceInBand.id);
    const existingFor = (t: number) => new Map(onchain.filter((m) => m.resolveTime === t).map((m) => [m.params.toLowerCase(), m]));
    const seeded = (m: (typeof onchain)[number]) => m.yesPool > 0n && m.noPool > 0n;
    const bandOf = (m: (typeof onchain)[number]) => {
      const d = priceInBand.decode(m.params);
      return { lowE8: d.lowE8, highE8: d.highE8 };
    };
    for (const t of [...targets]) {
      const ex = [...existingFor(t).values()];
      const tails = ex.filter((m) => isTail(bandOf(m))).length;
      if (ex.length - tails >= config.GRID_BANDS && tails >= 2 && ex.every(seeded)) {
        state.columns[String(t)] = { marketIds: ex.map((m) => m.id.toString()), createdAt: new Date().toISOString(), spot: "zincirden" };
        targets.splice(targets.indexOf(t), 1);
      }
    }
    save(state);
    if (targets.length === 0) return;

    const { spotStr, spot, sigma } = await marketData(config.GRID_INST);
    const widthE8 = parseE8(String(config.GRID_BAND_USD));
    const seedMicro = parseUnits(String(config.GRID_SEED), 6);
    await ensureAllowance(seedMicro * BigInt((config.GRID_BANDS + 2) * targets.length));

    for (const t of targets) {
      // Sütunda zaten ortadaki kareler varsa (ör. kenar bantları sonradan ekleniyor) aynı bant dizisini yeniden kur;
      // yoksa güncel spot fiyatın etrafında aç. Kareler alttan üste sırayla açıldığı için en alttaki ilk banttır.
      const central = [...existingFor(t).values()].map(bandOf).filter((b) => !isTail(b));
      const anchorE8 = central.length
        ? central.reduce((a, b) => (b.lowE8 < a ? b.lowE8 : a), central[0].lowE8) + BigInt(Math.floor(config.GRID_BANDS / 2)) * widthE8
        : parseE8(spotStr);
      const mid = bandsAround(anchorE8, widthE8, config.GRID_BANDS);
      const bands = withTails(mid);
      const probs = bandProbabilities(spot, sigma, (t - now) / 60, bands);
      const ids: string[] = [];
      const existing = existingFor(t);
      for (let i = 0; i < bands.length; i++) {
        const params = { site: "global" as const, instId: config.GRID_INST, lowE8: bands[i].lowE8, highE8: bands[i].highE8 };
        const have = existing.get(priceInBand.encode(params).toLowerCase());
        if (have) {
          // Açılmış ama başlangıç likiditesi eksik kalmış kare (ör. süreç seed'den önce durdu): eksik tarafı tamamla
          if (!seeded(have)) {
            const split = seedSplit(probs[i], seedMicro, 1_000_000n);
            if (have.yesPool === 0n) await bet(have.id, true, split.yes);
            if (have.noPool === 0n) await bet(have.id, false, split.no);
          }
          ids.push(have.id.toString());
          continue;
        }
        const created = await createMarket({
          templateId: priceInBand.id,
          params: priceInBand.encode(params),
          question: priceInBand.questionTR(params, t),
          metadataURI: metadataURI(),
          closeTime: t - gap,
          resolveTime: t,
        });
        const p = probs[i];
        saveMeta(created.id, {
          source: "grid",
          template: priceInBand.key,
          params: priceInBand.toJson(params),
          rule: priceInBand.ruleTR(params, t),
          rationale_tr:
            `Canlı ızgara karesi. Spot ${spotStr} $, son 60 dk'lık 1 dk oynaklığı %${(sigma * 100).toFixed(3)}; ` +
            `${Math.round((t - now) / 60)} dk sonrası için log-normal modelle bu bandın olasılığı %${(p * 100).toFixed(1)}.`,
          myProbability: Number(p.toFixed(4)),
          grid: { column: t, band: i, lowE8: params.lowE8.toString(), highE8: params.highE8.toString() },
          createdTx: created.hash,
        });
        const split = seedSplit(p, seedMicro, 1_000_000n);
        await bet(created.id, true, split.yes);
        await bet(created.id, false, split.no);
        ids.push(created.id.toString());
      }
      // Sütun yalnız tüm bantları zincirde olunca "tamam" sayılır; yarıda kalırsa sonraki tur eksikleri tamamlar
      state.columns[String(t)] = { marketIds: ids, createdAt: new Date().toISOString(), spot: spotStr };
      save(state);
      addEvent({
        type: "market_created",
        marketId: ids[0],
        message: `Izgara sütunu açıldı: ${formatTR(t)} · ${mid.length} bant (${formatE8(mid[0].lowE8)}–${formatE8(mid.at(-1)!.highE8)} $) + alt/üst kenar · market #${ids[0]}–#${ids.at(-1)}`,
        data: { column: t, marketIds: ids, spot: spotStr, sigmaPerMin: sigma, probs: probs.map((x) => Number(x.toFixed(4))) },
      });
    }
  } catch (e) {
    const err = e as Error & { shortMessage?: string };
    addEvent({ type: "error", message: `Izgara hatası: ${(err.shortMessage ?? err.message).slice(0, 200)}` });
  } finally {
    running = false;
  }
}
