"use client";

import { CodeBlock, LiveDot, PageHeader } from "@/components/ui";
import { AGENT_API } from "@/lib/agentApi";
import { usePoll } from "@/lib/hooks";

const TOOLS = [
  { name: "list_templates", price: "ücretsiz", desc: "Şablon kataloğu, parametre şemaları ve kurallar." },
  {
    name: "resolve_metric",
    price: "0,01 USDC",
    desc: "Şablon + parametre + geçmiş zaman için sonuç (EVET/HAYIR/GEÇERSİZ), kanıt, hash ve çalıştırılan OKX komutları. Aynı girdi → aynı hash.",
  },
  { name: "get_market", price: "ücretsiz", desc: "Zincirdeki bir market, kanıtı ve doğrulama durumu." },
  { name: "get_forecast", price: "0,005 USDC", desc: "Agent'ın bir market için olasılık tahmini ve gerekçesi." },
  { name: "list_open_markets", price: "ücretsiz", desc: "Tahmine açık marketler: soru, kural, zamanlar, havuzlar, agent tahmini." },
  { name: "prepare_bet", price: "ücretsiz", desc: "İmzalanmamış approve + bet işlemi. Servis anahtar tutmaz; çağıran agent kendi cüzdanıyla imzalar." },
  { name: "get_position", price: "ücretsiz", desc: "Bir adresin marketteki payları, alınabilir ödülü ve bakiyesi." },
  { name: "prepare_claim", price: "ücretsiz", desc: "Kesinleşmiş markette ödülü almak için imzalanmamış claim işlemi." },
];

const EXAMPLE_REQ = `// zincirdeki bir marketi yeniden hesapla
{ "marketId": 1 }

// ya da serbest sorgu
{
  "templateId": 2,
  "params": { "instId": "BTC-USDT-SWAP", "fundingTime": 1792224000 },
  "resolveTime": 1792224120
}`;

const EXAMPLE_RES = `{
  "outcome": "NO",
  "evidenceHash": "0x5086180e8432e26a6a7017667e0088272eb558e422b09ffd550669da2e37031e",
  "onchainEvidenceHash": "0x5086180e8432e26a6a7017667e0088272eb558e422b09ffd550669da2e37031e",
  "matchesChain": true,
  "observations": [
    { "role": "primary", "instId": "BTC-USDT", "kind": "candle_1m", "close": "81590.3" },
    { "role": "crosscheck", "instId": "BTC-USD", "kind": "index_candle_1m", "close": "81479.2" }
  ],
  "commands": ["OKX_SITE=global okx market candles BTC-USDT --bar 1m --after 1792231920000 --limit 1 --json", "..."]
}`;

async function health() {
  const r = await fetch(`${AGENT_API}/health`, { cache: "no-store" });
  return r.ok;
}

export default function OraclePage() {
  const up = usePoll(health, 15_000);
  const online = up.data === true;

  return (
    <div className="space-y-10">
      <PageHeader
        title="Oracle"
        right={
          <span className="flex items-center gap-2 text-sm text-muted">
            <LiveDot on={online} />
            {up.loading && up.data === null ? "Kontrol ediliyor" : online ? "Servis çalışıyor" : "Servise ulaşılamıyor"}
          </span>
        }
      >
        Marketleri çözen motor, başka agent&apos;ların da kullanabileceği bir MCP servisi. &quot;Bu metrik şu zamanda şu eşiğin üstünde
        miydi?&quot; sorusuna OKX verisiyle, tekrar üretilebilir ve hash&apos;li bir cevap verir. Agent&apos;lar aynı servisle marketleri
        listeleyip kendi cüzdanlarıyla tahmin de yapabilir.
      </PageHeader>

      <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="card overflow-hidden">
          <div className="border-b border-line px-5 py-3 text-[15px] font-medium">Araçlar</div>
          <ul className="divide-y divide-line">
            {TOOLS.map((t) => (
              <li key={t.name} className="grid gap-1 px-5 py-3 sm:grid-cols-[170px_1fr_auto] sm:gap-4">
                <span className="mono text-sm text-text">{t.name}</span>
                <span className="text-sm text-muted">{t.desc}</span>
                <span className="tabular text-xs text-muted sm:text-right">{t.price}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-5 py-2.5 text-[11px] text-muted">
            Ücretler OKX.AI listelemesi için planlanan değerlerdir; test sürümünde tahsil edilmez.
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="text-[15px] font-medium">Bağlan</h2>
            <p className="mt-1 text-sm text-muted">Herhangi bir MCP istemcisi (Streamable HTTP, durumsuz). IP başına dakikada 30 istek.</p>
            <div className="mt-3 space-y-3">
              <CodeBlock label="HTTP">{`${AGENT_API}/mcp`}</CodeBlock>
              <CodeBlock label="Claude Code · stdio">{`claude mcp add --transport stdio kahin-oracle -- npm --prefix <repo>/agent run -s oracle:stdio`}</CodeBlock>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted">Model</dt>
              <dd className="mt-0.5">Çağrı başı (A2MCP)</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Veri</dt>
              <dd className="mt-0.5">OKX Agent Trade Kit</dd>
            </div>
          </dl>
        </div>
      </section>

      <section>
        <h2 className="text-[15px] font-medium">Örnek: resolve_metric</h2>
        <p className="mt-1 text-sm text-muted">Yanıt, market #1&apos;in gerçek çözümüdür; hash zincirdekiyle birebir aynı.</p>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <CodeBlock label="istek">{EXAMPLE_REQ}</CodeBlock>
          <CodeBlock label="yanıt">{EXAMPLE_RES}</CodeBlock>
        </div>
      </section>

      <section className="border-t border-line pt-6 text-sm text-muted">
        <span className="text-text">Durum:</span> 8 araçlı MCP servisi (stdio + HTTP) çalışıyor ve zincirle eşleşen hash üretiyor. OKX.AI&apos;a gerçek
        servis kaydı, staking ve ücret tahsilatı (X Layer üzerinde) henüz yapılmadı; listeleme kartı{" "}
        <span className="mono text-xs">docs/OKXAI_LISTING.md</span> içinde hazır.
      </section>
    </div>
  );
}
