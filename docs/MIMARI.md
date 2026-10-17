# KAHİN — Mimari Doküman

> **Kanıtlı, agent yönetimli kripto olasılık piyasası.**
> Bir AI agent, OKX Agent Trade Kit (ATK) ile piyasayı okuyup kısa vadeli tahmin marketlerini **kendisi açar**, süre dolunca sonucu ATK verisiyle **kendisi çözer** ve çözümün kanıtını **Avalanche'a** yazar. Herkes bu sonucu OKX'in geçmiş verisiyle **tekrar hesaplayıp doğrulayabilir.** Agent, marketlerde oluşan riskini **OKX TR'de spot işlemle** dengeler.

- Çalışma adı: **KAHİN** (değiştirilebilir)
- Etkinlik: OKX TR × Team1 Türkiye Agentic Hackathon — 17 Ekim 2026, Ankara
- Zincir: **Avalanche Fuji C-Chain** (chainId `43113`)
- Bu doküman *ne* yapılacağını ve *nasıl çalışacağını* anlatır. *Hangi sırayla, kim, ne zaman* → `11_KAHIN_PLAN.md`.
- ⚠️ "Faz 0'da doğrula" diye işaretli her şey kod yazılmadan önce gerçek ATK çıktısıyla kontrol edilecek.

---

## İçindekiler
1. Problem ve çözüm
2. Kapsam: ne var, ne yok
3. Kullanıcılar ve kullanıcı akışları
4. Sistem mimarisi (genel bakış)
5. Soru şablonları (template) — projenin kalbi
6. Akıllı kontratlar
7. Agent servisi (3 rol)
8. ATK entegrasyonu
9. Kanıt (evidence) formatı ve bağımsız doğrulama
10. Web arayüzü
11. Veri akışları (sequence)
12. Güvenlik modeli
13. Hata ve kenar durumları
14. Konfigürasyon ve ortam değişkenleri
15. Repo yapısı ve teknoloji yığını
16. Jüri kriterleriyle eşleşme
17. Demo senaryosu
18. Jüri soruları ve cevapları
19. Bilinçli olarak yapılmayanlar / yol haritası
20. Sözlük

---

## 1. Problem ve çözüm

### 1.1 Problem
1. **Prediction market'lerin en zayıf halkası oracle'dır.** Sonucu kim, hangi veriyle, nasıl belirledi? Popüler platformlarda çözüm insan oylamasıyla geliyor ve tartışma çıkabiliyor.
2. **Kripto marketlerin verisi zaten var**, ama marketi açan ve çözen süreç şeffaf değil; "sonuç doğru mu?" sorusunu kullanıcı kendisi kontrol edemiyor.
3. **OKX TR kullanıcısı türev piyasasını göremiyor.** TR'de yalnız spot var; oysa kısa vadeli fiyatı funding rate ve open interest gibi perp verileri hareket ettiriyor.
4. **Market açmak emek ister.** İlginç ve zamanında soru bulmak, eşik ve süre seçmek, sonra takip edip çözmek sürekli dikkat gerektirir — tam bir agent işi.

### 1.2 Çözüm
- **Agent market açar:** ATK ile global perp verisini ve TR spot verisini tarar, ilginç bir durum görünce sabit bir şablondan market önerir (ör. "OI 1 saatte %6 arttı → BTC 1 saatte %1 düşer mi?"). Gerekçesini Türkçe yazar.
- **Agent marketi çözer (LLM'siz):** Süre dolunca deterministik kod, ATK'dan **geçmişte de çekilebilen** veriyi (kapanmış mum, gerçekleşmiş funding) alır, sonucu hesaplar, kanıt JSON'unun hash'ini zincire yazar.
- **Herkes doğrulayabilir:** Kontrattaki şablon + parametrelerle aynı veriyi OKX'ten çeken bir `verify` komutu aynı sonucu ve aynı hash'i üretir. "Bize güvenmeyin, kontrol edin."
- **İtiraz süresi** vardır; itiraz yoksa sonuç kesinleşir.
- **Agent başlangıç likiditesi koyar** ve oluşan net riskini **OKX TR'de küçük spot işlemlerle** dengeler (hedge) → ATK hem okuma hem işlem için kullanılır.
- **Perp verisi soru olarak** kullanılır; perp ürünü inşa edilmez.

### 1.3 Konumlandırma (sunum dili)
- "Bahis" kelimesi **kullanılmaz** → **olasılık piyasası / tahmin piyasası**.
- Bugün **testnet + test token (kUSDC)**, gerçek para yok.
- Ürün vizyonu: OKX TR hesabıyla doğrulanmış kullanıcılar, puan/itibar tabanlı tahmin ligi; agent'ın oracle hizmeti OKX.AI'da A2MCP servisi olarak satılabilir.
- "OKX'te yok" **denmez**: OKX global'de event contract'lar var (ATK `event` modülü), TR'de yok. Fark: marketleri agent açıyor, perp ve TRY'ye özgü sorular, zincir üstü tekrar hesaplanabilir çözüm.

### 1.4 Hedef kullanıcı, iş modeli, pazara çıkış (jüri: "Innovation & Real-World Value" %25)
**Hedef kullanıcılar (iki taraf):**
1. **Tahminciler (B2C):** OKX TR'deki spot kullanıcısı ve üniversite kripto kulüpleri — kısa vadeli piyasa görüşünü test etmek, perp verisini anlamak isteyen ama kaldıraç kullanmak istemeyen kişi.
2. **Oracle tüketicileri (B2B / agent'lar):** Başka prediction market'ler, trading agent'ları, OKX.AI'daki agent'lar — "şu metrik şu zamanda şu eşiğin üstünde miydi?" sorusunun **kanıtlı** cevabına ihtiyaç duyanlar.

**İş modeli:**
- Çözülen marketlerde havuz ücreti (%1).
- **KAHİN Oracle** servisi: çözüm başına ücretli MCP çağrısı (OKX.AI A2MCP + x402) — §7.7.
- Kurumsal: kendi topluluğu için market ligi açmak isteyen borsalar/topluluklar (beyaz etiket).

**Pazara çıkış (ilk 90 gün):**
1. **Hafta 1–4:** Para yok, **puan tabanlı tahmin ligi** (testnet token) — Team1 Türkiye üniversite ağı (22 üniversite) ve OKX TR topluluğu ile haftalık lig. Yasal risk yok, kullanıcı ve veri birikir.
2. **Ay 2:** KAHİN Oracle'ı OKX.AI'da A2MCP servisi olarak listeleme; ilk B2B tüketici: diğer hackathon agent'ları.
3. **Ay 3:** C-Chain mainnet, stablecoin ile, hukuki görüşe bağlı olarak lisanslı yapı veya yalnız B2B oracle.

---

### 1.5 Neden Avalanche? (jüri: "Uses Avalanche strengths" 5 puan)
- **Hızlı kesinlik (sub-second finality):** 15 dakikalık marketler ancak işlemlerin saniyeler içinde kesinleştiği bir zincirde anlamlı. Tahmin kapanışa saniyeler kala bile güvenle girilir; çözüm ve claim beklemeden tamamlanır. **Arayüz her tx'in onaylanma süresini ölçüp gösterir** (§10).
- **Çok düşük ücret:** Her market için ayrı kanıt hash'i, her çözüm için ayrı tx, agent'ın seed işlemleri — ücret yüksek bir zincirde bu ekonomik olmazdı.
- **Custom L1 + ICM (yol haritası, §19):** Ürün büyüyünce marketler kendi KAHİN L1'inde çalışır, kesinleşmiş sonuçlar **ICM ile C-Chain'e ve diğer L1'lere yayınlanır** → KAHİN, Avalanche ekosistemi için çapraz-L1 bir oracle olur.
- **ERC-8004 (Avalanche'ta canlı):** Agent kimliği ve sicili aynı zincirde (F10).

---

## 2. Kapsam

### 2.1 MVP (bugün mutlaka)
| # | Bileşen |
|---|---|
| M1 | `PredictionMarket.sol` + `MockUSDC.sol` (Fuji'de deploy + Snowtrace verify) |
| M2 | Şablonlar: `PRICE_ABOVE`, `FUNDING_POSITIVE` (çözücü + doğrulayıcı) |
| M3 | Çözücü (Resolver) rolü: otomatik propose + finalize + kanıt |
| M4 | Keşif (Scout) rolü: LLM + ATK MCP + politika → otomatik market açma + başlangıç likiditesi |
| M5 | Web: market listesi, detay, tahmin (bet), claim, kanıt kartı, agent akışı, faucet |
| M6 | `verify` komutu (bağımsız doğrulama) |
| M7 | **KAHİN Oracle MCP servisi** + OKX.AI ASP listeleme taslağı (§7.7) — jüri: "Could be listed as a service on OKX.AI" (5 puan) |
| M8 | Tx onay süresi ölçümü ve gösterimi (Avalanche hızlı kesinlik kanıtı, §1.5) |

### 2.2 Bonus (zaman kalırsa, sırayla)
| # | Bileşen | Neden |
|---|---|---|
| B1 | Hedger rolü: OKX TR'de spot hedge | Resmî etkinlik sayfasındaki Bonus 1 (ATK ile gerçek işlem). Jüri tablosunda ayrı puanı yok → M7'den sonra |
| B2 | Ek şablonlar: `PRICE_MOVE`, `OI_CHANGE`, `TRY_PREMIUM_ABOVE` | Çeşitlilik, demo zenginliği |
| B3 | ERC-8004 agent kimliği (Fuji Identity Registry) | Avalanche hikâyesi |
| B4 | Mühürlü (gizli yönlü) tahmin modu | Plan dosyasının son fazı, "duruma göre" |

### 2.3 Kapsam dışı (bilinçli)
- Perp / kaldıraç / likidasyon motoru
- AMM/LMSR fiyatlama (parimutuel yeterli)
- Kripto dışı olaylar (seçim, maç) — ATK ile çözülemez
- Haber/sentiment tabanlı marketler — tekrar üretilebilirlik garanti değil
- Gerçek para, mainnet, KYC
- Çoklu (ikiden fazla seçenekli) marketler → yol haritası

---

## 3. Kullanıcılar ve akışlar

### 3.1 Aktörler
| Aktör | Kim | Yetki |
|---|---|---|
| **Kullanıcı (Tahminci)** | Siteye gelen herkes (jüri dahil) | Faucet, bet, claim, dispute |
| **Agent** | Bizim agent servisinin Fuji cüzdanı | `createMarket`, `proposeResolution`, kendi adına bet (seed) |
| **Owner / Komite** | Deployer cüzdanı (demo: tek adres; ürün: multisig) | Agent adresini ayarlama, itirazı karara bağlama, parametreler, pause |
| **Doğrulayıcı** | Herhangi biri | `verify` komutunu çalıştırır, gerekirse dispute açar |
| **Hazine** | Owner'ın belirlediği adres | Protokol ücretini alır |

### 3.2 Kullanıcı akışı (mutlu yol)
1. Siteye girer → **Cüzdan bağla** (Core / MetaMask) → yanlış ağdaysa "Fuji'ye geç" butonu.
2. **"Test kUSDC al"** → faucet (adres başına saatte 1000 kUSDC).
3. **Marketler** sayfası: açık marketler; her kartta soru, kalan süre, YES/NO havuzları ve ima edilen olasılık, **agent'ın tahmini (%)**.
4. Market detayı: soru, kurallar (hangi veri, hangi dakika, hangi eşik), agent'ın gerekçesi + hangi ATK araçlarını çağırdığı, havuzlar.
5. **YES veya NO** seç → tutar gir → `approve` + `bet` (2 tx; ilk seferde approve sonsuz değil, tutar kadar).
6. `closeTime` gelince bet kapanır, kart "Çözüm bekleniyor" olur.
7. `resolveTime` sonrası agent sonucu önerir → kart "Önerildi · itiraz süresi 4:59" + **kanıt kartı**.
8. Süre dolunca finalize → kazanansa **Claim** butonu.

### 3.3 İtiraz akışı
1. Kullanıcı kanıt kartındaki "Kendin doğrula" komutunu çalıştırır veya sonucu yanlış bulur.
2. `dispute` (teminat: 10 kUSDC) → market `DISPUTED`.
3. Owner/komite `resolveDispute(id, outcome)` ile karar verir. Agent'ın önerisi bozulursa teminat iade, bozulmazsa teminat hazineye.

### 3.4 Agent akışı (özet — ayrıntı §7)
- Her 10 dk: piyasayı tara → (gerekirse) market öner → politika → `createMarket` → seed likidite.
- Her 30 sn: vadesi gelen marketleri çöz → kanıt → `proposeResolution` → süre dolanları `finalize`.
- (Bonus) Her 5 dk: net riski hesapla → OKX TR'de küçük spot hedge.

---

## 4. Sistem mimarisi

```
┌──────────────────────────────── OKX ─────────────────────────────────┐
│   OKX Global (anahtarsız okuma)            OKX TR (spot, TRY)         │
│   perp: funding, OI, mark; spot mumları    mumlar, emir defteri,      │
│   index mumları                            spot emir (hedge)          │
└──────────────▲───────────────────────────────────────▲──────────────┘
               │ ATK MCP (stdio)  /  ATK CLI (--json)  │
┌──────────────┴───────────────────────────────────────┴──────────────┐
│                       AGENT SERVİSİ  (Node 20 + TypeScript)           │
│                                                                       │
│  ┌───────────────┐   ┌────────────────┐   ┌──────────────────────┐    │
│  │ SCOUT         │   │ RESOLVER       │   │ HEDGER (bonus)       │    │
│  │ Claude + MCP  │   │ deterministik  │   │ deterministik        │    │
│  │ market önerir │   │ sonucu hesaplar│   │ OKX TR spot hedge    │    │
│  └──────┬────────┘   └───────┬────────┘   └──────────┬───────────┘    │
│         ▼                    ▼                       ▼                │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ POLICY (sınırlar)  ·  TEMPLATES (şema + resolve fn)          │     │
│  │ EVIDENCE STORE (JSON + keccak)  ·  FEED STORE (olay akışı)   │     │
│  │ ATK ADAPTER (mcp-client / cli)  ·  CHAIN CLIENT (viem)       │     │
│  └─────────────────────────────────────────────────────────────┘     │
│  HTTP API (Fastify): /api/feed /api/stream /api/markets/:id/meta      │
│                      /evidence/:id.json /api/stats /health            │
└──────────────────────────────┬────────────────────────────────────────┘
                               │ tx (agent cüzdanı)          ▲ okuma
┌──────────────────────────────▼─────────────────────────────┴─────────┐
│                 AVALANCHE FUJI C-CHAIN (43113)                        │
│   PredictionMarket.sol      MockUSDC.sol      (ERC-8004 Identity)     │
└──────────────────────────────▲────────────────────────────────────────┘
                               │ wagmi/viem (kullanıcı cüzdanı)
┌──────────────────────────────┴────────────────────────────────────────┐
│     WEB (Next.js, Vercel)                                             │
│     /  marketler · /market/[id] · /agent (canlı akış) · /verify       │
│     Zincirden: market durumu, havuzlar     Agent API'den: gerekçe,    │
│                                            kanıt, akış, istatistik    │
└───────────────────────────────────────────────────────────────────────┘
       CLI: `npm run verify -- <marketId>` → bağımsız doğrulama
```

**Doğruluk kaynağı (source of truth):**
- Paralar, market durumu, sonuç, kanıt hash'i → **zincir**.
- Gerekçe metni, araç çağrı izi, ham kanıt JSON'u → **agent servisi** (hash'i zincirde olduğu için değiştirilemez; değiştirilirse hash tutmaz).

**Çalışma ortamı (hackathon günü):** Agent servisi dizüstü bilgisayarda çalışır. Web Vercel'de. Web'in agent API'sine ulaşması için **Cloudflare quick tunnel** (`cloudflared tunnel --url http://localhost:8787`) — URL web'e env olarak verilir. Tünel düşerse web yine zincirden market/havuz/sonuç gösterir; yalnız gerekçe/akış eksik kalır (zarif bozulma).

---

## 5. Soru şablonları (projenin kalbi)

### 5.1 İlke
- LLM **serbest soru yazamaz**. Yalnız kayıtlı bir şablonu ve parametrelerini seçer.
- Her şablonun kodda üç parçası vardır: **parametre şeması** (zod), **soru metni üretici** (TR), **resolve fonksiyonu** (deterministik).
- Şablon kimliği + ABI-kodlu parametreler market açılırken **zincire yazılır** → kural sonradan değiştirilemez.
- Çözüm yalnız **geçmişte tekrar çekilebilen** veriyle yapılır: kapanmış (confirm=1) mumlar, gerçekleşmiş funding kayıtları, OI geçmişi. **Ticker / anlık snapshot ile çözüm yapılmaz.**

### 5.2 Ortak zaman kuralları
- Tüm zamanlar **Unix saniye, UTC**, dakikaya hizalı (`% 60 == 0`).
- `closeTime < resolveTime`, aradaki fark **≥ 120 sn** (kontrat zorlar).
- "t anındaki fiyat" = açılış zamanı `t − 60` olan **1 dakikalık mumun kapanışı** (`close`), mum `confirm == "1"` olmalı.
- Çözüm, `resolveTime + RESOLVE_DELAY` (varsayılan 90 sn) sonrasında yapılır ki mum kesinleşsin.

### 5.3 Şablon tablosu

| ID | Ad | Parametreler (ABI) | Kural | Veri (ATK) | Faz |
|---:|---|---|---|---|---|
| 1 | `PRICE_ABOVE` | `(string site, string instId, int256 thresholdE8)` | `close(resolveTime) > threshold` → YES, aksi NO | `market_get_candles` bar=1m | MVP |
| 2 | `FUNDING_POSITIVE` | `(string instId, uint64 fundingTime)` | `fundingTime` kaydının oranı `> 0` → YES | `market_get_funding_rate` history | MVP |
| 3 | `PRICE_MOVE` | `(string site, string instId, int256 moveBps, uint32 windowSec)` | `r = (close(T) − close(T−w)) / close(T−w)`; moveBps>0 ise `r ≥ moveBps`, <0 ise `r ≤ moveBps` → YES | `market_get_candles` | Bonus |
| 4 | `OI_CHANGE` | `(string instId, int256 changeBps, uint32 windowSec)` | OI(T) / OI(T−w) − 1 eşik karşılaştırması | `market_get_oi_history` | Bonus |
| 5 | `TRY_PREMIUM_ABOVE` | `(int256 thresholdBps)` | `prem = BTC-TRY / (BTC-USDT × USDT-TRY) − 1` (aynı dakika, site=tr) `> threshold` → YES | `market_get_candles` ×3 | Bonus |

Sayısal gösterim: fiyatlar `×1e8` tam sayı (`thresholdE8`), yüzdeler **baz puan** (bps, 1% = 100). Karşılaştırmalar kodda `BigInt`/decimal string ile yapılır, `float` kullanılmaz.

### 5.4 Çapraz kontrol (sanity check)
- `PRICE_*` şablonlarında birincil kaynak mumuna ek olarak **ikinci kaynak** çekilir: aynı dakikanın **index mumu** (`market_get_index_candles`, ör. `BTC-USD`), **MCP üzerinden** (CLI `after` desteklemiyor — §8.4a). TR ve global aynı emir defterini paylaştığı için diğer site ikinci kaynak sayılmaz. `*-TRY` paritelerinde index karşılığı yoksa çapraz kontrol `USDT-TRY × BTC-USDT` ile yapılır.
- `|birincil − ikinci| / ikinci > CROSSCHECK_MAX_BPS` (varsayılan 50 bps) → **VOID önerilir** (veri şüpheli).
- Çapraz kontrol sonucu kanıta yazılır.

### 5.5 Örnek şablon yaşam döngüsü (`PRICE_ABOVE`)
1. Scout: "BTC 18:30 UTC+3'te 105.000 $ üstünde mi?" önerir → `site=global, instId=BTC-USDT, thresholdE8=10500000000000`, `closeTime=18:15`, `resolveTime=18:30` (UTC'ye çevrilmiş).
2. 18:31:30'da Resolver: `market_get_candles BTC-USDT bar=1m` → açılışı 18:29 olan mumu bulur, `confirm=1`, `close="105231.4"`.
3. Çapraz kontrol: `BTC-USD` index mumu aynı dakika `105198.0` → fark 3 bps → OK.
4. `105231.4 > 105000` → **YES**. Kanıt → hash → `proposeResolution(id, YES, hash, uri)`.

---

## 6. Akıllı kontratlar

### 6.1 `MockUSDC.sol`
- ERC-20 (OpenZeppelin), ad "KAHIN Test USD", sembol `kUSDC`, **6 decimals**.
- `faucet()`: çağırana 1000 kUSDC mint; adres başına `FAUCET_COOLDOWN = 1 saat`.
- `mint(to, amt)`: yalnız owner (agent'ı fonlamak için).
- Açıkça "test token, değeri yok" yorumu.

### 6.2 `PredictionMarket.sol` — veri modeli
```solidity
enum Status  { Active, Proposed, Disputed, Finalized }
enum Outcome { Unresolved, Yes, No, Void }

struct Market {
    uint8   templateId;
    bytes   params;          // abi.encode(...) şablona göre
    string  question;        // TR insan metni
    string  metadataURI;     // agent API: gerekçe + araç izi (hash'lenmez)
    uint64  createdAt;
    uint64  closeTime;
    uint64  resolveTime;
    uint64  proposedAt;
    Status  status;
    Outcome proposedOutcome;
    Outcome finalOutcome;
    uint256 yesPool;
    uint256 noPool;
    uint256 fee;             // finalize'da hazineye giden ücret (claim hesabı için saklanır)
    bytes32 evidenceHash;
    string  evidenceURI;
    address disputer;
    // (Gizlilik fazı için: bool sealed; — bkz. plan, son faz)
}

mapping(uint256 => Market) public markets;
mapping(uint256 => mapping(address => uint256)) public yesStake;
mapping(uint256 => mapping(address => uint256)) public noStake;
mapping(uint256 => mapping(address => bool))    public claimed;
uint256 public marketCount;
```

### 6.3 Parametreler (owner ayarlayabilir)
| Ad | Varsayılan | Açıklama |
|---|---|---|
| `agent` | deploy'da verilir | market açıp çözebilen adres |
| `treasury` | owner | ücretin gittiği adres |
| `feeBps` | 100 (%1) | YES/NO ile çözülen markette toplam havuzdan |
| `disputeWindow` | 300 sn | demo için kısa; ürün: saatler |
| `disputeBond` | 10 kUSDC | itiraz teminatı |
| `minBet` | 1 kUSDC | |
| `minResolveGap` | 120 sn | `resolveTime − closeTime` alt sınırı |
| `proposeDeadline` | 2 saat | `resolveTime`'dan sonra bu süre içinde öneri yoksa herkes `voidStale` çağırabilir |

### 6.4 Fonksiyonlar
```solidity
// Agent
function createMarket(uint8 templateId, bytes calldata params, string calldata question,
                      string calldata metadataURI, uint64 closeTime, uint64 resolveTime)
    external onlyAgent whenNotPaused returns (uint256 id);
function proposeResolution(uint256 id, Outcome o, bytes32 evidenceHash, string calldata evidenceURI)
    external onlyAgent;

// Kullanıcı
function bet(uint256 id, bool yes, uint256 amount) external whenNotPaused;
function dispute(uint256 id) external;           // teminat çeker
function finalize(uint256 id) external;          // herkes
function claim(uint256 id) external;             // herkes (kendi payı)
function voidStale(uint256 id) external;         // herkes, proposeDeadline aşıldıysa

// Owner / komite
function resolveDispute(uint256 id, Outcome o) external onlyOwner;
function setAgent(address) external onlyOwner;
function setParams(...) external onlyOwner;
function pause() / unpause() external onlyOwner;

// View
function getMarket(uint256 id) external view returns (Market memory);
function getPosition(uint256 id, address user) external view returns (uint256 yes, uint256 no, bool claimed);
function previewPayout(uint256 id, address user) external view returns (uint256);
```

### 6.5 Kurallar ve invariant'lar
- `createMarket`: `closeTime > now`, `resolveTime ≥ closeTime + minResolveGap`, `templateId` kayıtlı (1–5), `params.length > 0`.
- `bet`: `status == Active` ve `now < closeTime`; `amount ≥ minBet`; `transferFrom`.
- `proposeResolution`: `status == Active`, `now ≥ resolveTime`, `o ∈ {Yes, No, Void}`.
- `dispute`: `status == Proposed`, `now < proposedAt + disputeWindow`; bond `transferFrom`.
- `finalize`: `status == Proposed` ve `now ≥ proposedAt + disputeWindow`.
  - `o == Yes && yesPool == 0` veya `o == No && noPool == 0` → **Void**.
  - `yesPool == 0 || noPool == 0` (tek taraflı market) → **Void**.
  - Yes/No ise `fee = (yesPool + noPool) * feeBps / 10000` → treasury.
- `claim`:
  - Void → `yesStake + noStake` iade.
  - Yes → `payout = yesStake * (total − fee) / yesPool`. No simetrik.
  - Çift claim yok; Checks-Effects-Interactions; `ReentrancyGuard`.
- `resolveDispute`: `status == Disputed`; sonuç ≠ önerilen ise bond disputer'a iade, aynıysa bond treasury'ye.
- **Invariant:** Kontrattaki kUSDC ≥ tüm claim edilmemiş paylar + bekleyen teminatlar. Yuvarlama tozu kontratta kalır.

### 6.6 Event'ler (web ve agent bunları dinler)
```solidity
event MarketCreated(uint256 indexed id, uint8 templateId, bytes params, string question,
                    string metadataURI, uint64 closeTime, uint64 resolveTime);
event BetPlaced(uint256 indexed id, address indexed user, bool yes, uint256 amount);
event ResolutionProposed(uint256 indexed id, Outcome outcome, bytes32 evidenceHash, string evidenceURI);
event Disputed(uint256 indexed id, address indexed disputer);
event DisputeResolved(uint256 indexed id, Outcome outcome, bool bondRefunded);
event Finalized(uint256 indexed id, Outcome outcome, uint256 fee);
event Claimed(uint256 indexed id, address indexed user, uint256 amount);
```

### 6.7 Testler (Foundry) — kabul için zorunlu
1. Mutlu yol: create → iki kullanıcı bet → propose Yes → finalize → kazanan doğru tutarı claim eder, kaybeden 0.
2. Tek taraflı market → Void → iade.
3. Önerilen kazanan taraf boş → Void.
4. `closeTime` sonrası bet revert.
5. `resolveTime` öncesi propose revert; agent dışı propose revert.
6. Dispute → resolveDispute (bozma ve onaylama) → bond doğru yere.
7. Çift claim revert.
8. `voidStale` deadline sonrası.
9. Ücret hesabı ve yuvarlama (fuzz: rastgele 3–5 kullanıcı, toplam ödenen ≤ havuz − fee).
10. Pause.

### 6.8 Deploy
- Foundry script: `MockUSDC` → `PredictionMarket(usdc, agent, treasury)` → agent'a 10.000 kUSDC mint.
- `forge verify-contract` ile Snowtrace (Routescan) doğrulaması.
- Adresler `deployments/fuji.json`'a yazılır; web ve agent buradan okur.

---

## 7. Agent servisi

### 7.1 Genel
- Node 20, TypeScript (ESM), tek süreç; üç döngü (`setInterval` + kilit) + HTTP sunucusu.
- Ortak modüller: `atk/` (MCP istemcisi + CLI sarmalayıcı), `chain/` (viem client + ABI), `templates/`, `policy/`, `evidence/`, `feed/` (JSON dosya tabanlı olay deposu), `server/`.
- Her döngünün **tek seferlik çalıştırma** komutu da vardır (`npm run scout:once`, `resolver:once`) → demo ve test için.
- `DRY_RUN=1` → zincire tx göndermez, ne göndereceğini loglar.

### 7.2 Rol 1 — SCOUT (market yaratıcı, LLM'li)

**Amaç:** Piyasada "şu an sorulmaya değer" bir durumu bulup şablonlu bir market önermek ve gerekçesini yazmak. Otonomi puanının kalbi.

**Döngü (her `SCOUT_INTERVAL_SEC`, varsayılan 600):**
1. Açık market sayısı `MAX_OPEN_MARKETS` (6) ise atla.
2. Claude'a sistem promptu + bağlam (şu anki UTC zamanı, açık marketlerin özeti, izinli enstrümanlar, şablon kataloğu) verilir.
3. Claude'un kullanabildiği araçlar:
   - **ATK MCP araçları (yalnız okuma, allowlist):** global sunucudan `market_get_ticker`, `market_get_candles`, `market_get_funding_rate`, `market_get_oi_history`, `market_filter_oi_change`, `market_get_indicator`, `market_get_mark_price`; TR sunucusundan `market_get_ticker`, `market_get_candles`, `market_get_orderbook`. Araç adları çakışmasın diye `global__` / `tr__` öneki.
   - **Bizim araçlarımız:** `list_open_markets()`, `propose_market({...})` (JSON şemalı; aşağıda).
4. Araç döngüsü en fazla `SCOUT_MAX_STEPS` (12) adım; Claude ya `propose_market` çağırır ya da "şu an uygun market yok" der (bu da geçerli bir sonuçtur ve akışa yazılır).
5. `propose_market` girdisi **Policy**'den geçer (§7.5). Ret → sebebiyle akışa yazılır; Claude'a bir kez düzeltme şansı verilir.
6. Kabul → `createMarket` tx → `MarketCreated` → **seed likidite**: agent, kendi olasılık tahmini `p`'ye göre `SEED_TOTAL` (20 kUSDC) tutarı YES'e `p`, NO'ya `1−p` oranında bet eder (her iki taraf en az 2 kUSDC).
7. Akışa kayıt: gerekçe, `myProbability`, araç çağrı izi (araç adı, argümanlar, süre, özet sonuç), tx hash.

**`propose_market` şeması:**
```json
{
  "templateId": 1,
  "params": { "site": "global", "instId": "BTC-USDT", "threshold": "105000" },
  "closeInMinutes": 45,
  "resolveInMinutes": 60,
  "myProbability": 0.41,
  "rationale_tr": "OI son 1 saatte %6 arttı, funding %0,03'e çıktı; kalabalık long birikiyor...",
  "evidence_tools_used": ["global__market_filter_oi_change", "global__market_get_funding_rate"]
}
```
Agent kodu soru metnini **şablondan üretir** (LLM'in metni kullanılmaz) → soru her zaman kuralla birebir aynı.

**Sistem promptu (özet; tam metin `agent/src/scout/prompt.ts`):**
- Rolün: kısa vadeli, ölçülebilir, ilginç kripto tahmin marketleri açan bir piyasa analisti.
- Yalnız şablon kataloğundaki şablonları kullan; eşik ve süreyi veriye dayandır; olasılığı %15–85 arasında olacak şekilde ilginç seç (çok kesin sonuçlu market açma).
- Her öneride en az 2 farklı ATK aracından veri kullan ve gerekçede sayılarla belirt.
- Fiyat tahmini / yatırım tavsiyesi dili kullanma; "soru soruyorsun".
- Emir verme, hesap verisi okuma yok (zaten araç yok).

**Model:** `AGENT_MODEL` env (varsayılan `claude-opus-5-5`, effort `SCOUT_EFFORT=medium`); reddetme durumunda `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Token bütçesi döngü başına sınırlı; MCP araç şemaları allowlist ile küçültülür (ATK'nın tüm şemaları ~50k token tutuyor).

### 7.3 Rol 2 — RESOLVER (oracle, LLM'SİZ)

**Amaç:** Vadesi gelen marketleri deterministik, tekrar üretilebilir şekilde çözmek.

**Döngü (her `RESOLVER_INTERVAL_SEC`, varsayılan 30):**
1. Zincirden `Active` ve `now ≥ resolveTime + RESOLVE_DELAY` olan marketleri bul.
2. `templateId` + `params` decode → ilgili şablonun `resolve()` fonksiyonu.
3. `resolve()` ATK **CLI**'yı `--json` ile çağırır (MCP değil; CLI daha basit ve tekrar edilebilir — aynı komut kanıta yazılır).
4. Veri yok / mum kesinleşmemiş → bekle, tekrar dene (`MAX_RESOLVE_RETRIES` = 10). `proposeDeadline`'a 10 dk kala hâlâ yoksa → **Void** öner (sebep: `DATA_UNAVAILABLE`).
5. Çapraz kontrol başarısız → **Void** (`CROSSCHECK_FAILED`).
6. Kanıt JSON'u oluştur (§9) → `evidenceHash = keccak256(canonical(core))` → dosyaya yaz → `proposeResolution`.
7. Ayrıca `Proposed` ve süresi dolmuş marketler için `finalize` çağır (herkes çağırabilir; agent nezaketen yapar).

**Neden LLM yok?** Sonucu bir dil modelinin yorumuna bırakmak oracle'ı halüsinasyona ve prompt manipülasyonuna açar. *LLM soruyu sorar, kod sonucu okur.* Bu ayrım sunumda açıkça anlatılır.

### 7.4 Rol 3 — HEDGER (bonus, OKX TR'de gerçek işlem)

**Amaç:** Agent'ın seed likiditesinden doğan yönsel riski OKX TR spot piyasasında küçük işlemlerle dengelemek. ATK'yı **işlem** için kullanmak (etkinlik Bonus 1) ve OKX TR'de gerçek hacim yaratmak.

**Basit ve dürüst model:**
- Yalnız BTC fiyat şablonları (1 ve 3) dikkate alınır.
- Agent'ın her markette net pozisyonu: `net = agentYesStake − agentNoStake` (kUSDC).
- "Yukarı" yönlü marketler (PRICE_ABOVE, pozitif PRICE_MOVE) için `exposureUp += net`, aşağı yönlüler için `exposureUp −= net`.
- Hedef hedge (USDT cinsinden): `target = −HEDGE_RATIO × exposureUp` (ör. 0,2), `|target| ≤ HEDGE_MAX_NOTIONAL` (ör. 20 USDT).
- Mevcut hedge pozisyonu ile fark `HEDGE_MIN_STEP`'ten (5 USDT) büyükse OKX TR'de **spot** market/limit emir (`okx spot place --instId BTC-USDT ...`; TR'de BTC-USDT yoksa BTC-TRY) — ⚠️ Faz 0'da TR enstrümanını ve CLI sözdizimini doğrula.
- Spot'ta açığa satış yok → "aşağı" hedge ancak elde BTC varsa satış olarak yapılır; yoksa atlanır ve bu durum akışa yazılır.
- Her emirden önce: `account_get_trade_fee` + emir defteri ile tahmini maliyet → akışa "hedge maliyeti" olarak yazılır.
- Tüm emirler kod tarafından, sabit tavanlarla; LLM'in emir yetkisi **yoktur**.
- Bu bir "tam risk nötrleme" değil, **gösterilebilir bir risk yönetimi döngüsüdür**; sunumda böyle anlatılır.

### 7.5 POLICY (kod, LLM değil)
| Kural | Değer |
|---|---|
| İzinli şablonlar | MVP: 1, 2 · Bonus fazından sonra: 1–5 |
| İzinli enstrümanlar | `BTC-USDT`, `ETH-USDT`, `AVAX-USDT` (global/tr) · perp: `BTC-USDT-SWAP`, `ETH-USDT-SWAP` · TR: `BTC-TRY`, `USDT-TRY` |
| Market süresi (create→resolve) | 15 dk – 3 saat |
| `resolveTime − closeTime` | 5 – 15 dk |
| Aynı anda açık market | ≤ 6 |
| Aynı şablon + enstrüman + ±%1 eşik tekrarı | yasak |
| `PRICE_ABOVE` eşiği | anlık fiyatın ±%3'ü içinde |
| `myProbability` | 0,15 – 0,85 |
| Seed toplamı | 20 kUSDC / market, agent bakiyesi < 200 ise seed yok |
| Hedge | yalnız `HEDGE_ENABLED=1`, tavanlar §7.4 |
| Kill switch | `PAUSE_AGENT=1` dosyası/env → tüm döngüler durur; kontratta `pause()` |

### 7.6 HTTP API (Fastify, port 8787)
| Endpoint | Döner |
|---|---|
| `GET /health` | `{ok, chainId, contract, agentAddress, loops:{scout,resolver,hedger}}` |
| `GET /api/feed?limit=50` | Akış olayları (market açıldı, öneri reddedildi, çözüldü, hedge, hata) |
| `GET /api/stream` | SSE: yeni akış olayları |
| `GET /api/markets/:id/meta` | gerekçe, myProbability, araç izi (metadataURI buraya işaret eder) |
| `GET /evidence/:id.json` | kanıt JSON'u (evidenceURI buraya işaret eder) |
| `GET /api/stats` | ATK çağrı sayıları (araç bazında), açılan/çözülen market sayısı, hedge hacmi |

CORS: yalnız web domain'i + localhost.

### 7.7 KAHİN Oracle — MCP servisi (OKX.AI'da listelenebilir)
**Amaç:** Resolver'ın deterministik çözüm motorunu **başka agent'ların çağırabileceği bir hizmete** çevirmek. Jüri tablosundaki "Could be listed as a service on OKX.AI" maddesinin somut karşılığı. Resolver kodu yeniden kullanıldığı için ek iş küçük.

**Model:** OKX.AI ASP modellerinden **A2MCP** (standart, çağrı başı; aynı girdiye her zaman aynı çıktı). A2A değil — çünkü her çağrı tekrarlanabilir bir hesaplama, pazarlık gerektiren özel bir iş değil.

**Taşıma:** `@modelcontextprotocol/sdk` ile **Streamable HTTP** MCP sunucusu, agent servisinde `/mcp` yolunda (aynı tünel URL'si). Yerel test için stdio modu da.

**Araçlar:**
| Araç | Girdi | Çıktı | Ücret (taslak) |
|---|---|---|---|
| `list_templates` | — | şablon kataloğu, parametre şemaları, kurallar | ücretsiz |
| `resolve_metric` | `templateId`, `params`, `resolveTime` (geçmiş bir an) | `outcome`, `evidence.core`, `evidenceHash`, kullanılan ATK komutları | **0,01 USDC / çağrı** |
| `get_market` | `marketId` | zincirdeki market + kanıt + doğrulama durumu | ücretsiz |
| `get_forecast` | `marketId` | agent'ın olasılık tahmini + gerekçesi | 0,005 USDC / çağrı |
| `list_open_markets` | — | tahmine açık marketler (soru, kural, zamanlar, havuzlar, agent tahmini) — diğer agent'ların katılımı için | ücretsiz |
| `prepare_bet` | `marketId`, `side`, `amount` | imzalanmamış `approve` + `bet` işlem verisi; çağıran agent kendi cüzdanıyla imzalar (servis anahtar tutmaz) | ücretsiz |

| `get_position` | `marketId`, `address` | pozisyon, alınabilir ödül, bakiye | ücretsiz |
| `prepare_claim` | `marketId` | imzalanmamış `claim` işlem verisi | ücretsiz |

**Dış agent katılımı:** Oracle MCP + kısıtlı cüzdan MCP'si (`agent/scripts/agent-wallet-mcp.ts`; yalnız faucet / approve(KAHİN) / bet / claim, tutar tavanlı, sabit gas, anahtar `.env`'den) + istediği veri kaynağı. Örnek: `npm run rival` (Claude Code + 3 MCP; market #2'de gerçek tahmin yaptı). Agent servisi `BetPlaced` olaylarını izleyip (`src/chain/watch.ts`) agent dışı tahminleri akışa yazar.

> Kontrat `bet`/`claim` fonksiyonlarında insan ile agent'ı ayırt etmez; bu iki araç başka agent'ların KAHİN marketlerine katılmasını kolaylaştırır. Uygulama: `agent/src/oracle-mcp/server.ts`; test: `npm run oracle:smoke`.

**Bugün yapılan / yapılmayan (sunumda dürüstçe):**
- ✅ Çalışan MCP sunucusu; Claude Code'a bağlanıp `resolve_metric` çağrılarak canlı gösterilir.
- ✅ **ASP listeleme kartı** (`docs/OKXAI_LISTING.md` + web'de "Oracle servisi" bölümü): ad, açıklama, araçlar, girdi/çıktı şemaları, fiyat, SLA, hata durumları.
- ❌ OKX.AI'a gerçek kayıt / staking / x402 tahsilatı **yapılmaz** (OKX.AI ödemeleri X Layer'da; kayıt dış sistem eylemi). "Listelenmeye hazır, kayıt adımları şunlar" olarak anlatılır.

**Güvenlik:** Yalnız okuma; zincire yazmaz, emir vermez. Rate limit (IP başı dakikada 30). `resolveTime` gelecekteyse hata döner.

---

## 8. ATK entegrasyonu

### 8.1 Kurulum
```bash
npm install -g @okx_ai/okx-trade-mcp @okx_ai/okx-trade-cli   # Node 18+
okx --version
```
(postinstall sorunu olursa `--ignore-scripts` ile kur; CLI bu şekilde de çalışıyor.)

### 8.2 İki hat
| Hat | Nasıl | Modüller | Anahtar | Kim kullanır |
|---|---|---|---|---|
| **Global okuma** | MCP: `okx-trade-mcp --site global --modules market` · CLI: `OKX_SITE=global okx market ... --json` | market | yok | Scout, Resolver |
| **TR okuma** | MCP: `okx-trade-mcp --site tr --modules market` · CLI: `OKX_SITE=tr ...` | market | yok | Scout, Resolver |
| **TR işlem** | CLI: `OKX_SITE=tr okx spot ... --json` (profil: yarışma hesabı) | spot, account | `~/.okx/config.toml` | Yalnız Hedger (kod) |

- Scout, ATK'yı **gerçek MCP** olarak kullanır: `@modelcontextprotocol/sdk` `StdioClientTransport` ile iki `okx-trade-mcp` süreci başlatılır, araç listesi allowlist'e göre filtrelenip Claude'a verilir.
- Resolver ve Hedger **CLI** kullanır: tekrar edilebilir komut, kanıta birebir yazılabilir.
- **Tüm ATK çağrıları** tek bir adapter'dan geçer → sayaç (`/api/stats`) ve araç izi. Jüriye "X MCP çağrısı, Y farklı araç" gösterilir.

### 8.3 Kullanılan ATK araçları (beklenen)
| Araç | Kim | Amaç |
|---|---|---|
| `market_get_candles` | Scout, Resolver | trend + **çözüm verisi** |
| `market_get_index_candles` | Resolver | çapraz kontrol |
| `market_get_funding_rate` | Scout, Resolver | funding marketleri |
| `market_get_oi_history`, `market_filter_oi_change` | Scout, Resolver | OI marketleri, fırsat tarama |
| `market_get_indicator` | Scout | RSI/BB vb. bağlam |
| `market_get_ticker`, `market_get_mark_price` | Scout | anlık durum (çözümde kullanılmaz) |
| `market_get_orderbook` | Scout, Hedger | TR likidite / hedge maliyeti |
| `account_get_trade_fee`, `account_get_balance` | Hedger | maliyet, bakiye |
| `spot_place_order` | Hedger | **gerçek işlem** |

### 8.4a Faz 0 sonuçları (17 Ekim 2026, 12:15 — ATK 1.4.8) ✅
| # | Konu | Sonuç | Mimariye etkisi |
|---|---|---|---|
| 1 | Belirli dakikanın mumu | ✅ `OKX_SITE=global okx market candles BTC-USDT --bar 1m --after <T+60000> --limit 1 --json` (bayrak CLI yardımında yazmıyor ama kaynakta var). 2 gün önceki dakika da çekilebiliyor. Satır formatı: `[openTimeMs, o, h, l, c, vol, volCcy, volQuote, confirm]` | §5.2 kuralı aynen uygulanır; ATK zamanları **ms**, kontrat **saniye** → dönüşüm adapter'da |
| 2 | Funding geçmişi | ✅ `okx market funding-rate BTC-USDT-SWAP --history --json` → `fundingTime` (ms), `realizedRate` (gerçekleşmiş oran). **BTC/ETH/SOL/AVAX/DOGE perp'leri 8 saatte bir: 03:00 · 11:00 · 19:00 TR** | `FUNDING_POSITIVE` yalnız bu saatlerde çözülür → bugün 19:00'da çözülen marketler; **akşam sunumu (20:00–21:30) için yalnız `PRICE_*` şablonları** |
| 3 | Index mumu | ⚠️ CLI `index-candles` `--after`'ı **iletmiyor** (hep son mumu döndürür). **MCP aracı `market_get_index_candles` `after` ile doğru dakikayı döndürüyor** (`[openTimeMs,o,h,l,c,confirm]`) | Çapraz kontrol index mumu **MCP üzerinden** çekilir (Resolver ATK adapter'ı hem CLI hem MCP kullanır) |
| 3b | TR vs global | ⚠️ TR ve global `BTC-USDT` mumları **birebir aynı** (hacim dahil) — aynı emir defteri | Diğer site çapraz kontrol kaynağı **olamaz**; tek çapraz kontrol: index (`BTC-USD`). Spot (USDT) ile index (USD) arasında ~13 bps doğal fark ölçüldü → `CROSSCHECK_MAX_BPS=50` uygun |
| 4 | TR spot enstrümanları | ✅ 1184 spot parite; `BTC-USDT`, `BTC-TRY`, `USDT-TRY`, `ETH-USDT`, `AVAX-USDT`, `ETH-TRY`, `AVAX-TRY` canlı | Policy enstrüman listesi geçerli |
| 5 | Spot emir | ✅ `okx spot place --instId <id> --side <buy|sell> --ordType <type> --sz <n> [--px] [--tdMode cash] [--tgtCcy quote_ccy]` (yalnız help kontrol edildi, emir verilmedi) | Hedger bu sözdizimini kullanır; TR demo modu ve yarışma hesabı hâlâ doğrulanacak |
| 6 | MCP araç adları | ✅ `market` modülünde 21 araç, **öneksiz** isimler (`market_get_candles` …, `system_get_capabilities`); global ve tr aynı liste; şemalar ~22 bin karakter | `global__` / `tr__` önekini biz ekleriz; allowlist yine uygulanır |
| 7 | OI geçmişi | ⚠️ `okx market oi-history BTC-USDT-SWAP --bar 5m --ts <ms>` istenen zamandan ~1 sa 45 dk önceki satırları döndürdü; değerler string değil **sayı** | `OI_CHANGE` (bonus) en sona; uygulanırsa zaman semantiği önce test edilir, sayılar kanıtta string'e çevrilir |

Not: Örneklerdeki 105.000 $ eşiği temsilidir; F0 sırasında BTC ~81.700 $ idi.

### 8.4 Faz 0'da doğrulanacaklar (orijinal liste — sonuçlar §8.4a'da)
1. `okx market candles <inst> --bar 1m --after/--before ... --json` ile **belirli bir dakikanın** mumunu çekmenin kesin sözdizimi ve `confirm` alanı.
2. `okx market funding-rate BTC-USDT-SWAP --history --json` alan adları (`fundingTime`, `fundingRate` / `realizedRate`) ve hangi alanın "gerçekleşmiş oran" olduğu.
3. Index mumu CLI karşılığı (`market_get_index_candles`).
4. OKX TR'de `BTC-USDT` spot var mı, yoksa `BTC-TRY` mı kullanılacak; `USDT-TRY` mevcut mu.
5. TR'de demo modu çalışıyor mu; yarışma için sub-account/kredi verildi mi; spot emir CLI sözdizimi (`okx spot place --instId --side --ordType --sz [--px] --json`).
6. `okx-trade-mcp --site global --modules market` ile MCP araç adları (önek/isim formatı).

---

## 9. Kanıt (evidence) formatı ve bağımsız doğrulama

### 9.1 Format
```json
{
  "core": {
    "v": 1,
    "chainId": 43113,
    "contract": "0x...",
    "marketId": 7,
    "templateId": 1,
    "params": { "site": "global", "instId": "BTC-USDT", "thresholdE8": "10500000000000" },
    "resolveTime": 1792256400,
    "observations": [
      { "role": "primary", "source": "okx", "site": "global", "kind": "candle_1m",
        "instId": "BTC-USDT", "openTime": 1792256340, "close": "105231.4", "confirm": "1" },
      { "role": "crosscheck", "source": "okx", "site": "global", "kind": "index_candle_1m",
        "instId": "BTC-USD", "openTime": 1792256340, "close": "105198.0", "confirm": "1" }
    ],
    "crossCheck": { "maxBps": 50, "diffBps": 3, "ok": true },
    "rule": "primary.close > threshold",
    "outcome": "YES"
  },
  "meta": {
    "fetchedAt": "2026-10-17T15:31:32Z",
    "commands": ["OKX_SITE=global okx market candles BTC-USDT --bar 1m ... --json"],
    "raw": [ "...ham CLI çıktısı..." ],
    "agentVersion": "kahin-agent@0.1.0",
    "tx": "0x..."
  }
}
```

### 9.2 Hash kuralı
- `evidenceHash = keccak256(utf8(canonicalJSON(core)))`
- `canonicalJSON`: anahtarlar alfabetik sıralı, boşluksuz, sayılar **string** (float yuvarlama farkı olmasın).
- `meta` hash'e **dahil değildir** (çekilme zamanı, ham çıktı vb. tekrar üretilemez).

### 9.3 Bağımsız doğrulama
```bash
npm run verify -- 7
```
1. Zincirden market 7'yi okur: `templateId`, `params`, `resolveTime`, `evidenceHash`, `finalOutcome/proposedOutcome`.
2. Agent'ın **aynı** şablon kodunu kullanarak OKX'ten veriyi yeniden çeker (CLI).
3. `core`'u yeniden kurar, hash'ler, zincirdekiyle karşılaştırır.
4. Çıktı: `✅ Sonuç YES, hash eşleşiyor` veya `❌ uyuşmazlık: ...`.

Web'deki **/verify** sayfası aynı işlemi tarayıcıda yapamaz (CLI gerekir) → komutu kopyalanabilir gösterir + kanıt JSON'unu tarayıcıda hash'leyip zincirdekiyle karşılaştırır ("bu dosya değiştirilmemiş").

---

## 10. Web arayüzü

### 10.1 Teknoloji
Next.js (App Router) + TypeScript + Tailwind + wagmi v2 + viem. Cüzdan: injected (Core / MetaMask). Deploy: Vercel. Mobil öncelikli (jüri telefondan girecek).

### 10.2 Sayfalar
| Sayfa | İçerik |
|---|---|
| `/` | Başlık + tek cümle açıklama; açık marketler (kart), yakında çözülecekler, son çözülenler; üstte canlı sayaçlar (açılan / çözülen market, ATK çağrısı) |
| `/market/[id]` | Soru; kurallar kutusu (şablon, veri kaynağı, dakika, eşik — insan dili); geri sayım; YES/NO havuzları + ima edilen olasılık + agent tahmini; bet paneli; **"Agent neden açtı?"** (gerekçe + araç izi); durum çizelgesi (Active → Proposed → Finalized); **Kanıt kartı** (gözlemler, kural, sonuç, hash, Snowtrace linkleri, "Kendin doğrula" komutu); claim / dispute butonları |
| `/agent` | Canlı akış (SSE): "Market açtı", "Öneriyi reddetti (politika: …)", "Çözdü", "Hedge emri", "Hata/tekrar deneme"; ATK araç kullanım grafiği; agent cüzdan adresi + bakiyeleri |
| `/verify` | Market seç → kanıt JSON'unu indir, tarayıcıda hash'le, zincirdeki hash ile karşılaştır; CLI komutunu göster |
| `/oracle` | KAHİN Oracle servis kartı (OKX.AI ASP taslağı): araçlar, fiyat, MCP bağlantı adresi, örnek `resolve_metric` çağrısı ve yanıtı |

**Onay süresi göstergesi (§1.5):** Her kullanıcı tx'inde "gönderildi → onaylandı" süresi ölçülür ve toast'ta gösterilir ("1,2 sn'de kesinleşti"). Agent tx'lerinin süreleri feed'e yazılır; `/agent` sayfasında ortalama onay süresi kartı.

### 10.3 Veri kaynakları
- Market listesi/durumu/havuzlar: zincir (`marketCount` + `getMarket`, event'ler). 10 sn'de bir yenileme.
- Gerekçe, akış, istatistik, kanıt: agent API (`NEXT_PUBLIC_AGENT_API`).
- Agent API erişilemezse: "Agent akışı şu an erişilemiyor" rozeti; zincir verileri çalışmaya devam eder.

### 10.4 UX kuralları
- Tüm zamanlar kullanıcıya **TR saatiyle** (UTC+3) gösterilir, kanıtta UTC.
- "Bahis" yok → "Tahminde bulun", "Pozisyon", "Olasılık".
- Her tx sonrası Snowtrace linki.
- Yanlış ağ → büyük uyarı + "Fuji'ye geç".

---

## 11. Veri akışları

### 11.1 Market açılışı
```
Scout ──► ATK MCP (global/tr market araçları) ──► Claude analiz
Claude ──► propose_market(json) ──► Policy ──(ret)──► feed: rejected(reason)
                                       └─(kabul)──► templates.encode(params)
──► PredictionMarket.createMarket(...) ──► MarketCreated
──► bet(YES, p·SEED) + bet(NO, (1−p)·SEED)  (agent cüzdanı)
──► feed: market_created{rationale, toolTrace, tx}
```

### 11.2 Kullanıcı tahmini
```
Web ──► MockUSDC.approve(pm, amount) ──► PredictionMarket.bet(id, yes, amount) ──► BetPlaced
```

### 11.3 Çözüm
```
Resolver (her 30 sn) ──► vadesi gelen market
──► templates[id].resolve(params, resolveTime) ──► ATK CLI (primary + crosscheck)
──► evidence.core ──► keccak256 ──► dosya /evidence/:id.json
──► proposeResolution(id, outcome, hash, uri) ──► ResolutionProposed
──► (disputeWindow sonra) finalize(id) ──► Finalized
Kullanıcı ──► claim(id) ──► Claimed
```

### 11.4 Hedge (bonus)
```
Hedger (her 5 dk) ──► zincirden agent pozisyonları ──► exposureUp
──► hedef − mevcut > minStep ? ──► ATK: orderbook + fee ──► maliyet tahmini
──► okx spot place (TR, tavanlı) ──► feed: hedge{side, sz, fill, fee}
```

---

## 12. Güvenlik modeli

| Varlık | Nerede | Kim erişir | Önlem |
|---|---|---|---|
| OKX TR API anahtarı | `~/.okx/config.toml` | Yalnız ATK CLI (Hedger) | Repoda/sohbette/LLM'de yok; yalnız trade izni, **para çekme izni yok**, mümkünse IP kısıtı, yarışma sub-account'u |
| Agent Fuji özel anahtarı | `agent/.env` (gitignore) | Yalnız `chain/` modülü | Az AVAX; kontratta yalnız `agent` rolü |
| Owner/deployer anahtarı | Ayrı cüzdan | Elle | Agent sürecinde yok |
| Anthropic API anahtarı | `agent/.env` | Scout | — |

**LLM sınırları:** Claude yalnız *okuma* ATK araçlarını ve `propose_market` / `list_open_markets`'i görür. Zincire yazma, emir verme, anahtar okuma imkânı **yok**. Prompt injection (ör. ATK yanıtında tuhaf metin) en kötü ihtimalle reddedilecek bir öneri üretir; Policy ve şablon zorunluluğu bunu sınırlar.

**Okuma/yazma hattı ayrımı:** Yazma işlemleri (zincir tx, spot emir) yalnız deterministik koddan, sabit tavanlarla.

**Kontrat:** OpenZeppelin `Ownable`, `Pausable`, `ReentrancyGuard`, `SafeERC20`; CEI; sınırsız approve istenmez.

**Kill switch:** `PAUSE_AGENT` (servis) + `pause()` (kontrat) + Hedger için `HEDGE_ENABLED=0`.

**Güven varsayımı (dürüstçe):** Veri kaynağı OKX'tir (tek kaynak, çapraz kontrol aynı sağlayıcının endeksi). Agent'ın yanlış öneri yapması **tespit edilebilir** (verify) ve **itiraz edilebilir**; itirazı bugün owner karara bağlar (merkezî komite). Yol haritası: birden fazla bağımsız çözücü agent + ERC-8004 Validation Registry.

---

## 13. Hata ve kenar durumları

| Durum | Davranış |
|---|---|
| ATK yanıt vermiyor / rate limit | Exponential backoff; resolver tekrar dener; akışa `atk_error` |
| Mum henüz `confirm=1` değil | Bekle, tekrar dene |
| Veri hiç gelmiyor (deadline'a 10 dk) | Void öner (`DATA_UNAVAILABLE`) |
| Çapraz kontrol farkı > eşik | Void öner (`CROSSCHECK_FAILED`) |
| Tek taraflı havuz | finalize → Void, iade |
| Agent süreci çöktü | Yeniden başlatınca zincirden durumu okur (durumsuz tasarım); öneri yapılmamışsa yapar; `proposeDeadline` aşılırsa herkes `voidStale` |
| Fuji RPC hatası | 2. RPC'ye geç (`FUJI_RPC_FALLBACK`). Okuma publicnode, gönderme resmî RPC; publicnode/RPC gas tahmini zaman zaman anlamsız ("exceeds block gas limit") → agent ve cüzdan MCP'si **sabit gas limiti** kullanır |
| Agent AVAX'ı bitti | `/health` uyarı; faucet'ten doldur |
| Scout geçersiz JSON / şablon dışı öneri | Policy reddi, 1 düzeltme hakkı, sonra atla |
| Claude API hatası | Scout döngüsü atlanır; resolver etkilenmez (LLM'siz) |
| Tünel düştü | Web zincir verisiyle çalışır, akış rozeti "erişilemiyor" |
| Hedge emri reddedildi (bakiye, min sz) | Akışa yaz, bir sonraki döngüde tekrar değerlendir |
| Saat dilimi karışıklığı | İç temsil hep UTC saniye; UI'da TR saati |

---

## 14. Konfigürasyon

### `agent/.env`
```
# Zincir
FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
FUJI_RPC_FALLBACK=
AGENT_PRIVATE_KEY=0x...
DEPLOYMENTS_FILE=../deployments/fuji.json

# LLM
ANTHROPIC_API_KEY=...
AGENT_MODEL=claude-opus-5-5
SCOUT_EFFORT=medium

# Döngüler
SCOUT_INTERVAL_SEC=600
SCOUT_MAX_STEPS=12
RESOLVER_INTERVAL_SEC=30
RESOLVE_DELAY_SEC=90
HEDGER_INTERVAL_SEC=300

# Politika
MAX_OPEN_MARKETS=6
SEED_TOTAL=20
CROSSCHECK_MAX_BPS=50

# Hedge
HEDGE_ENABLED=0
HEDGE_RATIO=0.2
HEDGE_MAX_NOTIONAL=20
HEDGE_MIN_STEP=5
OKX_TR_PROFILE=hackathon

# Sunucu
PORT=8787
PUBLIC_BASE_URL=https://<tunnel>.trycloudflare.com
CORS_ORIGINS=https://kahin.vercel.app,http://localhost:3000
DRY_RUN=0
PAUSE_AGENT=0
```

### `web/.env.local`
```
NEXT_PUBLIC_CHAIN_ID=43113
NEXT_PUBLIC_FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
NEXT_PUBLIC_PM_ADDRESS=0x...
NEXT_PUBLIC_USDC_ADDRESS=0x...
NEXT_PUBLIC_AGENT_API=https://<tunnel>.trycloudflare.com
NEXT_PUBLIC_EXPLORER=https://testnet.snowtrace.io
```

---

## 15. Repo yapısı ve teknoloji yığını

```
kahin/
├─ CLAUDE.md                     # Claude Code için proje kuralları (plan dosyasında metni var)
├─ README.md                     # jüri için: ne, nasıl çalışır, adresler, tx linkleri, kurulum
├─ docs/
│  ├─ MIMARI.md                  # bu doküman
│  ├─ PLAN.md                    # plan dokümanı
│  └─ OKXAI_LISTING.md           # A2MCP ASP listeleme kartı (§7.7)
├─ deployments/fuji.json         # kontrat adresleri, deploy bloğu
├─ contracts/                    # Foundry
│  ├─ src/PredictionMarket.sol
│  ├─ src/MockUSDC.sol
│  ├─ test/PredictionMarket.t.sol
│  └─ script/Deploy.s.sol
├─ agent/
│  ├─ src/
│  │  ├─ index.ts                # döngüleri + sunucuyu başlatır
│  │  ├─ config.ts               # env (zod)
│  │  ├─ atk/{cli.ts, mcp.ts, counter.ts}
│  │  ├─ chain/{client.ts, abi.ts, markets.ts}
│  │  ├─ templates/{index.ts, priceAbove.ts, fundingPositive.ts, priceMove.ts, oiChange.ts, tryPremium.ts}
│  │  ├─ evidence/{canonical.ts, build.ts, store.ts}
│  │  ├─ policy/index.ts
│  │  ├─ scout/{loop.ts, prompt.ts, tools.ts}
│  │  ├─ resolver/loop.ts
│  │  ├─ hedger/loop.ts
│  │  ├─ oracle-mcp/server.ts   # KAHİN Oracle MCP (§7.7)
│  │  ├─ feed/store.ts
│  │  └─ server/index.ts
│  ├─ scripts/{verify.ts, scout-once.ts, resolver-once.ts, create-manual.ts}
│  └─ test/                      # vitest: templates, canonical hash, policy
└─ web/                          # Next.js
   ├─ app/{page.tsx, market/[id]/page.tsx, agent/page.tsx, verify/page.tsx}
   ├─ components/ ...
   └─ lib/{wagmi.ts, contracts.ts, agentApi.ts, format.ts}
```

| Katman | Seçim |
|---|---|
| Kontrat | Solidity ^0.8.24, Foundry, OpenZeppelin 5 |
| Agent | Node 20, TypeScript, viem, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, zod, fastify, vitest |
| Web | Next.js, Tailwind, wagmi v2, viem |
| Altyapı | Fuji public RPC, Vercel, cloudflared quick tunnel, GitHub (public repo) |

---

## 16. Jüri kriterleriyle eşleşme

### 16.1 Jüri tablosu (kullanıcının paylaştığı Google Sheets — alt kriterli, 100 puan)
> Not: Resmî etkinlik sayfası farklı bir dağılım veriyor (mimari/otonomi %35, ürün %25, teknik %20, demo %20 + 2 bonus). Aynı ağırlıklar topluluk rehberinde "öneri" olarak da geçiyordu. **Plan iki tabloyu da karşılayacak şekilde kuruldu.** Tablo dosyası ayrıca sıralamadan önce uygunluk kontrolü öneriyor: **public repo, çalışan demo, Avalanche deploy, en az bir OKX aracı** — dördü de MVP'de var. Eşitlikte Agentic Design öne çıkıyor.

| Kriter | Alt kriter (puan) | KAHİN'de karşılığı | Sahnede kanıt | Hedef |
|---|---|---|---|---|
| **Agentic Design 20** | Autonomy: uçtan uca, adım adım prompt olmadan (10) | Scout kendi başına market açar, Resolver kendi başına çözer, finalize eder; insan müdahalesi yok | `/agent` akışı: gün boyu açılan/çözülen marketler | 9/10 |
| | Reasoning & tool use: çok adımlı plan, doğru araç seçimi (10) | Scout'un MCP araç izi (OI → funding → mum → eşik); Policy reddi + düzeltme; LLM'in çözümden bilinçli dışlanması | Bir marketin araç izi ekranı | 9/10 |
| **Technical Execution 15** | Çalışan, deploy edilmiş ürün (5) | Fuji verified kontrat + Vercel web + çalışan agent | Canlı URL | 5/5 |
| | Mimari kalitesi (5) | 3 rol, okuma/yazma ayrımı, kanonik kanıt, durumsuz agent | Mimari şeması | 5/5 |
| | Teknik zorluk (5) | Tekrar üretilebilir oracle + kanıt hash'i + verify + MCP istemci **ve** MCP sunucu | `npm run verify` canlı | 4–5/5 |
| **Avalanche Integration 10** | C-Chain'e deploy (5) | Fuji C-Chain | Snowtrace | 5/5 |
| | Avalanche'ın güçlü yanları: hızlı kesinlik, custom L1, ICM (5) | §1.5: hızlı kesinlik sayesinde 15 dk'lık marketler + **ölçülen onay süreleri**; düşük ücretle market başı kanıt; L1+ICM yol haritası | UI'da "1,2 sn'de kesinleşti" + ortalama onay süresi kartı | 3–4/5 (L1/ICM yapılmazsa) |
| **OKX Integration 10** | OKX agent araçlarını kullanma (5) | ATK: MCP (Scout) + CLI (Resolver) + spot (Hedger), global + TR | `/api/stats` araç sayaçları | 5/5 |
| | OKX.AI'da servis olarak listelenebilir (5) | **KAHİN Oracle A2MCP servisi** (§7.7) + listeleme kartı | Claude Code'dan canlı `resolve_metric` çağrısı + `/oracle` sayfası | 4–5/5 |
| **Innovation & Real-World Value 25** | Özgünlük (10) | Agent'ın açıp kanıtla çözdüğü market; perp verisi soru olarak; İstanbul'daki 27 projeden hiçbirine benzemiyor | Problem slaytı | 8–9/10 |
| | Net problem ve hedef kullanıcı (5) | §1.1 + §1.4 (iki taraflı kullanıcı) | Tek slayt | 4–5/5 |
| | Pazar potansiyeli / iş modeli (5) | Havuz ücreti + çağrı başı oracle ücreti + beyaz etiket (§1.4) | Tek slayt | 4/5 |
| | Pazara hazır (5) | Puan tabanlı lig ile hemen başlanabilir; oracle servisi listelemeye hazır | 90 günlük GTM | 3/5 (testnet + yasal belirsizlik) |
| **Demo & Presentation 20** | Çalışan canlı demo (5) | Sunumda gerçekten çözülen market (§17) | Canlı | 5/5 |
| | UX tasarımı (5) | Mobil öncelikli, sade dil, onay süresi toast'ları, kanıt kartı | Jüri telefonla katılır | 4/5 |
| | Pitch ve soru-cevap (10) | §17 akışı + §18 cevapları | — | 8–9/10 |

**Tahmini toplam: ~85–92 / 100.** En zayıf alt kriterler: "Avalanche strengths" (L1/ICM yok) ve "Ready to go market" (testnet, yasal belirsizlik) → sunumda §1.4 ve §1.5 ile kapatılır.

### 16.2 Resmî etkinlik sayfası dağılımı
| Kriter | Ağırlık | Karşılığı |
|---|---:|---|
| Agent architecture & autonomy | %35 | 16.1 Agentic Design + Mimari kalitesi |
| Product & strategy | %25 | 16.1 Innovation & Real-World Value |
| Technical quality | %20 | 16.1 Technical Execution |
| Demo & presentation | %20 | 16.1 Demo & Presentation |
| Bonus 1 (ATK ile gerçek işlem) | + | Hedger (B1) |
| Bonus 2 (Avalanche deploy) | + | Fuji kontratları (MVP) |

---

## 17. Demo senaryosu (10 dk finalist sunumu)

| Dk | Ne |
|---|---|
| 0:00–1:00 | **Problem:** "Tahmin piyasalarında asıl soru: sonucu kim, neye göre belirledi?" + TR kullanıcısının perp verisini görememesi |
| 1:00–2:00 | **Çözüm** tek cümle + mimari şeması (3 rol, ATK, Fuji) |
| 2:00–3:30 | **Jüri katılımı:** QR → site → faucet → açık bir markete tahmin (jüriden biri) |
| 3:30–5:00 | **Agent akışı:** bugün açtığı marketler, bir tanesinin gerekçesi ve araç izi ("OI'yi gördü, funding'e baktı, şu eşiği seçti") |
| 5:00–6:30 | **Canlı çözüm:** sunum sırasına denk getirilmiş bir market çözülür → kanıt kartı → Snowtrace → terminalde `npm run verify` → ✅ aynı hash |
| 6:30–7:15 | **OKX.AI'a hazır oracle servisi:** Claude Code'dan KAHİN Oracle MCP'ye `resolve_metric` çağrısı → kanıtlı cevap; `/oracle` listeleme kartı |
| 7:15–7:45 | **Neden Avalanche:** onay süresi kartı (ortalama ~1 sn) → "15 dakikalık marketler ancak burada mümkün"; L1 + ICM yol haritası |
| 7:45–8:15 | **Hedge (varsa):** agent'ın OKX TR'deki spot emri ve maliyet hesabı · **Güvenlik:** LLM neden çözümde yok, anahtarlar, kill switch, itiraz |
| 8:15–9:30 | **Hedef kullanıcı · iş modeli · 90 günlük pazara çıkış** (§1.4): puan ligi → OKX.AI oracle → mainnet |
| 9:30–10:00 | Kapanış + rakamlar (bugün X market, Y çözüm, Z ATK çağrısı) |

**Zamanlama hilesi:** Sunumlar 20:00'de başlıyor. Agent'a 17:00–18:30 arasında, `resolveTime`'ı 20:00–21:30 aralığına düşen birkaç market açtır (ya da `create-manual` ile aç) → sunum anında gerçekten çözülen bir market olur. Yedek: önceden kaydedilmiş 2 dk video.

---

## 18. Jüri soruları ve hazır cevaplar

| Soru | Cevap |
|---|---|
| Oracle merkezî değil mi? | "Kaynak OKX, evet. Ama sonuç tekrar hesaplanabilir: kuralı zincirde, veriyi OKX geçmişinde, komutu kanıtta. Endeksle çapraz kontrol ve itiraz süresi var. Yol haritası: birden fazla bağımsız çözücü agent." |
| Agent kendi açtığı marketi manipüle edebilir mi? | "Kural açılışta zincire yazılıyor; çözüm LLM'siz ve deterministik; yanlış öneri `verify` ile yakalanır ve itiraz edilir. Agent'ın seed pozisyonu da zincirde açık." |
| LLM neden çözümde yok? | "LLM soruyu sorar, kod sonucu okur. Oracle'ı halüsinasyona ve prompt manipülasyonuna açmamak için." |
| OKX'te bu yok mu? | "Global'de event contract'lar var, TR'de yok. Orada marketleri OKX açıyor; bizde piyasa durumuna göre agent açıyor, perp ve TRY'ye özgü sorular var, çözüm zincirde doğrulanabilir." |
| Polymarket'ten farkı? | "Orada marketleri insanlar açıyor, çözüm oylamayla. Bizde kısa vadeli, veri tabanlı, agent'ın açıp çözdüğü, herkesin tekrar hesaplayabildiği marketler." |
| Kimse katılmazsa? | "Agent iki tarafa başlangıç likiditesi koyuyor; tek taraflı market Void olur, herkes iade alır." |
| Yasal mı? | "Bugün testnet ve değersiz test token. Ürünleşmede OKX TR hesabıyla doğrulanmış kullanıcılar ve puan/itibar tabanlı lig ya da lisanslı yapı." |
| Anahtarlar nerede? | "OKX anahtarı ATK'nın lokal config'inde, çekim izni yok; agent cüzdanı .env'de; LLM hiçbirini görmüyor, yazma işlemleri yalnız koddan." |
| Hangi ATK araçlarını kullandınız? | `/api/stats` ekranı: araç bazında çağrı sayıları. |
| Bugün mü yazıldı? | GitHub commit geçmişi (ilk commit bugün sabah). |
| Neden Avalanche, başka EVM değil? | "15 dakikalık marketler hızlı kesinlik ister; ölçtüğümüz onay süresi ~1 sn. Market başına kanıt tx'i ancak çok düşük ücretle ekonomik. Büyüyünce kendi L1'imiz ve ICM ile diğer L1'lere sonuç yayını." |
| OKX.AI'da nasıl listelenir? | "Çözüm motorumuz zaten A2MCP formatında bir MCP servisi; araçları, şemaları, fiyatı listeleme kartında. Kayıt ve x402 tahsilatı X Layer'da; bugün bilerek yapmadık, adımları hazır." |
| Kim para öder, nasıl büyürsünüz? | "İlk ay parasız puan ligiyle üniversite ve OKX TR topluluğunda; ardından oracle servisini agent'lara çağrı başı satıyoruz; marketlerde %1 havuz ücreti." |
| Hedge gerçekten riski sıfırlıyor mu? | "Hayır, sıfırlamıyor; tavanlı, gösterilebilir bir risk yönetimi döngüsü. Spot'ta açığa satış olmadığı için aşağı yönlü hedge ancak eldeki BTC kadar." |

---

## 19. Bilinçli olarak yapılmayanlar / yol haritası
1. **Çoklu çözücü agent'lar:** Birden fazla bağımsız agent aynı marketi çözer, çoğunluk/eşik ile kesinleşir; ERC-8004 Validation Registry'ye yazılır.
2. **OKX.AI'a gerçek kayıt + x402 tahsilatı:** Bugün hazırlanan KAHİN Oracle MCP servisinin (§7.7) ASP olarak kaydı ve X Layer üzerinden çağrı başı ödeme.
2b. **KAHİN L1 + ICM:** Marketler kendi Avalanche L1'inde; kesinleşen sonuçlar ICM ile C-Chain ve diğer L1'lere yayınlanır (çapraz-L1 oracle).
3. **Mühürlü tahminler** (plan dosyasının son fazı): yön, market kapanana kadar gizli (commit-reveal).
4. **Çok seçenekli marketler** ("hangi coin en çok yükselir?").
5. **Puan/itibar ligi** ve OKX TR hesabıyla doğrulanmış katılım.
6. **eERC** ile tutar gizliliği.
7. **Kendi Avalanche L1'i** + ICM ile C-Chain'e sonuç taşıma.

---

## 20. Sözlük
- **Parimutuel:** Tüm katılımcıların paralarının havuzda toplandığı, kazanan tarafın kaybeden havuzu payı oranında paylaştığı model.
- **Oracle:** Zincir dışındaki bir gerçeği (fiyat vb.) zincire getiren mekanizma.
- **Funding rate:** Perpetual kontratlarda long ve short taraf arasında periyodik ödenen oran; pozitifse long'lar öder (long kalabalığı işareti).
- **Open interest (OI):** Açık perp pozisyonlarının toplam büyüklüğü.
- **Void:** Marketin geçersiz sayılıp herkese iade yapılması.
- **Canonical JSON:** Aynı veriden her zaman bayt bayt aynı metni üreten JSON yazımı (hash için şart).
- **Commit-reveal:** Önce verinin hash'ini yayınlayıp sonra verinin kendisini açıklama yöntemi.
- **ERC-8004:** Zincir üstü AI agent kimlik / itibar / doğrulama kayıt standardı.
