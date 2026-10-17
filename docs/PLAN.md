# KAHİN — Geliştirme Planı (Claude Opus 5.5 ile)

> Bu plan `10_KAHIN_MIMARI.md`'ye **sadık** kalınarak uygulanır. Mimaride olmayan bir şey eklenecekse önce mimari güncellenir.
> Hazırlanma: 17 Ekim 2026, 12:05. **Teslim: 19:00.** Finalist sunumları 20:00.
> Saatler, 12:45'te başlandığı varsayımıyla yazıldı. Geç başlanırsa §2'deki kesme kurallarını uygula.

---

## İçindekiler
0. Özet: neyi, hangi sırayla (+ 0.1 jüri tablosuna göre öncelikler)
1. Claude Opus 5.5 ile çalışma düzeni (+ `CLAUDE.md` metni)
2. Zaman çizelgesi, kontrol noktaları ve kesme kuralları
3. Ekip bölüşümü (1 / 2 / 3 kişi)
4. Fazlar (her fazda: amaç · çıktı · adımlar · kabul kriteri · Opus promptu · doğrulama)
   - F0 Kurulum ve doğrulama
   - F1 Kontratlar + testler
   - F2 Fuji deploy + verify
   - F3 Agent çekirdeği + Resolver + verify aracı
   - F4 Scout (LLM + ATK MCP)
   - F4.5 KAHİN Oracle MCP servisi + OKX.AI listeleme kartı
   - F5 Web arayüzü
   - F6 Demo marketlerini açma (zaman kritik)
   - F7 Hedger — OKX TR spot (Bonus 1)
   - F8 README, video, teslim
   - F9 (opsiyonel) Ek şablonlar
   - F10 (opsiyonel) ERC-8004 agent kimliği
   - **F11 (duruma göre) Gizlilik: mühürlü tahminler**
5. Kontrol / inceleme promptları
6. Sunum hazırlığı kontrol listesi
7. Acil durum (bir şey bozulursa)

---

## 0. Özet

```
F0 kurulum ─► F1 kontrat ─► F2 deploy ─► F3 resolver ─► F4 scout ─► F6 demo marketleri ─► F4.5 oracle MCP ─► F7 hedge ─► F8 teslim
                         └──────────────► F5 web (paralel; ABI hazır olunca) ───────────────────────────────┘
Opsiyonel (sırayla, zaman kalırsa): F9 ek şablonlar · F10 ERC-8004 · F11 gizlilik
```

**MVP tanımı (19:00'da mutlaka çalışıyor olmalı):** Fuji'de verified kontrat · agent kendi başına market açıyor (en az `PRICE_ABOVE`, `FUNDING_POSITIVE`) · agent kendi başına çözüyor + kanıt + hash · `npm run verify` ✅ · web'den tahmin + claim + **onay süresi gösterimi** · `/agent` akışı · **KAHİN Oracle MCP servisi + OKX.AI listeleme kartı** · public GitHub repo + README.

### 0.1 Jüri tablosuna göre öncelikler (Google Sheets, 100 puan)
| Kriter | Puan | Bu plandaki karşılığı | Faz |
|---|---:|---|---|
| Agentic Design — otonomi (10) + akıl yürütme/araç kullanımı (10) | 20 | Scout + Resolver, araç izi | F3, F4 |
| Technical Execution — deploy edilmiş ürün (5), mimari (5), zorluk (5) | 15 | Fuji + Vercel + agent, verify | F1–F3, F5 |
| Avalanche — C-Chain deploy (5) + Avalanche'ın güçlü yanları (5) | 10 | Fuji + **ölçülen onay süreleri** ve "neden Avalanche" anlatısı | F2, F5, F8 |
| OKX — OKX agent araçları (5) + **OKX.AI'da listelenebilir servis (5)** | 10 | ATK MCP/CLI + **KAHİN Oracle MCP** | F3, F4, **F4.5** |
| Innovation — özgünlük (10), problem/kullanıcı (5), iş modeli (5), pazara hazır (5) | 25 | Mimari §1.4: iki taraflı kullanıcı, ücret modeli, 90 günlük GTM | F8 (README + sunum) |
| Demo — canlı demo (5), UX (5), pitch + soru-cevap (10) | 20 | §17 senaryosu, mobil UX | F5, F6, F8 |

Uygunluk kontrolü (tablo dosyasının önerisi): public repo ✅ · çalışan demo ✅ · Avalanche deploy ✅ · en az bir OKX aracı ✅. Eşitlikte Agentic Design belirleyici → F3/F4 asla kesilmez.
Resmî etkinlik sayfasının farklı dağılımı (35/25/20/20 + bonuslar) için bkz. mimari §16.2; Hedger (F7) oradaki Bonus 1 içindir.

---

## 1. Claude Opus 5.5 ile çalışma düzeni

### 1.1 Model ve oturum
- Claude Code masaüstü uygulamasında model seçiciden **Opus 5.5**'i seç. Terminalde: `claude --model claude-opus-5-5`.
- **Her faz = ayrı bir görev.** Fazın promptunu yapıştır → Opus önce kısa bir uygulama planı çıkarsın → sen onayla → uygulasın → kabul kriterlerini kendisi doğrulasın → commit.
- Büyük fazlarda (F1, F3, F4, F5) **plan modu** ile başla: önce plan, onaydan sonra kod.
- Bağlam uzarsa yeni oturum aç; promptlar zaten `docs/MIMARI.md` ve `docs/PLAN.md`'yi okumasını söylüyor.
- 2–3 kişiyseniz her kişi kendi Claude Code oturumunda **farklı klasörde** çalışsın (contracts / agent / web). Aynı dosyaya iki kişi dokunmasın.

### 1.2 Altın kurallar (her promptta geçerli)
1. Mimaride yazmayan özellik ekleme; belirsizlikte sor.
2. Anahtarları (OKX, özel anahtar, Anthropic) **asla** okuma/yazdırma/commit etme. `.env` gitignore'da.
3. Gerçek işlem (OKX spot emir) yalnız F7'de ve yalnız benim açık onayımla.
4. ATK CLI/MCP komutlarını tahmin etme: önce `--help` çıktısına bak.
5. Her faz sonunda: testler geçiyor + kabul kriterleri tek tek kontrol edildi + küçük, açıklayıcı commit.
6. Float ile para/fiyat hesabı yok: kontratta tam sayı, agent'ta `bigint`/decimal string.

### 1.3 Repo kökündeki `CLAUDE.md` (F0'da oluşturulacak — metni olduğu gibi kullan)
```markdown
# KAHİN — Claude Code kuralları

Proje: Agent yönetimli, kanıtlı kripto olasılık piyasası. OKX Agent Trade Kit (ATK) + Avalanche Fuji.
Tek doğruluk kaynağı: docs/MIMARI.md (ne/nasıl) ve docs/PLAN.md (sıra/kabul kriteri).

## Kurallar
- MIMARI.md'de olmayan özellik ekleme. Çelişki/belirsizlikte dur ve sor.
- Gizli bilgiler: .env, ~/.okx/config.toml, özel anahtarlar → okuma, yazdırma, commit etme.
- OKX'te gerçek emir (spot place) yalnız açık kullanıcı onayıyla.
- ATK komut/araç adlarını tahmin etme; `okx <cmd> --help` veya MCP araç listesinden doğrula.
- Para/fiyat: kontratta uint/int, agent'ta bigint veya decimal string. float yok.
- Zamanlar: içeride UTC Unix saniye, dakikaya hizalı. UI'da Europe/Istanbul.
- Çözüm (resolver) deterministik; LLM çözümde kullanılmaz.
- Her değişiklikten sonra ilgili testleri çalıştır; kırık testle commit yok.
- Küçük commitler, mesaj formatı: `feat(agent): ...`, `fix(contracts): ...`, `docs: ...`.

## Komutlar
- contracts: `cd contracts && forge build && forge test -vv`
- agent: `cd agent && npm test`, `npm run dev`, `npm run verify -- <id>`
- web: `cd web && npm run dev`

## Yapı
contracts/ (Foundry) · agent/ (Node/TS) · web/ (Next.js) · deployments/fuji.json · docs/
```

### 1.4 Her oturumun ilk mesajı (bağlam yükleme)
```
Bu repoda KAHİN projesini geliştiriyoruz. Önce CLAUDE.md, docs/MIMARI.md ve docs/PLAN.md
dosyalarını baştan sona oku. Sonra bana 5 maddede projenin ne olduğunu ve şu an hangi fazda
olduğumuzu (git log ve dosya yapısına bakarak) özetle. Kod yazma; özeti onaylamamı bekle.
```

---

## 2. Zaman çizelgesi ve kesme kuralları

| Saat | Faz | Kontrol noktası (bu saatte bu olmalı) |
|---|---|---|
| 12:45–13:15 | F0 | Repo public, ATK çağrıları doğrulandı, Fuji cüzdanları fonlu |
| 13:15–14:30 | F1 | `forge test` yeşil |
| 14:30–14:50 | F2 | Snowtrace'te verified kontrat, `deployments/fuji.json` |
| 14:50–16:00 | F3 | Elle açılan market otomatik çözülüyor, `verify` ✅ |
| 13:30–17:30 | F5 (paralel) | Web'den tahmin + claim çalışıyor |
| 16:00–17:00 | F4 | Agent kendi başına market açıyor |
| **17:00–17:20** | **F6** | **Sunum saatine (20:00–21:30) çözülecek marketler açık** |
| 17:20–17:55 | F4.5 | Claude Code'dan KAHİN Oracle MCP'ye `resolve_metric` çağrısı çalışıyor + listeleme kartı |
| 17:55–18:20 | F7 / F5 cila | Hedge emri (resmî sayfadaki Bonus 1) |
| 18:20–18:30 | F9/F10/F11 | Yalnız MVP sağlamsa |
| **18:30** | **Özellik dondurma** | Sadece hata düzeltme |
| 18:30–19:00 | F8 | README, video, teslim |

**Kesme kuralları (geç kalırsan sırayla kes):**
1. 15:15'te F2 bitmediyse → F9, F10, F11 iptal.
2. 16:30'da F3 bitmediyse → `FUNDING_POSITIVE` iptal, yalnız `PRICE_ABOVE`; F7 iptal.
3. 17:00'de F4 bitmediyse → marketleri `create-manual` scripti ile aç (agent'ın çözücü rolü yine otonom); Scout'u "tek seferlik analiz + öneri" olarak göster.
4. 17:30'da web yoksa → mevcut sayfaları sadeleştir: yalnız liste + detay + bet + kanıt.
5. Dispute/komite akışı zaman alırsa → kontratta kalsın, UI'da gösterme.
6. 17:45'te F4.5 bitmediyse → MCP sunucusunu yalnız `resolve_metric` + `list_templates` ile sınırla (stdio modu yeterli); listeleme kartını mutlaka yaz (5 puanlık kriterin yarısı karttan gelir).
7. Kesme sırası (en önce kesilen): F11 → F10 → F9 → **F7 (hedge)** → F4.5'in HTTP modu → dispute UI. **F3, F4, F6 ve onay süresi gösterimi kesilmez.**

---

## 3. Ekip bölüşümü

| Kişi sayısı | A | B | C |
|---|---|---|---|
| **1** | Sırayla: F0 → F1 → F2 → F3 → F4 → F5 (sade) → F6 → F4.5 (stdio + kart) → F8 | — | — |
| **2** | F0 → F1 → F2 → F3 → F6 → F4.5 → F7 | F0'dan sonra F5 (ABI'yı F1 arayüzünden al, adresleri F2'den sonra bağla) → F4 | — |
| **3** | F0 → F1 → F2 → F4.5 → F7 → F8 | F3 → F4 → F6 | F5 (web) + sunum/video + GTM/iş modeli slaytları |

Paylaşılan sözleşme: kontrat ABI'si ve `deployments/fuji.json` formatı F1'in ilk 20 dakikasında sabitlenir; sonra değişirse herkese haber verilir.

---

## 4. Fazlar

### F0 — Kurulum ve doğrulama (30 dk)

**Amaç:** Kod yazmadan önce bütün dış bağımlılıkların gerçekten çalıştığını kanıtlamak.

**Elle yapılacaklar (Claude'a yaptırma):**
- GitHub'da **public** repo `kahin` oluştur, klonla.
- `docs/MIMARI.md` ← `10_KAHIN_MIMARI.md`, `docs/PLAN.md` ← `11_KAHIN_PLAN.md` kopyala.
- İki Fuji cüzdanı: **owner** ve **agent** (MetaMask/Core). Builder Hub faucet'ten ikisine de AVAX (Team1 linki: https://go.team1.network/turkiye-builder).
- `agent/.env` içine `AGENT_PRIVATE_KEY`, `ANTHROPIC_API_KEY` yaz (kendin).
- OKX TR yarışma hesabı/sub-account bilgisi workshop'ta verildiyse: `okx config init` ile profil oluştur (kendin, TR sitesi). Çekim izni olmasın.

**Opus promptu:**
```
F0: Kurulum ve doğrulama. CLAUDE.md'yi docs/PLAN.md §1.3'teki metinle oluştur.
Sonra şunları yap ve her birinin çıktısını bir tabloda raporla (kod yazma, sadece komut çalıştır):

1. Araçlar: node -v, npm -v, forge --version, git --version. Foundry yoksa kurulum komutunu söyle.
2. ATK: `npm i -g @okx_ai/okx-trade-mcp @okx_ai/okx-trade-cli` (hata olursa --ignore-scripts ile),
   `okx --version`, `okx market --help`, `okx spot --help`.
3. docs/MIMARI.md §8.4'teki 6 maddeyi tek tek doğrula:
   a) OKX_SITE=global ile BTC-USDT 1m mumlarını --json çek; belirli bir dakikanın mumunu
      (after/before parametreleri) nasıl çektiğini ve `confirm` alanını göster.
   b) BTC-USDT-SWAP funding geçmişini --json çek; alan adlarını ve gerçekleşmiş oran alanını belirle.
   c) Index mumlarının CLI karşılığını bul (market --help), BTC-USD için 1m çek.
   d) OKX_SITE=tr ile instruments listesinde BTC-USDT, BTC-TRY, USDT-TRY spot var mı?
   e) okx spot place --help çıktısını göster (ÇALIŞTIRMA, sadece help).
   f) `okx-trade-mcp --site global --modules market` için MCP araç adlarını listelemenin yolunu bul
      (ör. küçük bir node script ile tools/list) ve isimleri raporla.
4. Sonuçlara göre docs/MIMARI.md'de düzeltilmesi gereken yerleri öner (henüz düzenleme yapma).
Gizli dosyalara (.env, ~/.okx) dokunma.
```

**Kabul:** 6 maddenin hepsi ✅ ya da alternatifi belirlenmiş; mimari düzeltmeleri onaylanıp uygulanmış; ilk commit atılmış.

---

### F1 — Kontratlar + testler (75 dk)

**Amaç:** `MockUSDC` ve `PredictionMarket`'i mimari §6'ya birebir uygun yazmak ve test etmek.

**Opus promptu (plan modunda başlat):**
```
F1: Kontratlar. docs/MIMARI.md §6'yı referans al ve contracts/ altında Foundry projesi kur
(OpenZeppelin v5, solidity ^0.8.24).

Yazılacaklar:
- src/MockUSDC.sol: 6 decimals, faucet() (1000 kUSDC, adres başı 1 saat cooldown), onlyOwner mint.
- src/PredictionMarket.sol: §6.2 veri modeli, §6.3 parametreler, §6.4 fonksiyonlar, §6.5 kurallar,
  §6.6 event'ler. Ownable + Pausable + ReentrancyGuard + SafeERC20, CEI deseni.
  templateId 1..5 kabul edilir; params içeriği kontratta yorumlanmaz.
  Struct'a gizlilik alanı EKLEME (o F11'in işi).
- test/PredictionMarket.t.sol: §6.7'deki 10 testin hepsi (9. madde fuzz).
- script/Deploy.s.sol: §6.8 (MockUSDC → PredictionMarket(usdc, agent, treasury) → agent'a 10.000 mint),
  adresleri deployments/fuji.json'a yaz: {chainId, usdc, pm, agent, owner, deployBlock}.

Önce: fonksiyon imzaları + event'ler + durum geçiş tablosundan oluşan kısa bir plan göster.
Onayımdan sonra yaz. Bitince `forge build` ve `forge test -vv` çalıştır, sonucu göster.
Ayrıca web ve agent ekibi için ABI'yı contracts/out'tan agent/src/chain/abi.ts ve web/lib/abi.ts
dosyalarına export eden küçük bir script (scripts/export-abi.sh veya .mjs) ekle.
```

**Kabul:** 10 test yeşil · ABI export scripti çalışıyor · commit `feat(contracts): prediction market + mock usdc`.

**Doğrulama:** `cd contracts && forge test -vv` · elle oku: `finalize` Void kuralları, `claim` formülü.

---

### F2 — Fuji deploy + verify (20 dk)

**Opus promptu:**
```
F2: Fuji deploy. contracts/.env.example oluştur (FUJI_RPC_URL, DEPLOYER_PRIVATE_KEY, AGENT_ADDRESS,
TREASURY_ADDRESS, SNOWTRACE/ROUTESCAN verify ayarları). Gerçek .env'i ben dolduracağım, sen okuma.
Bana çalıştırmam gereken deploy ve verify komutlarını sırayla ver
(forge script ... --broadcast, forge verify-contract ... Routescan/Snowtrace Fuji için doğru verifier-url).
Deploy sonrası deployments/fuji.json'un doğru dolduğunu ve iki kontratın da explorer'da verified
olduğunu kontrol eden bir kontrol listesi hazırla. ABI export scriptini çalıştır.
```
Deploy komutunu **sen** çalıştır (özel anahtar sende).

**Kabul:** İki kontrat verified · `deployments/fuji.json` repoda · agent cüzdanında 10.000 kUSDC · commit.

---

### F3 — Agent çekirdeği + Resolver + verify aracı (70 dk)

**Amaç:** LLM'siz kısmın uçtan uca çalışması: elle açılan bir market otomatik çözülür, kanıtlanır, doğrulanır.

**Opus promptu (plan modunda başlat):**
```
F3: Agent çekirdeği ve Resolver. docs/MIMARI.md §5, §7.1, §7.3, §7.6, §8, §9, §13, §14'e uy.
agent/ altında Node 20 + TypeScript (ESM) projesi kur: viem, zod, fastify, vitest.

Yazılacaklar:
1. config.ts: §14 env şeması (zod), eksik/yanlış env'de anlaşılır hata.
2. atk/cli.ts: `okx` CLI'ını child_process ile --json çağıran sarmalayıcı; OKX_SITE parametreli;
   timeout + retry (exponential backoff); her çağrıyı atk/counter.ts'e kaydet (araç adı, süre, ok/hata).
   F0'da doğrulanan gerçek komut sözdizimini kullan.
3. chain/: viem public+wallet client (fallback RPC), abi.ts, markets.ts (marketCount, getMarket,
   aktif/vadesi gelmiş market listesi, createMarket, proposeResolution, finalize, bet).
4. templates/: ortak arayüz {id, name, paramsSchema, encode, decode, questionTR, resolve}.
   Şimdilik 1 PRICE_ABOVE ve 2 FUNDING_POSITIVE. §5.2 zaman kuralları ve §5.4 çapraz kontrol.
   Hesaplar bigint / decimal string ile.
5. evidence/: canonical.ts (sıralı anahtar, boşluksuz, sayılar string), build.ts (§9.1 core+meta),
   store.ts (agent/data/evidence/<id>.json). evidenceHash = keccak256(utf8(canonical(core))).
6. resolver/loop.ts: §7.3 adımları; Void kuralları; finalize.
7. feed/store.ts: JSON dosya tabanlı olay deposu (append + son N kayıt).
8. server/index.ts: §7.6 endpoint'leri (/health, /api/feed, /api/stream SSE, /api/markets/:id/meta,
   /evidence/:id.json, /api/stats), CORS env'den.
9. index.ts: resolver döngüsü + sunucu; PAUSE_AGENT ve DRY_RUN desteği.
10. scripts/: create-manual.ts (CLI argümanlarıyla şablonlu market aç — agent cüzdanıyla),
    resolver-once.ts, verify.ts (§9.3: zincirden oku → aynı şablon koduyla yeniden çek → hash karşılaştır).
11. test/: canonical JSON deterministikliği, PRICE_ABOVE ve FUNDING_POSITIVE resolve mantığı
    (sahte CLI çıktısıyla), Void durumları.

Bitince uçtan uca deneme: create-manual ile resolveTime'ı 5 dk sonra olan bir PRICE_ABOVE marketi aç,
resolver'ı çalıştır, propose + finalize tx'lerini ve evidence dosyasını göster, verify ✅ olsun.
Gizli dosyaları okuma; .env.example oluştur.
```

**Kabul:** vitest yeşil · Fuji'de en az 1 market `Finalized`, kanıt hash'i zincirde · `npm run verify -- <id>` ✅ · `/health` ve `/api/feed` çalışıyor · commit.

---

### F4 — Scout: LLM + ATK MCP (60 dk)

**Amaç:** Agent'ın kendi başına market açması — otonomi puanının kalbi.

**Opus promptu (plan modunda başlat):**
```
F4: Scout. docs/MIMARI.md §7.2, §7.5, §8.2, §8.3'e uy. claude-api becerisini/dokümanını kontrol et
ve @anthropic-ai/sdk ile tool use kullan; model AGENT_MODEL env'den (varsayılan claude-sonnet-5-5).

Yazılacaklar:
1. atk/mcp.ts: @modelcontextprotocol/sdk StdioClientTransport ile iki süreç:
   `okx-trade-mcp --site global --modules market` ve `okx-trade-mcp --site tr --modules market`.
   tools/list → §7.2'deki allowlist'e göre filtrele → isimlere global__ / tr__ öneki ekle →
   Anthropic tool formatına çevir. tool çağrısını doğru sürece yönlendir, sonucu kısalt (token bütçesi),
   counter.ts'e kaydet.
2. scout/tools.ts: list_open_markets, propose_market (§7.2 JSON şeması, zod ile doğrula).
3. scout/prompt.ts: §7.2 sistem promptu (Türkçe gerekçe), şablon kataloğu ve izinli enstrümanlar
   bağlam olarak eklenir; şu anki UTC zamanı verilir.
4. scout/loop.ts: en fazla SCOUT_MAX_STEPS adımlık tool döngüsü; propose_market → policy;
   ret → 1 düzeltme hakkı; kabul → soru metnini ŞABLONDAN üret → createMarket (metadataURI =
   PUBLIC_BASE_URL/api/markets/<id>/meta) → seed likidite (§7.2 adım 6) → feed kaydı
   (gerekçe, myProbability, araç izi, tx). "Uygun market yok" sonucu da feed'e yazılır.
5. policy/index.ts: §7.5 tablosunun tamamı + birim testleri.
6. scripts/scout-once.ts ve index.ts'e scout döngüsü.

Önce DRY_RUN=1 ile bir kez çalıştır: araç izi ve önerilen market JSON'unu göster.
Onayımdan sonra gerçek modda bir market açtır.
```

**Kabul:** Agent en az 1 marketi kendi başına açtı (tx + gerekçe + araç izi feed'de) · policy testleri yeşil · seed bet'ler zincirde · commit.

**Not:** Token tüketimini izle; şemalar büyükse allowlist'i daralt veya araç sonuçlarını özetle.

---

### F4.5 — KAHİN Oracle MCP servisi + OKX.AI listeleme kartı (35 dk)

**Amaç:** Jüri tablosundaki "Could be listed as a service on OKX.AI" (5 puan) maddesini somut bir çalışan servisle karşılamak. Resolver'ın şablon kodu yeniden kullanılır.

**Opus promptu:**
```
F4.5: KAHİN Oracle MCP servisi. docs/MIMARI.md §7.7'ye birebir uy.
1. agent/src/oracle-mcp/server.ts: @modelcontextprotocol/sdk ile MCP sunucusu.
   Araçlar: list_templates, resolve_metric, get_market, get_forecast (şemalar zod; çıktılar JSON).
   resolve_metric, resolver'ın templates/ ve evidence/ kodunu AYNEN kullanır (kod kopyalama yok);
   resolveTime gelecekteyse hata; sonuçta outcome + evidence.core + evidenceHash + ATK komutları.
   Yalnız okuma: zincire yazma ve emir verme YOK.
2. İki taşıma: stdio (`npm run oracle:stdio`) ve Streamable HTTP (agent sunucusunda /mcp yolu,
   IP başı dakikada 30 istek limiti). HTTP zaman alırsa önce stdio'yu bitir.
3. docs/OKXAI_LISTING.md: OKX.AI A2MCP ASP listeleme kartı — ad, tek cümle açıklama, hedef tüketiciler,
   araç listesi + girdi/çıktı şemaları + örnek çağrı/yanıt, fiyat (§7.7 tablosu), SLA, hata kodları,
   güvenlik/sınırlar, "bugün yapılmayanlar: gerçek kayıt, staking, x402 tahsilatı (X Layer)" ve
   kayıt adımları (resmî OKX.AI ASP/registerasp dokümanına link; içeriği uydurma, emin olmadığın
   adımı "doğrulanacak" diye işaretle).
4. Uçtan uca test: Claude Code'a bu sunucuyu MCP olarak ekleme komutunu ver
   (claude mcp add --transport stdio kahin-oracle -- ...), sonra çözülmüş bir market için
   resolve_metric çağrısının zincirdeki evidenceHash ile aynı hash'i döndürdüğünü göster.
```

**Kabul:** Claude Code'dan `resolve_metric` çağrısı zincirdeki hash'le eşleşen sonuç döndürüyor · `docs/OKXAI_LISTING.md` tamam · (zaman varsa) HTTP `/mcp` tünel URL'sinden erişilebilir · commit.

---

### F5 — Web arayüzü (paralel, ~2–3 saat toplam)

**Amaç:** Jürinin telefondan katılabileceği sade, mobil öncelikli arayüz.

**Opus promptu (plan modunda başlat):**
```
F5: Web. docs/MIMARI.md §10'a uy. web/ altında Next.js (App Router) + TypeScript + Tailwind +
wagmi v2 + viem. Fuji (43113) tek zincir, injected connector (Core/MetaMask).
Adresler/ABI: web/lib/abi.ts ve NEXT_PUBLIC_* env (§14).

Sayfalar (öncelik sırasıyla, her biri bitince bana göster):
1. / : açık marketler kartları (soru, kalan süre, havuzlar, ima edilen olasılık, agent tahmini),
   son çözülenler; üstte faucet butonu ve "yanlış ağ" uyarısı.
2. /market/[id] : kurallar kutusu (şablonu insan diliyle anlat), geri sayım, bet paneli
   (approve tutar kadar + bet), durum çizelgesi, "Agent neden açtı?" (agent API meta),
   kanıt kartı (gözlemler, kural, sonuç, hash, Snowtrace linkleri, kopyalanabilir verify komutu),
   claim ve dispute butonları.
3. /agent : SSE canlı akış, ATK araç kullanım sayaçları (/api/stats), agent adresi ve bakiyeler.
4. /verify : evidence JSON'unu indir, tarayıcıda canonical JSON + keccak256 ile hash'le,
   zincirdeki evidenceHash ile karşılaştır (agent/src/evidence/canonical.ts ile AYNI algoritma).
5. Onay süresi göstergesi (MIMARI §1.5, §10): her kullanıcı tx'inde gönderim→onay süresini ölç,
   toast'ta "X sn'de kesinleşti" göster; /agent sayfasında agent tx'lerinin ortalama onay süresi kartı
   (feed'deki süreler). Bu, jürinin "Avalanche'ın güçlü yanları" kriterinin kanıtı — atlama.
6. /oracle : docs/OKXAI_LISTING.md içeriğinden servis kartı (araçlar, fiyat, MCP adresi,
   örnek resolve_metric çağrısı ve yanıtı). F4.5 bitince bağlanır; o zamana kadar statik içerik.

Kurallar: "bahis" kelimesi yok ("tahmin", "pozisyon", "olasılık"); saatler Europe/Istanbul;
her tx sonrası explorer linki; agent API erişilemezse zarif uyarı, zincir verisi çalışmaya devam eder.
Mobilde 375px genişlikte düzgün görünmeli. Vercel deploy için gerekli ayarları ve env listesini ver.
```

**Kabul:** Telefonda: bağlan → faucet → tahmin → (çözülmüş markette) claim · kanıt kartı ve verify sayfası hash eşleşmesini gösteriyor · onay süresi toast'ı ve ortalama kartı görünüyor · `/oracle` sayfası var · Vercel'de yayında · commit.

---

### F6 — Demo marketlerini açma (17:00–17:20, ZAMAN KRİTİK)

**Amaç:** Sunum sırasında (20:00–21:30) gerçekten çözülen marketler olması + gün boyu birikmiş geçmiş.

**Yapılacak:**
- Agent'ın Scout döngüsü açık kalsın (gün içi geçmiş birikir).
- Ek olarak, `resolveTime`'ı **20:05, 20:25, 20:45, 21:05, 21:25** olan 5 market (karışık şablon) — Scout'a bu zaman aralığını bağlam olarak verip açtır; olmazsa `create-manual`.
- Kendi 2–3 test cüzdanınla bu marketlere her iki taraftan küçük tahminler koy (havuzlar boş görünmesin).
- Cloudflare tunnel'ı başlat, URL'yi Vercel env'e koy, redeploy.

**Opus promptu:**
```
F6: Demo hazırlığı. Şu an saat <SAAT>. Sunumlar 20:00–21:30 arası (Europe/Istanbul).
1. Scout'a ek bağlam ver: "resolveTime 20:05–21:25 arasında olsun" ve 3 market açtır;
   eksik kalanları create-manual ile tamamla (karışık PRICE_ABOVE / FUNDING_POSITIVE;
   funding için gerçek bir sonraki funding zamanını kullan).
2. Açılan marketlerin listesini (id, soru, closeTime/resolveTime TR saatiyle, tx) tablo olarak ver.
3. Agent sürecinin akşam boyunca kesintisiz çalışması için kontrol listesi
   (bilgisayar uykuya geçmesin, tunnel, /health, AVAX bakiyesi, log dosyası).
```

**Kabul:** 5 market açık, takvim tablosu hazır, tunnel URL web'de çalışıyor.

---

### F7 — Hedger: OKX TR spot (Bonus 1, 30–40 dk)

**Ön koşul:** OKX TR yarışma hesabı/profili hazır, F0'da spot CLI sözdizimi doğrulanmış.

**Opus promptu:**
```
F7: Hedger. docs/MIMARI.md §7.4 ve §12'ye birebir uy.
1. hedger/loop.ts: zincirden agent'ın seed pozisyonları → exposureUp → hedef → fark >= HEDGE_MIN_STEP ise
   emir planı. Emirden önce orderbook + account trade fee ile maliyet tahmini.
2. Emir: atk/cli.ts üzerinden `OKX_SITE=tr okx spot place ...` (F0'da doğrulanan sözdizimi),
   profil OKX_TR_PROFILE. Tavanlar: HEDGE_MAX_NOTIONAL, HEDGE_RATIO. Spot'ta açığa satış yok:
   satış ancak eldeki BTC kadar; yoksa atla ve feed'e yaz.
3. HEDGE_ENABLED=0 iken yalnız planı feed'e yazan "dry" mod.
4. Birim test: exposure ve hedef hesabı.
Önce HEDGE_ENABLED=0 ile bir döngü çalıştır ve planı göster. GERÇEK EMİR İÇİN AÇIK ONAYIMI BEKLE.
```

**Kabul:** En az 1 gerçek spot emir (emir ID'si feed'de ve README'de) **veya** dry-mode planı + gerekçesi (hesap yoksa).

---

### F8 — README, video, teslim (18:30–19:00)

**Opus promptu:**
```
F8: Teslim. README.md'yi jüri için yaz (Türkçe, kısa ve taranabilir):
- Tek cümle + problem + çözüm
- Mimari şeması (docs/MIMARI.md §4'ten sadeleştirilmiş)
- Nasıl çalışır: 3 rol, şablonlar, kanıt + verify
- Canlı linkler: web (Vercel), Fuji kontrat adresleri (Snowtrace), örnek create/propose/finalize tx'leri,
  örnek evidence JSON, hedge emir ID'si (varsa)
- Kullanılan ATK araçları + /api/stats'tan bugünkü çağrı sayıları
- "Jüri kriterleri" bölümü: docs/MIMARI.md §16.1 tablosunun her alt kriteri için tek satırlık kanıt + link
- Hedef kullanıcı, iş modeli, 90 günlük pazara çıkış (§1.4)
- Neden Avalanche (§1.5) + ölçülen ortalama onay süresi
- OKX.AI: KAHİN Oracle MCP servisi, bağlantı komutu, docs/OKXAI_LISTING.md linki
- Güvenlik (§12 özeti), bilinen sınırlar, yol haritası (§19)
- Kurulum: contracts / agent / web adımları, .env.example'lar
Gerçek adres ve tx'leri deployments/fuji.json ve feed'den al; uydurma veri koyma.
Sonra repo genelinde gizli bilgi taraması yap (özel anahtar, api key kalıpları) ve raporla.
```

**Elle:** 2 dk yedek demo videosu (ekran kaydı: market açılışı → tahmin → çözüm → verify) · teslim formunu doldur · son commit + tag `v1.0-hackathon`.

---

### F9 — (Opsiyonel) Ek şablonlar (her biri ~15–20 dk)

Sıra: `PRICE_MOVE` → `TRY_PREMIUM_ABOVE` → `OI_CHANGE`.

```
F9: docs/MIMARI.md §5.3'teki <ŞABLON> şablonunu ekle: templates/<dosya>.ts (schema, encode/decode,
questionTR, resolve), birim testleri, policy'de izinli şablonlar listesine ekle, web'de kurallar kutusu
metni. Mevcut şablonların davranışını değiştirme. verify ile uçtan uca test et.
```

---

### F10 — (Opsiyonel) ERC-8004 agent kimliği (~30 dk)

```
F10: Agent cüzdanını Fuji ERC-8004 Identity Registry'ye kaydet. Önce registry adresini ve ABI'yı
resmî/güvenilir kaynaktan doğrula (docs/MIMARI.md'deki adres topluluk kaynağından, doğrulanmamış).
Kayıt dosyası (registration JSON: ad, açıklama, endpoint = PUBLIC_BASE_URL, desteklenen şablonlar)
agent API'den servis edilsin. Kayıt tx'ini bana göster, onayımla gönder. Web /agent sayfasına
"ERC-8004 Agent #<id>" rozeti ekle. Reputation/Validation yazımı bu fazda YOK.
```

---

### F11 — (DURUMA GÖRE) Gizlilik: mühürlü tahminler

> **Bu faz yalnız MVP sağlamsa ve saat 18:15'ten önceyse başlatılır.** Yetişmezse sunumda "yol haritası" olarak anlatılır (mimari §19).

**Fikir:** Market açıkken tahminin **yönü** gizli kalır (commit-reveal). Tutar ve adres görünür. Kopyalamayı, sürü davranışını ve son dakika oran manipülasyonunu engeller. Konumlandırma: **"tahmin gizliliği / adil oyun"** — "anonimlik" değil (OKX TR düzenlemeye tabi; kimlik gizliliği önerilmez). "Gizli perp" denmez: kaldıraçsız ve vadeli yapı sayesinde yön gizliliği basit ve güvenli.

**Kritik karar — mevcut kontrat değiştirilemez:**
- **Önerilen yol:** Mevcut `PredictionMarket` dokunulmadan kalır (gün boyu geçmiş korunur). Yanına ayrı bir **`SealedPredictionMarket.sol`** deploy edilir (aynı token, aynı agent). Web iki kontratı da listeler; mühürlü marketler rozetle ayrılır.
- Alternatif (önerilmez): Ana kontratı v2 olarak yeniden deploy etmek → gün içi marketler eski adreste kalır, geçmiş bölünür.

**Kontrat tasarımı (SealedPredictionMarket):**
- `commitBet(id, bytes32 commitment, uint256 amount)`: `commitment = keccak256(abi.encode(id, user, isYes, amount, salt))`; tutar yatırılır; yön bilinmez. `amount` yalnız **sabit değerler**den biri olabilir (10 / 50 / 100 kUSDC) → tutar yönü ele vermez.
- `closeTime` sonrası `revealWindow` (ör. 10 dk): `revealBet(id, isYes, amount, salt)` → havuza eklenir.
- Açıklanmayan commit: `revealPenaltyBps` (ör. %20) kesilerek iade (kaybedeceğini görüp açıklamamak işe yaramasın).
- Çözüm: `resolveTime ≥ closeTime + revealWindow + minResolveGap`; propose / dispute / finalize / claim ana kontratla aynı.
- Testler: commit→reveal→claim, yanlış salt revert, reveal penceresi dışı revert, açıklanmayan commit cezalı iade, sabit tutar dışı revert.

**Web:**
- Mühürlü markette canlı oran yerine **agent'ın tahmini** gösterilir; havuzlar reveal sonrası açılır.
- Salt tarayıcıda üretilir ve `localStorage`'da (try/catch) saklanır + kullanıcıya "kurtarma kodu" olarak indirilebilir.
- `closeTime` sonrası sayfa açıksa **otomatik reveal**; değilse kullanıcı geri geldiğinde "Açıkla" butonu.

**Agent:**
- Scout'a "mühürlü" bayrağı: politika ile yalnız belirli marketler (ör. her 3 marketten 1'i).
- Seed likidite mühürlü markette de commit-reveal ile yapılır (agent salt'ı kendi deposunda tutar ve reveal penceresinde açıklar).

**Opus promptu (plan modunda başlat):**
```
F11: Gizlilik — mühürlü tahminler. docs/PLAN.md F11 bölümüne birebir uy.
Mevcut PredictionMarket.sol'e DOKUNMA. contracts/src/SealedPredictionMarket.sol yaz
(propose/dispute/finalize/claim mantığını ana kontratla tutarlı tut; mümkünse ortak bir abstract
base kontrata çıkarmadan, kopyalayarak ama farkları açıkça yorumla — mevcut deploy'u bozmamak için).
Testler: F11'de listelenen 5 test + ana kontrattaki mutlu yol testinin mühürlü versiyonu.
Deploy scriptini ayrı yaz, deployments/fuji.json'a "sealedPm" alanı olarak ekle.
Sonra agent (seed commit/reveal + reveal döngüsü) ve web (commit, otomatik reveal, rozet) değişikliklerini
ayrı adımlar halinde planla. Her adımdan sonra durup onayımı al.
Sunum dili: "tahmin gizliliği", "anonimlik" değil.
```

**Kabul:** Fuji'de verified `SealedPredictionMarket` · en az 1 mühürlü market commit → reveal → çözüm → claim tamamlandı · web'de rozet ve otomatik reveal çalışıyor.

---

## 5. Kontrol / inceleme promptları

**Faz sonu incelemesi (her fazdan sonra):**
```
Bu fazın kabul kriterlerini docs/PLAN.md'den tek tek oku ve her biri için kanıtla
(komut çıktısı / dosya / tx hash) ✅ veya ❌ ver. ❌ olanları düzeltmeden commit yapma.
Ayrıca docs/MIMARI.md ile çelişen bir şey yaptıysak listele.
```

**Güvenlik taraması (F3, F7, F8 sonrası):**
```
Repo genelinde: gizli bilgi sızıntısı (anahtar kalıpları, .env commit'i), LLM'e giden bağlamda
anahtar/hesap verisi olup olmadığı, zincire yazan ve OKX'te emir veren tüm kod yollarının
yalnız deterministik koddan ve tavanlarla geçtiğini kontrol et. Bulguları dosya:satır ile raporla.
```

**Kontrat incelemesi (F1 sonrası, F11 sonrası):**
```
PredictionMarket.sol'ü bir denetçi gözüyle incele: reentrancy, yuvarlama, Void kenar durumları,
dispute bond akışı, zaman kontrolleri, owner yetkileri. Her bulgu için senaryo + test önerisi ver.
Düzeltmeleri onayımla uygula.
```

**Demo provası (18:00 civarı):**
```
docs/MIMARI.md §17 demo senaryosunu adım adım gerçek sistem üzerinde çalıştır (komut/URL düzeyinde),
her adım için çalışıyor/çalışmıyor raporla ve bozuk adımlar için yedek plan öner.
```

---

## 6. Sunum hazırlığı kontrol listesi
- [ ] QR kod (web URL) slaytta ve ayrıca çıktı/telefon ekranında
- [ ] Sunum sırasında çözülecek marketin id'si ve saati not edildi
- [ ] Terminalde `npm run verify -- <id>` hazır
- [ ] `/agent` sayfası ikinci ekranda açık
- [ ] Snowtrace sekmeleri: kontrat, bir create, bir propose, bir finalize tx
- [ ] 2 dk yedek video
- [ ] Rakamlar: bugün açılan / çözülen market, ATK çağrı sayısı, kullanılan araç sayısı, **ortalama onay süresi**
- [ ] Claude Code'da `kahin-oracle` MCP bağlı; `resolve_metric` canlı çağrısı hazır
- [ ] Slaytlar: hedef kullanıcı · iş modeli · 90 günlük pazara çıkış · neden Avalanche · OKX.AI listeleme kartı
- [ ] Jüri tablosundaki 16 alt kriterin her biri için sunumda en az bir kanıt anı var (mimari §16.1)
- [ ] Jüri soru-cevapları (mimari §18) ezber
- [ ] GitHub ilk commit saati (bugün sabah) gösterilebilir
- [ ] "Bahis" kelimesi slaytlarda yok

---

## 7. Acil durum

| Sorun | Hızlı çözüm |
|---|---|
| ATK CLI çalışmıyor | `--ignore-scripts` ile yeniden kur; MCP yerine CLI ya da tersi |
| Claude API kotası / hata | Scout'u durdur, marketleri `create-manual` ile aç; Resolver LLM'siz çalışmaya devam eder |
| Fuji RPC yavaş | Fallback RPC; agent tx'lerinde gas'ı biraz artır |
| Kontrat hatası deploy sonrası | Yeni adresle redeploy; `deployments/fuji.json` + web env + agent restart (gün içi geçmiş eski adreste kalır, README'de iki adresi de yaz) |
| Tunnel düştü | `cloudflared` yeniden başlat, yeni URL'yi Vercel env'e koy, redeploy; acil durumda web'i lokalde aç |
| Web Vercel'de kırık | Lokal `npm run dev` + aynı ağdan IP ile telefon erişimi |
| Sunumda market çözülmedi | Önceden çözülmüş bir marketin kanıt kartı + verify; yedek video |
| OKX TR hesabı yok | F7'yi dry-mode olarak göster; Bonus 1'i "planlanmış emir + maliyet hesabı" ile anlat |
