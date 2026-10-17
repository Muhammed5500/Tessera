"use client";

import { AGENT_API } from "@/lib/agentApi";

const TOOLS = [
  { name: "list_templates", price: "ücretsiz", desc: "Şablon kataloğu, parametre şemaları ve kurallar." },
  {
    name: "resolve_metric",
    price: "0,01 USDC / çağrı",
    desc: "Bir şablon + parametre + geçmiş zaman için sonucu (EVET/HAYIR/GEÇERSİZ), kanıt çekirdeğini, hash'i ve çalıştırılan ATK komutlarını döndürür. Aynı girdi → aynı hash.",
  },
  { name: "get_market", price: "ücretsiz", desc: "Zincirdeki bir KAHİN marketi, kanıtı ve doğrulama durumu." },
  { name: "get_forecast", price: "0,005 USDC / çağrı", desc: "Agent'ın bir market için olasılık tahmini ve gerekçesi." },
  { name: "list_open_markets", price: "ücretsiz", desc: "Tahmine açık marketler: soru, kural, zamanlar, havuzlar, agent tahmini — diğer agent'lar katılabilsin diye." },
  {
    name: "prepare_bet",
    price: "ücretsiz",
    desc: "İmzalanmamış approve + bet işlem verisi. Servis anahtar tutmaz; çağıran agent kendi cüzdanıyla imzalar.",
  },
  { name: "get_position", price: "ücretsiz", desc: "Bir adresin marketteki EVET/HAYIR payları, alınabilir ödülü ve kUSDC bakiyesi." },
  { name: "prepare_claim", price: "ücretsiz", desc: "Kesinleşmiş markette ödülü almak için imzalanmamış claim işlem verisi." },
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

export default function OraclePage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">KAHİN Oracle</h1>
          <span className="pill pill-open">● servis çalışıyor</span>
          <span className="pill pill-proposed">OKX.AI A2MCP · listelemeye hazır</span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Market çözen motorumuz, başka agent'ların çağırabileceği bir MCP servisi olarak da sunulur: "Bu metrik şu zamanda şu eşiğin üstünde miydi?"
          sorusuna OKX verisiyle, tekrar üretilebilir ve hash'li bir cevap verir. Prediction market'ler, trading agent'ları ve OKX.AI'daki diğer
          servisler için kanıtlı veri katmanı.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs text-muted">Model</div>
          <div className="mt-1 font-semibold">A2MCP (çağrı başı)</div>
          <div className="mt-1 text-xs text-muted">Aynı girdi her zaman aynı çıktıyı verir → pazarlık gerektiren A2A değil.</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">Veri kaynağı</div>
          <div className="mt-1 font-semibold">OKX Agent Trade Kit</div>
          <div className="mt-1 text-xs text-muted">Kapanmış 1 dk mumlar, gerçekleşmiş funding, index çapraz kontrolü.</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-muted">MCP adresi</div>
          <div className="mono mt-1 break-all text-xs">{AGENT_API}/mcp</div>
          <div className="mt-1 text-xs text-muted">Yerel stdio modu da var.</div>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 font-semibold">Araçlar</h2>
        <ul className="space-y-3">
          {TOOLS.map((t) => (
            <li key={t.name} className="flex flex-col gap-1 border-b border-line pb-3 last:border-0 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="mono text-sm text-accent">{t.name}</div>
                <div className="text-xs text-muted">{t.desc}</div>
              </div>
              <span className="pill self-start">{t.price}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">Örnek istek · resolve_metric</h2>
          <pre className="mono overflow-x-auto rounded-lg bg-panel-2 p-3 text-xs">{EXAMPLE_REQ}</pre>
        </div>
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">Örnek yanıt (market #1'in gerçek çözümü)</h2>
          <pre className="mono overflow-x-auto rounded-lg bg-panel-2 p-3 text-xs">{EXAMPLE_RES}</pre>
        </div>
      </div>

      <div className="card space-y-2 p-4">
        <h2 className="font-semibold">Bağlan</h2>
        <div className="text-xs text-muted">Claude Code (stdio):</div>
        <pre className="mono overflow-x-auto rounded-lg bg-panel-2 p-3 text-xs">
          claude mcp add --transport stdio kahin-oracle -- npm --prefix &lt;repo&gt;/agent run -s oracle:stdio
        </pre>
        <div className="text-xs text-muted">Herhangi bir MCP istemcisi (Streamable HTTP, durumsuz):</div>
        <pre className="mono overflow-x-auto rounded-lg bg-panel-2 p-3 text-xs">POST {AGENT_API}/mcp</pre>
        <div className="text-xs text-muted">
          Ayrıntılı listeleme kartı: <span className="mono">docs/OKXAI_LISTING.md</span> · hız sınırı IP başına dakikada 30 istek
        </div>
      </div>

      <div className="card p-4 text-sm">
        <h2 className="mb-2 font-semibold">Bugün yapılan / yapılmayan</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            <span className="text-text">Yapıldı:</span> 6 araçlı MCP servisi (stdio + HTTP), çözüm motoru, tekrar üretilebilir hash (market #1 için zincirle
            eşleştiği test edildi), Claude Code'dan canlı çağrı, araç şemaları ve fiyatlandırma taslağı.
          </li>
          <li>
            <span className="text-text">Bilinçli olarak yapılmadı:</span> OKX.AI'a gerçek ASP kaydı, staking ve x402 tahsilatı (OKX.AI ödemeleri X Layer'da
            çalışıyor). Kayıt adımları hazır; ürünleşmede tamamlanacak.
          </li>
        </ul>
      </div>
    </div>
  );
}
