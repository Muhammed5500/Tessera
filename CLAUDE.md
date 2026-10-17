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
