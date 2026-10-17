# KAHİN Oracle — OKX.AI ASP listeleme kartı (A2MCP)

> Durum: **Servis çalışıyor, listelemeye hazır taslak.** OKX.AI'a gerçek kayıt, staking ve x402 tahsilatı bu hackathon'da **bilinçli olarak yapılmadı** (OKX.AI ödemeleri X Layer'da). Aşağıdaki kayıt adımları resmî dokümana göre hazırlandı; ⚠️ işaretli adımlar kayıt anında doğrulanacak.

## Kimlik
| Alan | Değer |
|---|---|
| Ad | KAHİN Oracle |
| Tek cümle | OKX verisiyle "şu metrik şu anda şu eşiğin üstünde miydi?" sorusuna tekrar üretilebilir, hash'li ve zincirde doğrulanabilir cevap veren oracle. |
| Model | **A2MCP** (çağrı başı). Aynı girdi her zaman aynı çıktıyı verir → pazarlık/escrow gerektiren A2A değil. |
| Sağlayıcı | KAHİN agent'ı (Avalanche Fuji, agent cüzdanı `0x6b3882eD566e21d74Cea2341895F442100e36212`) |
| Veri kaynağı | OKX Agent Trade Kit (ATK) — kapanmış 1 dk mumlar, gerçekleşmiş funding, index mumları (çapraz kontrol) |
| Taşıma | MCP Streamable HTTP (durumsuz) `POST <PUBLIC_BASE_URL>/mcp` · yerel stdio |
| Kaynak kod | https://github.com/Muhammed5500/Kahin (`agent/src/oracle-mcp/server.ts`) |

## Hedef tüketiciler
- **Prediction market'ler ve oyunlar:** marketlerini insan oylaması yerine kanıtlı veriyle çözmek isteyenler.
- **Trading agent'ları:** "stratejim şu dakikada tetiklenmeli miydi?" sorusunu denetlenebilir biçimde cevaplamak; karar kayıtlarını doğrulamak.
- **OKX.AI Evaluator'ları:** bir ASP teslimatındaki fiyat/funding iddialarını bağımsız olarak kontrol etmek.
- **KAHİN'e katılan diğer agent'lar:** açık marketleri görüp kendi cüzdanlarıyla tahmin yapmak.

## Araçlar
| Araç | Girdi | Çıktı | Fiyat (taslak) |
|---|---|---|---|
| `list_templates` | — | Şablonlar, parametre biçimleri, kurallar | ücretsiz |
| `resolve_metric` | `templateId`, `params`, `resolveTime` **veya** `marketId` | `outcome` (YES/NO/VOID), `reason`, `core` (gözlemler, çapraz kontrol, kural), `evidenceHash`, ATK `commands`; `marketId` ile `matchesChain` | **0,01 USDC / çağrı** |
| `get_market` | `marketId` | Durum, havuzlar, önerilen/kesin sonuç, kanıt, kural | ücretsiz |
| `get_forecast` | `marketId` | Agent'ın EVET olasılığı, gerekçesi, kullandığı ATK araçları | 0,005 USDC / çağrı |
| `list_open_markets` | — | Tahmine açık marketler: soru, kural, zamanlar, havuzlar, ima edilen olasılık, agent tahmini | ücretsiz |
| `prepare_bet` | `marketId`, `side` (YES/NO), `amount`, `from?` | İmzalanmamış `approve` + `bet` işlem verisi (chainId 43113); servis anahtar tutmaz | ücretsiz |
| `get_position` | `marketId`, `address` | EVET/HAYIR payları, alınabilir ödül, kUSDC bakiyesi | ücretsiz |
| `prepare_claim` | `marketId`, `address?` | Kesinleşmiş markette imzalanmamış `claim` işlem verisi | ücretsiz |

### Örnek: `resolve_metric` (market #1'in gerçek çözümü)
İstek:
```json
{ "marketId": 1 }
```
Yanıt (kısaltılmış):
```json
{
  "question": "BTC 17/10 13:12'de 81.597,8 $ üstünde mi?",
  "outcome": "NO",
  "evidenceHash": "0x5086180e8432e26a6a7017667e0088272eb558e422b09ffd550669da2e37031e",
  "onchainEvidenceHash": "0x5086180e8432e26a6a7017667e0088272eb558e422b09ffd550669da2e37031e",
  "matchesChain": true,
  "core": {
    "observations": [
      { "role": "primary", "site": "global", "kind": "candle_1m", "instId": "BTC-USDT", "openTimeMs": "1792231860000", "close": "81590.3", "confirm": "1" },
      { "role": "crosscheck", "site": "global", "kind": "index_candle_1m", "instId": "BTC-USD", "openTimeMs": "1792231860000", "close": "81479.2", "confirm": "1" }
    ],
    "crossCheck": { "maxBps": "50", "diffBps": "13", "reference": "81479.2", "ok": "true" },
    "rule": "primary.close > params.thresholdE8"
  },
  "commands": [
    "OKX_SITE=global okx market candles BTC-USDT --bar 1m --after 1792231920000 --limit 1 --json",
    "mcp(global) market_get_index_candles {\"instId\":\"BTC-USD\",\"bar\":\"1m\",\"after\":\"1792231920000\",\"limit\":1}"
  ]
}
```

### Örnek: serbest sorgu
```json
{ "templateId": 2, "params": { "instId": "BTC-USDT-SWAP", "fundingTime": 1792224000 }, "resolveTime": 1792224120 }
```
→ `"BTC perp funding oranı 17/10 11:00 ödemesinde pozitif mi?"` · `YES`

## Dış agent katılımı (uçtan uca kanıtlandı)
KAHİN'e dışarıdan bir agent şu üçlüyle katılır: **KAHİN Oracle MCP** (marketleri gör, işlem hazırla) + **kısıtlı cüzdan MCP'si** (`agent/scripts/agent-wallet-mcp.ts`: yalnız faucet/approve(KAHİN)/bet/claim, tutar tavanlı, anahtar `.env`'den) + istediği veri kaynağı (ör. OKX ATK).

17 Ekim 14:25'te bağımsız bir "rakip agent" (`npm run rival`, ayrı cüzdan `0x175E3076ec6c43ea56bEdf680C8D6a4C808d2DF6`) KAHİN'in %33 tahminini okudu, OKX verisiyle kendi analizini yaptı (EVET ≈ %20–25), market #2'de HAYIR'a 5 kUSDC koydu:
[faucet](https://testnet.snowtrace.io/tx/0xf27b649d99ba90f1ca8f99802b2a6759680865eab5db41632cb31087cefd6b7a) · [onay](https://testnet.snowtrace.io/tx/0xf6f20a4a6791502f7e9699599e2fc0fd848b1a16cf27679b10770bb63305667c) · [tahmin](https://testnet.snowtrace.io/tx/0x46460b6ff6b9415c3a8e771a9e5ceceb5b39311b876fe02c41cd943b150c1040). Agent servisi bu tahmini zincirden izleyip akışa "Dış tahmin" olarak yazdı.

## Bağlanma
Claude Code (stdio):
```bash
claude mcp add --transport stdio kahin-oracle -- npm --prefix <repo>/agent run -s oracle:stdio
```
HTTP (herhangi bir MCP istemcisi): `POST <PUBLIC_BASE_URL>/mcp` (Streamable HTTP, durumsuz, JSON yanıt).
Duman testi: `cd agent && npm run oracle:smoke`

## SLA ve sınırlar
| Konu | Değer |
|---|---|
| Gecikme | `resolve_metric` 1–3 sn (2–3 ATK çağrısı); diğerleri < 300 ms |
| Hız sınırı | IP başına dakikada 30 istek (HTTP) |
| Tekrar üretilebilirlik | Yalnız geçmişte tekrar çekilebilen veri (kapanmış mum, gerçekleşmiş funding) kullanılır; ticker/anlık snapshot kullanılmaz |
| Zaman | `resolveTime` dakikaya hizalı Unix saniye ve en az 1 dk geçmişte olmalı |
| Kapsam | Şablon 1 (PRICE_ABOVE) ve 2 (FUNDING_POSITIVE); izinli enstrümanlar `list_templates`'te |
| Güven varsayımı | Veri kaynağı OKX (tek sağlayıcı); index ile çapraz kontrol; sonuç herkesçe yeniden hesaplanabilir |

## Hata durumları
| Durum | Davranış |
|---|---|
| `resolveTime` gelecekte / hizasız | `isError: true` + açıklama |
| Mum henüz kesinleşmedi / funding kaydı yok | `isError: true` (NotReady mesajı), tekrar dene |
| Çapraz kontrol farkı > 50 bps | `outcome: "VOID"`, `reason: "CROSSCHECK_FAILED"` |
| Market tahmine kapalı (`prepare_bet`) | `isError: true` |
| Hız sınırı | HTTP 429 |

## Güvenlik
- Servis **yalnız okur**: zincire yazmaz, emir vermez, özel anahtar tutmaz.
- `prepare_bet` yalnız imzalanmamış işlem verisi döndürür; imzayı çağıran agent kendi cüzdanıyla atar.
- ATK yalnız `market` modülüyle, anahtarsız çalışır.

## OKX.AI'a kayıt adımları (ürünleşmede)
Kaynaklar: [ASP genel bakış](https://web3.okx.com/onchainos/dev-docs/okxai/asp) · [ASP kaydı](https://web3.okx.com/onchainos/dev-docs/okxai/registerasp) · [A2MCP rehberi](https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp)
1. OnchainOS kurulumu ve Agentic Wallet girişi (`npx -y @okxweb3/onchainos-installer install`).
2. ⚠️ Agent üzerinden ASP olarak kayıt (rol: ASP, model: A2MCP). Kayıt alanları ve ücret/staking koşulları resmî sayfadan doğrulanacak.
3. ⚠️ MCP uç noktasının herkese açık HTTPS adresi ve araç şemalarının tanımlanması.
4. ⚠️ Ücretli araçlar (`resolve_metric`, `get_forecast`) için x402 ödeme yapılandırması — OKX.AI ödemeleri X Layer'da (USDG/USDC/USD₮0) settle edilir.
5. ⚠️ Agent kimliği OKX.AI'da ERC-8004 (X Layer) ile; KAHİN'in Avalanche'taki ERC-8004 kimliği (F10) ile ilişkilendirme.
