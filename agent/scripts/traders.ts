/**
 * Demo trader agent'ları — KAHİN'e DIŞARIDAN katılan, kendi cüzdanı ve kendi stratejisi olan 6 kural tabanlı bot.
 * Kendi agent'ımız gibi davranmazlar: yalnız herkese açık Oracle MCP'yi kullanırlar
 * (list_open_markets → prepare_bet → kendi cüzdanıyla imzala/gönder; get_position → prepare_claim).
 * Fiyat verisini kendi başlarına OKX'in herkese açık API'sinden alırlar. Ayrıca belirli aralıklarla
 * LLM'li örnek agent (npm run rival) da çalıştırılır.
 *
 *   npm run traders            # botları başlat (ilk çalıştırmada cüzdanları üretir ve fonlar)
 *
 * Anahtarlar data/traders.json'da (gitignore'da) tutulur, ekrana yazılmaz. Gas için test AVAX'ı
 * owner cüzdanından (contracts/.env → DEPLOYER_PRIVATE_KEY) aktarılır; kUSDC her botun kendi faucet'inden gelir.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import dotenv from "dotenv";
import { createPublicClient, createWalletClient, fallback, formatEther, http, parseEther, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { mockUsdcAbi } from "../src/chain/abi.js";

const here = dirname(fileURLToPath(import.meta.url));
const agentDir = resolve(here, "..");
const dataDir = join(agentDir, "data");
const keysFile = join(dataDir, "traders.json");
const stateFile = join(dataDir, "traders-state.json");
const dep = JSON.parse(readFileSync(join(agentDir, "..", "deployments", "fuji.json"), "utf8")) as { usdc: Hex; pm: Hex };

const RIVAL_EVERY_MIN = Number(process.env.RIVAL_EVERY_MIN ?? 20);
const GAS = 500_000n;
const AVAX_TOPUP = parseEther("0.01");

type Strategy = "momentum" | "reversion" | "spot" | "tails" | "value" | "contrarian";
const BOTS: { name: string; strategy: Strategy; about: string }[] = [
  { name: "Momentum", strategy: "momentum", about: "son 5 dk'lık yönün devam edeceğini varsayar" },
  { name: "Reversion", strategy: "reversion", about: "son hareketin geri döneceğini varsayar" },
  { name: "Spot", strategy: "spot", about: "fiyatın olduğu yerde kalacağını varsayar" },
  { name: "Tails", strategy: "tails", about: "ucuz kenar karelerine küçük tutarlar koyar" },
  { name: "Value", strategy: "value", about: "agent tahmini ile havuz oranı ayrışınca girer" },
  { name: "Contrarian", strategy: "contrarian", about: "kalabalığın tersine, ucuz tarafı alır" },
];

/* ---------- cüzdanlar ---------- */

type KeyRow = { name: string; key: Hex };
mkdirSync(dataDir, { recursive: true });
const keys: KeyRow[] = existsSync(keysFile) ? JSON.parse(readFileSync(keysFile, "utf8")) : [];
for (const b of BOTS) if (!keys.find((k) => k.name === b.name)) keys.push({ name: b.name, key: generatePrivateKey() });
writeFileSync(keysFile, JSON.stringify(keys, null, 2));
// Herkese açık adresler (web etiketleri için); anahtar içermez
writeFileSync(
  join(dataDir, "traders-public.json"),
  JSON.stringify(keys.map((k) => ({ name: k.name, address: privateKeyToAccount(k.key).address })), null, 2),
);

const readT = fallback([http("https://avalanche-fuji-c-chain-rpc.publicnode.com"), http("https://api.avax-test.network/ext/bc/C/rpc")]);
const writeT = fallback([http("https://api.avax-test.network/ext/bc/C/rpc"), http("https://avalanche-fuji-c-chain-rpc.publicnode.com")]);
const pub = createPublicClient({ chain: avalancheFuji, transport: readT, pollingInterval: 500 });

const log = (who: string, msg: string) => console.log(`${new Date().toLocaleTimeString("tr-TR")} [${who}] ${msg}`);

/* ---------- durum (botun girdiği marketler) ---------- */

/** bets: girilen marketler (tekil, claim için) · last: son işlem zamanı (ms) · spent: markete toplam yatırılan */
type BotState = { bets: number[]; claimed: number[]; last?: Record<string, number>; spent?: Record<string, number> };
type State = Record<string, BotState>;
const state: State = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {};

/** Aynı markete tekrar girme kuralları: market kapanana kadar aralıklarla, toplam tutar sınırıyla */
const RULES = {
  market: { cooldownMs: 5 * 60_000, cap: 40 },
  grid: { cooldownMs: 3 * 60_000, cap: 20 },
} as const;
const saveState = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));

/* ---------- MCP ---------- */

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const mcp = new Client({ name: "tessera-demo-traders", version: "1.0.0" });
await mcp.connect(
  new StdioClientTransport({ command: npm, args: ["--prefix", agentDir, "run", "-s", "oracle:stdio"], stderr: "ignore" }),
);
async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  const text = r.content?.[0]?.text ?? "";
  if (r.isError) throw new Error(text);
  return JSON.parse(text) as T;
}

type OpenMarket = {
  marketId: number;
  kind: "grid" | "market";
  band?: { low: string | null; high: string | null };
  closeTime: number;
  resolveTime: number;
  secondsToClose: number;
  impliedYes: number | null;
  agentForecast: number | null;
  params: Record<string, string>;
};
type Prepared = { steps: { to: Hex; data: Hex; description?: string }[]; faucet: { to: Hex; data: Hex } };

/* ---------- piyasa verisi (botların kendi kaynağı: OKX herkese açık API) ---------- */

async function candles(instId: string): Promise<number[]> {
  const r = await fetch(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=1m&limit=6`);
  const j = (await r.json()) as { data: string[][] };
  return j.data.map((x) => Number(x[4])).reverse(); // eskiden yeniye
}

async function fundingRate(instId: string): Promise<number> {
  const r = await fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`);
  const j = (await r.json()) as { data: { fundingRate: string }[] };
  return Number(j.data[0]?.fundingRate ?? 0);
}

/* ---------- strateji: hangi market, hangi taraf, ne kadar ---------- */

type Pick = { m: OpenMarket; yes: boolean; amount: number; why: string } | null;
const rnd = (a: number, b: number) => Math.round(a + Math.random() * (b - a));
const inBand = (m: OpenMarket, p: number) => {
  const lo = m.band?.low === null ? -Infinity : Number(m.band?.low);
  const hi = m.band?.high === null ? Infinity : Number(m.band?.high);
  return p >= lo && p < hi;
};

const pct = (x: number) => `%${Math.round(x * 100)}`;

/** Normal (fiyat/funding) marketlerde stratejinin kararı. Karar yoksa null. */
async function decideMarket(s: Strategy, m: OpenMarket): Promise<{ yes: boolean; why: string } | null> {
  const implied = m.impliedYes ?? 0.5;
  if (s === "value" && m.agentForecast !== null && Math.abs(m.agentForecast - implied) > 0.05)
    return { yes: m.agentForecast > implied, why: `agent ${pct(m.agentForecast)} vs havuz ${pct(implied)}` };
  if (s === "contrarian") return { yes: implied < 0.5, why: `kalabalık ${pct(implied)} Evet, tersine` };
  if (s === "tails") return { yes: implied < 0.5, why: `ucuz taraf (${pct(implied < 0.5 ? implied : 1 - implied)})` };

  if (m.params.thresholdE8) {
    // PRICE_ABOVE: enstrümanın son 5 dk'sına göre ölçüm anındaki fiyatı tahmin et
    const th = Number(m.params.thresholdE8) / 1e8;
    const c = await candles(m.params.instId);
    const last = c[c.length - 1];
    const delta = last - c[0];
    const proj = s === "momentum" ? last + delta * 2 : s === "reversion" ? last - delta * 2 : last;
    const label = s === "momentum" ? "yön devam" : s === "reversion" ? "geri dönüş" : "fiyat yerinde";
    return { yes: proj > th, why: `${m.params.instId.split("-")[0]} ${last} → ${label} → eşik ${th} ${proj > th ? "üstü" : "altı"}` };
  }
  if (m.params.fundingTime) {
    // FUNDING_POSITIVE: güncel dönem oranına bak
    const r = await fundingRate(m.params.instId);
    const flip = s === "reversion";
    return { yes: flip ? r <= 0 : r > 0, why: `${m.params.instId} güncel funding ${(r * 100).toFixed(4)}%${flip ? ", dönecek" : ""}` };
  }
  return null;
}

async function choose(s: Strategy, me: string): Promise<Pick> {
  // Bir markete kapanana kadar tekrar tekrar girilebilir: son işlemden beri bekleme süresi geçmiş ve
  // toplam tutar sınırın altında olmalı. Hiç girilmemiş (yeni) marketler önce denenir.
  const st = state[me] ?? { bets: [], claimed: [] };
  const now = Date.now();
  const eligible = (m: OpenMarket) => {
    const r = RULES[m.kind];
    const id = String(m.marketId);
    return now - (st.last?.[id] ?? 0) >= r.cooldownMs && (st.spent?.[id] ?? 0) < r.cap;
  };
  const isNew = (m: OpenMarket) => !st.last?.[String(m.marketId)];
  const all = await call<OpenMarket[]>("list_open_markets", { minSecondsToClose: 45 });
  const grid = all.filter((m) => m.kind === "grid" && eligible(m));
  const markets = all.filter((m) => m.kind === "market" && eligible(m));
  const columns = [...new Set(grid.map((m) => m.resolveTime))].sort((a, b) => a - b);

  // Yeni normal market varsa büyük ihtimalle ona; değilse turların yarısı normal marketlerde, yarısı ızgarada
  const fresh = markets.filter(isNew);
  if (markets.length && (fresh.length ? Math.random() < 0.8 : Math.random() < 0.5 || !columns.length)) {
    const order = [...fresh.sort(() => Math.random() - 0.5), ...markets.filter((m) => !isNew(m)).sort(() => Math.random() - 0.5)];
    for (const m of order) {
      const d = await decideMarket(s, m).catch(() => null);
      if (d) return { m, yes: d.yes, amount: rnd(s === "tails" ? 2 : 3, s === "tails" ? 5 : 10), why: d.why };
    }
  }

  if (!columns.length) return null;
  const closes = await candles("BTC-USDT");
  const last = closes[closes.length - 1];
  const delta = last - closes[0];
  let target = last;
  let col = columns[0];
  let why = "";
  switch (s) {
    case "momentum":
      target = last + delta * 0.6;
      why = `5 dk değişim ${delta >= 0 ? "+" : ""}${delta.toFixed(0)} $, devam eder`;
      break;
    case "reversion":
      target = last - delta * 0.6;
      why = `5 dk değişim ${delta >= 0 ? "+" : ""}${delta.toFixed(0)} $, geri döner`;
      break;
    case "tails": {
      col = columns[columns.length - 1];
      const tail = grid.find((m) => m.resolveTime === col && (delta >= 0 ? m.band?.high === null : m.band?.low === null));
      if (tail) return { m: tail, yes: true, amount: rnd(2, 4), why: `uzak sütunda ${delta >= 0 ? "üst" : "alt"} kenar, yüksek çarpan` };
      break;
    }
    default:
      col = columns[Math.min(1, columns.length - 1)];
      why = `fiyat ${last.toFixed(0)} $ civarında kalır`;
  }
  const sq = grid.find((m) => m.resolveTime === col && inBand(m, target));
  return sq ? { m: sq, yes: true, amount: rnd(2, 8), why } : null;
}

/* ---------- bot ---------- */

async function runBot(bot: (typeof BOTS)[number]) {
  const row = keys.find((k) => k.name === bot.name)!;
  const account = privateKeyToAccount(row.key);
  const wallet = createWalletClient({ account, chain: avalancheFuji, transport: writeT });
  state[bot.name] ??= { bets: [], claimed: [] };
  const who = `${bot.name}`;

  const send = async (to: Hex, data: Hex) => {
    const hash = await wallet.sendTransaction({ to, data, gas: GAS });
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (r.status !== "success") throw new Error(`işlem başarısız ${hash}`);
    return hash;
  };

  // kUSDC yetmiyorsa faucet; harcama onayı yetmiyorsa prepare_bet'in approve adımı
  const ensureFunds = async (prep: Prepared, amount: number) => {
    const bal = await pub.readContract({ address: dep.usdc, abi: mockUsdcAbi, functionName: "balanceOf", args: [account.address] });
    if (bal < parseUnits(String(amount), 6)) {
      await send(prep.faucet.to, prep.faucet.data);
      log(who, "faucet → 1000 kUSDC");
    }
    const allowance = await pub.readContract({ address: dep.usdc, abi: mockUsdcAbi, functionName: "allowance", args: [account.address, dep.pm] });
    if (allowance < parseUnits(String(amount), 6)) await send(prep.steps[0].to, prep.steps[0].data); // prepare_bet'in approve adımı
  };

  const trade = async () => {
    const pick = await choose(bot.strategy, bot.name);
    if (!pick) return log(who, "uygun kare/market yok, bekliyor");
    const prep = await call<Prepared>("prepare_bet", {
      marketId: pick.m.marketId,
      side: pick.yes ? "YES" : "NO",
      amount: String(pick.amount),
      from: account.address,
    });
    await ensureFunds(prep, pick.amount);
    const hash = await send(prep.steps[1].to, prep.steps[1].data); // bet adımı
    const st = state[bot.name];
    const id = String(pick.m.marketId);
    if (!st.bets.includes(pick.m.marketId)) st.bets.push(pick.m.marketId);
    st.last = { ...(st.last ?? {}), [id]: Date.now() };
    st.spent = { ...(st.spent ?? {}), [id]: (st.spent?.[id] ?? 0) + pick.amount };
    saveState();
    const band = pick.m.band ? ` [${pick.m.band.low ?? "−∞"}–${pick.m.band.high ?? "∞"}]` : "";
    log(who, `#${pick.m.marketId}${band} ${pick.yes ? "EVET" : "HAYIR"} ${pick.amount} kUSDC · ${pick.why} · ${hash.slice(0, 10)}…`);
  };

  const claimAll = async () => {
    const s = state[bot.name];
    for (const id of s.bets.filter((x) => !s.claimed.includes(x))) {
      try {
        const pos = await call<{ claimable: string; claimed: boolean }>("get_position", { marketId: id, address: account.address });
        if (pos.claimed || Number(pos.claimable) === 0) {
          const m = await call<{ status: string }>("get_market", { marketId: id }).catch(() => null);
          if (pos.claimed || m?.status === "Finalized") s.claimed.push(id); // kesinleşti ve alacak yok
          continue;
        }
        const c = await call<Prepared>("prepare_claim", { marketId: id, address: account.address });
        await send(c.steps[0].to, c.steps[0].data);
        s.claimed.push(id);
        log(who, `#${id} ödül alındı: ${pos.claimable} kUSDC`);
      } catch {
        /* henüz kesinleşmedi */
      }
    }
    saveState();
  };

  log(who, `${account.address} · ${bot.about}`);
  let n = 0;
  for (;;) {
    try {
      await trade();
      if (++n % 3 === 0) await claimAll();
    } catch (e) {
      log(who, `hata: ${((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).slice(0, 140)}`);
    }
    await new Promise((r) => setTimeout(r, rnd(60, 150) * 1000));
  }
}

/* ---------- gas fonlaması (owner cüzdanından) ---------- */

async function fundGas() {
  const low: Hex[] = [];
  for (const k of keys) {
    const a = privateKeyToAccount(k.key).address;
    if ((await pub.getBalance({ address: a })) < AVAX_TOPUP / 2n) low.push(a);
  }
  if (!low.length) return;
  dotenv.config({ path: join(agentDir, "..", "contracts", ".env"), quiet: true });
  const raw = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!raw) throw new Error("contracts/.env içinde DEPLOYER_PRIVATE_KEY yok; botlara gas gönderilemedi");
  const funder = createWalletClient({
    account: privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex),
    chain: avalancheFuji,
    transport: writeT,
  });
  for (const to of low) {
    const hash = await funder.sendTransaction({ to, value: AVAX_TOPUP });
    await pub.waitForTransactionReceipt({ hash });
    log("fon", `${to} ← ${formatEther(AVAX_TOPUP)} AVAX`);
  }
}

/* ---------- LLM'li örnek agent (Claude Code) ---------- */

function rivalLoop() {
  let grid = true;
  const run = () => {
    const args = ["--prefix", agentDir, "run", "-s", "rival", "--", ...(grid ? ["--grid"] : []), "--max", "10"];
    grid = !grid;
    log("Claude", `çalışıyor (${grid ? "market" : "ızgara"})`);
    const p = spawn(npm, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => {
      const summary = out
        .split("ÖZET")[1]
        ?.split("\n")
        .map((l) => l.replace(/[*#`]/g, "").trim())
        .filter((l) => l && !/^(Özet|Summary)$/i.test(l) && !l.startsWith("("))
        .slice(0, 2)
        .join(" ");
      log("Claude", summary ? summary.slice(0, 200) : "bitti");
    });
  };
  setTimeout(run, 90_000);
  setInterval(run, RIVAL_EVERY_MIN * 60_000);
}

await fundGas();
for (const [i, b] of BOTS.entries()) setTimeout(() => runBot(b), i * 8_000); // aynı anda başlamasınlar
if (RIVAL_EVERY_MIN > 0) rivalLoop();
