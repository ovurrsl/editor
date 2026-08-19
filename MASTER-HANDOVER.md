# NİHAİ PROJE DEVİR (MASTER HANDOVER) RAPORU

**Tarih:** 19 Ağustos 2026 · **Devreden:** Claude (Claude Code)
**Canlı sürüm:** `opex.help` · **Son yayın:** deploy #58 (`a9294706`)

> Bu belge **devir özeti**dir: mimarinin nasıl çalıştığı, en son ne yapıldığı,
> nelere dokunulmaması gerektiği ve sıradaki işler.
>
> **Dosya-satır düzeyinde ayrıntı için `PROJECT_HANDOVER.md`** (aynı depo kökü,
> 1406 satır, 12 bölüm) — mimari kuralları, veri akışı, UI/stil standartları,
> `.env` şablonları, dağıtım ve test mimarisi orada tam hâliyle var. Burada onu
> tekrarlamıyor, üstüne **karar gerekçelerini ve tuzakları** koyuyorum.
>
> Diğer kalıcı kaynaklar: `FORK-DENETIMI.md` (upstream'den sapmalarımız),
> `OTOMASYON.md` (hangi workflow ne zaman koşar), `UPSTREAM.md` (dosya-bazlı
> merge kuralları), `AGENTS.md`/`CLAUDE.md` (katman sınırları).

---

## 0. Devir anındaki durum — dürüst özet

| Konu | Durum |
|---|---|
| Hayalet kot kayması (#55) | ✅ **Bitti**, CI yeşil, canlıya alındı |
| 2B yerleştirme hayaleti (eklenti) | ✅ Bitti (PR #30) |
| Konveyör hayaletleri → ekran kararması | ✅ Bitti (PR #30) |
| Kilit kapıları (silme + çoğaltma) | ✅ Bitti, canlıda |
| Fork koruma testleri (26 bekçi) | ✅ Bitti |
| **2B tazelenme (#50-D3)** | ❌ **Yarım — kök neden kanıtlanamadı** (§6.4) |
| Mükerrer düğüm yolları (#52) | ❌ Teşhis var, düzeltme yok |
| Upstream merge (41 commit) | ⏸ Ertelendi, zemin hazır |
| **Digitaltwin `.env` sırları git'te** | 🔴 **Açık güvenlik riski** (§5.1) |

**Tamamlanmamış tek kodlama işi #50-D3'tür ve nedenini açıkça yazıyorum:**
kök nedeni kanıtlamak çalışma zamanı gözlemi istiyor; çalıştığım konteynerde
`apps/editor` **derlenemiyor** (iki özel GitHub bağımlılığı proxy'den 403
dönüyor: `@mint/pascal-plugin`, `@pascal-app/plugin-trees`) ve veritabanı yok.
Üç adaydan ikisini kanıtla eledim; üçüncüsü ölçüm istiyor. **Tahminle düzeltme
yazmadım** — ayrıntı ve ölçüm reçetesi §6.4'te.

---

## 1. GENEL DURUM VE MİMARİ ÖZETİ

### 1.1 Projenin amacı

**DigitalTwin** — depo/lojistik tesisleri için tarayıcıda çalışan 3B tasarım
SaaS'ı. Kullanıcı bir bina çizer, katlar tanımlar, içine raf sistemleri,
konveyörler, paletler, tezgâhlar yerleştirir; hem 3B hem 2B plan görünümünde
çalışır; sahneyi paylaşır, yedekler, dışa aktarır.

### 1.2 Dört depo ve aralarındaki ilişki

```
   pascalorg/editor  (upstream, açık kaynak)
            │  günlük ayna + PR (mirror-upstream)
            ▼
   ovurrsl/editor  ◄── saatlik ── ovurrsl/panel        (konsol kaynağı)
      (fork, ASIL)  ◄── saatlik ── ovurrsl/plugin-warehouse (depo ekipmanı)
            │
            │ deploy-bundle (derleme + 2 duman testi)
            ▼
   ovurrsl/Digitaltwin  ──► Hostinger ──► opex.help
   (derlenmiş artefakt, kaynak DEĞİL)
```

| Depo | Rolü | Yazılır mı? |
|---|---|---|
| `ovurrsl/editor` | **Ana geliştirme.** Monorepo: `packages/{core,viewer,editor,nodes,mcp}` + `apps/editor` | ✅ Evet — `integration` dalı |
| `ovurrsl/plugin-warehouse` | 21 `warehouse:` node kind'ı, plugin API v1 | ✅ Evet — `main` dalı |
| `ovurrsl/panel` | DigitalTwin Console (yönetim paneli) kaynağı | ✅ Evet — ama editöre **vendor**'lanır |
| `ovurrsl/Digitaltwin` | Üretim build çıktısı | ❌ **Asla elle** — `deploy-bundle` force-push'lar |

### 1.3 Dört kural (bilinmeyince zarar verenler)

1. **Varsayılan dal `integration`.** `main` upstream'in **birebir aynası** —
   oraya commit atmak aynayı kilitler.
2. **`apps/editor/panel/**` vendor'dır**, burada yazılmaz — evi `ovurrsl/panel`.
   Saatlik `pull-panel` üzerine yazar.
3. **`GITHUB_TOKEN` ile yapılan push hiçbir workflow tetiklemez.** Push edip
   build bekleyen her workflow, deploy'u **açıkça dispatch etmek zorunda**.
4. Üç şey otomatik akar, elle yapılmaz: eklenti pin'i (`bump-plugin`, saatlik),
   konsol (`pull-panel`, saatlik), upstream (`mirror-upstream`, günlük — merge
   etmez, PR açar).

### 1.4 Monorepo katmanları (ihlali sessizce bozar)

| Paket | Sahibi olduğu şey | **İthal edemeyeceği** |
|---|---|---|
| `packages/core` | Sahne grafiği, şemalar, store'lar, saf mantık | Three.js, viewer, editor, araç/mod/faz kavramları |
| `packages/viewer` | 3B tuval, renderer'lar, viewer sistemleri | `useEditor`, araçlar, faz/mod, floorplan |
| `packages/editor` | Düzenleme deneyimi: araçlar, paneller, kısayollar | — |
| `packages/nodes` | Yerleşik node kind'ları | — |
| `packages/mcp` | MCP sunucusu + sahne depoları (MySQL/SQLite) | — |
| `apps/editor` | Next.js uygulaması, kompozisyon | — |

Ayrıntı: `wiki/architecture/` (20 sayfa). **Mimariye dokunmadan önce ilgili
sayfayı oku** — hangi değişiklik hangi sayfayı gerektirir, `AGENTS.md`'de yazıyor.

### 1.5 Ayağa kalkma (boot) süreci

```
apps/editor/lib/bootstrap.ts   (import anında koşar)
  1. extendPluginDiscovery(mint)      + registerEditorHostPanel(mintHostPanel)
  2. extendPluginDiscovery(warehouse) + registerEditorHostPanel(warehouseCatalogPanel)
     ↑ İkisi de loadExternalPlugins()'ten ÖNCE olmak ZORUNDA:
       o fonksiyon modül-kapanışı bayrağıyla import anında ateşleniyor,
       sonra yapılan kayıt sessizce hiçbir şey yapmıyor.
  3. loadBuiltinsSync()        ← senkron; ilk SSR/hydration boş registry görmesin
  4. void loadExternalPlugins()← asenkron; eklenti kind'larını nodeRegistry'ye basar
```

Sonra: sahne yüklenir → `applySceneGraphToEditor` (`packages/editor/src/lib/scene.ts:385`)
→ `useScene.setScene(nodes, rootNodeIds, { installedPlugins, ... })`.

### 1.6 Veri akışı ve state

**Üç zustand store'u — hangi verinin nerede yaşadığı ezberlenmeli:**

| Store | Paket | İçerik |
|---|---|---|
| `useScene` | core | **Sahne verisi**: `nodes`, `rootNodeIds`, `collections`, `materials`, `installedPlugins`. Persist + zundo (undo/redo) |
| `useViewer` | viewer | Sunum + seçim: `selection.{buildingId,levelId,selectedIds}`, `levelMode`, ayrıca **fork'a özel** `sceneLocked`, `lockedCategories`, `hiddenCategories` |
| `useEditor` | editor | Düzenleme kipi: `mode`, `tool`, `viewMode` (`'3d'\|'2d'\|'split'`), ızgara ayarları |

**Sahne kalıcılığı:** editör → `/api/scenes` → `packages/mcp/src/storage/mysql-scene-store.ts`
→ MySQL. **Üretimde SQLite fallback YOKTUR** — MySQL yapılandırılmamışsa sunucu
açılmayı reddeder (bilinçli: sessizce dosyaya yazıp her sürümde kaybetmektense
gürültülü çökmek).

**Kimlik:** konsol (`panel`) oturum çerezi üretir, editör `apps/editor/lib/auth/{session,guard}.ts`
üzerinden aynı çerezi doğrular. Tek süreç, tek origin — bu yüzden CORS yok.

---

## 2. AZ ÖNCE TAMAMLADIĞIM İŞ

### 2.1 Son görev: **yerleştirme hayaleti aktif katın kotunda çizilmiyordu** (#55)

**Belirti (kullanıcının bildirdiği):** Bir nesne yerleştirirken hayalet imleci
takip ediyor ama **imlecin altında** duruyor. Tıklayınca nesne **doğru** yere
oturuyor. Yani yanlış olan yerleştirme değil, **önizleme**.

**Kök neden.** Üç koordinat çerçevesi sessizce karışıyordu:

| Çerçeve | Ne demek |
|---|---|
| **Dünya** | Sahnenin mutlak uzayı |
| **Bina-yerel** | Bina dönüşümü uygulanmış |
| **Kat-yerel** | + katın kotu uygulanmış — düğümlerin `position`'ı bu çerçevede |

Araçların ürettiği her konum **kat-yereldir**: commit edilen düğüm katın altına
parent'lanır ve kotu ebeveyninden alır. Ama hayalet, `ToolManager`'ın grubunda
çiziliyor ve **o grup yalnız bina dönüşümünü uyguluyor**. Aradaki fark tam
olarak aktif katın kotu.

Aktif kat sıfırdaysa fark sıfır — **görünmez**. Kullanıcının sahnesinde bir
bodrum vardı, zemin kat **12,93 m**'ye çıkmıştı; hayalet tam o kadar aşağıda
çiziliyordu. Tek katlı sahnelerde hiç görünmediği için bugüne kadar fark
edilmemiş.

**En ikna edici kanıt upstream'in kendi kodundan geldi:** kotun gerekli olduğu
**üç ayrı katmanda ayrı ayrı keşfedilmiş** ve her seferinde o katmanın içinde
telafi edilmiş —
`alignment-3d-guide-layer.tsx:82`, `elevation-3d-guide-layer.tsx:54`,
`wall-snap-beacon-layer.tsx:122`. `move-roof-tool.tsx` ise aynı dönüşümü
`localPositionToToolLocal` adıyla yazmış ama **yalnız `!isFloorPlaced` dalında**.
Kendi telafisi olmayan her hayalet kayıyordu.

**Denenip elenen iki yanlış yaklaşım** (yeni takım aynı tuzağa düşmesin):

1. ~~Araç grubunu kat-yerel yapmak.~~ Çatıya oturan kind'lar (cupola, skylight,
   dört menfez, solar-panel, `move-roof-tool`) `buildingObj.worldToLocal` ile
   **bilinçli olarak** bina-yerel yazıyor. Grup değişseydi hepsi bozulurdu.
2. ~~Kotu her araca tek tek eklemek.~~ 30+ dosya, ve her yeni araçta unutulur.

**Uygulanan çözüm:** kot **tek bir yere** kondu — `getFloorStackPreviewPosition`.
Adı zaten "preview" ve beş çağıranın hepsi araç grubunda çizilen süsleme besliyor.

### 2.2 Değiştirilen dosyalar

**`ovurrsl/editor`** (PR #29, merge `b4a4885f`):

| Dosya | Ne yapıldı |
|---|---|
| `packages/editor/src/components/tools/shared/floor-stack-preview.ts` | `getFloorStackPreviewPosition` artık aktif katın kotunu ekliyor. Yeni `getStoreyPreviewLift(levelId?)` export'u. Kot, kat nesnesinin Y'sinden okunuyor — sahneden **yeniden hesaplanmıyor** |
| `.../shared/floor-stack-preview.test.ts` **(yeni)** | 4 test; düzeltmesiz hâlde ikisi düşüyor (0 vs 12,93 / 7,25) |
| `.../tools/item/use-placement-coordinator.tsx` | **Çerçeve ayrımı**: yeni `getFloorMeshY` |
| `packages/nodes/src/shared/move-roof-tool.tsx` | **Çerçeve ayrımı**: yeni `getStackedPosition` |
| `.../tools/registry/move-registry-node-tool.tsx` | `localToPlan` dalına da kot |
| `packages/editor/src/lib/edit-lock-coverage.test.ts` **(yeni)** | 21 bekçi |
| `packages/viewer/src/lib/fork-connections.test.ts` **(yeni)** | 4 bekçi |
| `PROJECT_HANDOVER.md`, `FORK-DENETIMI.md` | Dokümanlar |

> **Yol boyunca çıkan ikinci hata.** İki yerde **aynı değer** hem süslemeye hem
> düğümün **kendi mesh'ine** gidiyordu (`use-placement-coordinator:2089/2511`,
> `move-roof-tool:380/499`). Mesh kat altında yaşadığı için kotu ebeveyninden
> zaten alıyor — kot eklenseydi mesh **bir kat yukarı fırlardı**. O çağrılar
> kat-yerel cevaba (`getFloorStackedPosition`) ayrıldı. Bu, düzeltmenin
> kendisinin doğurduğu bir regresyondu ve okuyarak yakalandı.
>
> `canPlaceOnFloor` yalnız XZ okuduğu için çarpışma sorgusu etkilenmiyor —
> kontrol edildi.

**`ovurrsl/plugin-warehouse`** (PR #30, merge `7d3b39c2`):

| Dosya | Ne yapıldı |
|---|---|
| `src/placement.ts` | Yeni `toToolFrame(position, levelId)` |
| 8 araç + `src/pallet/tool.tsx` | Host yardımcısını atlayan 9 yolu `toToolFrame`'e bağladı |
| `src/placement.test.ts` | 2 bekçi test |
| (aynı PR) 19 araç | 2B plan hayaleti: `usePlacementPreview`'a yazıyor |
| (aynı PR) 8 konveyör önizlemesi | Paylaşılan geometriyi `retain` ediyor |
| (aynı PR) `src/conveyor/spiral-geometry.ts` | Merkez kolona vertex rengi |

> **Neden eklenti host'un yeni export'unu kullanmadı:** bu paket **yayınlanmış
> upstream `0.9.2`'ye** karşı tip denetimi yapıyor; fork'a özel bir export orada
> yok. Bu yüzden `toToolFrame` kotu kendisi okuyor.

### 2.3 Doğrulama

| | |
|---|---|
| editor | 2795 test geçti / 0 düştü · `tsc` temiz · `biome` temiz · CI `ci`+`quality` **yeşil** |
| plugin | 2686 test geçti / 0 düştü · `check`+`analyze`+`CodeQL` **yeşil** |
| Canlı | deploy #58 (`a9294706`) |

---

## 3. ÇEVRE DEĞİŞKENLERİ VE ALTYAPI

> **Tam şablonlar `PROJECT_HANDOVER.md` §10'da** (4 depo, her anahtar
> placeholder değerle). Burada yalnız anahtar listesi ve tuzaklar.

### 3.1 Anahtar listesi (değerler gizli)

**`ovurrsl/editor` (dev):** dev için **zorunlu env yok**.
`PORT` · `MINT_PASCAL_HOST_ORIGIN` · `NEXT_PUBLIC_ASSETS_CDN_URL` ·
`SKIP_ENV_VALIDATION` · `DIGITALTWIN_MYSQL_{HOST,PORT,USER,PASSWORD,DATABASE}`
(veya `DIGITALTWIN_MYSQL_URL`) · `DIGITALTWIN_DB_PATH` · `DIGITALTWIN_DATA_DIR`

**`ovurrsl/panel`:**
`DATABASE_{HOST,PORT,USER,PASSWORD,NAME}` · **`SECRET_ENCRYPTION_KEY`** ·
`SESSION_COOKIE_SECURE` · `NEXT_PUBLIC_EDITOR_URL` · `MAIL_TRANSPORT` ·
`MAIL_FROM` · `SMTP_{HOST,PORT,USER,PASSWORD,SECURE}` · `APP_URL` ·
`GITHUB_TOKEN` · `SEED_ADMIN_{USERNAME,EMAIL,PASSWORD}`

**`ovurrsl/plugin-warehouse`:** env **yok**. Yalnız `NODE_ENV` davranışı
değiştirir (yinelenen kind kaydı dev'de uyarır, **üretimde fırlatır**).

**`ovurrsl/Digitaltwin` (üretim):**
`DIGITALTWIN_MYSQL_*` · `SECRET_ENCRYPTION_KEY` · `SESSION_COOKIE_SECURE` ·
`APP_URL` · `NEXT_PUBLIC_APP_URL` · `DIGITALTWIN_ADMIN_EMAIL` ·
`SEED_ADMIN_USERNAME` · `MAIL_*` · `SMTP_*` ·
opsiyonel: `DIGITALTWIN_MAX_SCENE_BYTES` · `DIGITALTWIN_ALLOW_SQLITE` ·
`PORT` · `HOSTNAME` · `KEEP_ALIVE_TIMEOUT`

### 3.2 Env tuzakları

- **`SECRET_ENCRYPTION_KEY` değiştirilirse mevcut tüm 2FA/TOTP gizli anahtarları
  okunamaz hâle gelir** — kullanıcılar yeniden kayıt olmak zorunda kalır.
- Üretimde env yükleme sırası: gerçek env > `server.js` yanındaki `.env`
  (her sürümde silinir) > **`~/.digitaltwin.env` (sürümler arası kalır —
  tercih edilen yer)**. `DIGITALTWIN_ENV_FILE` yolu ezer.
- Her `DIGITALTWIN_*` bir `PASCAL_*` takma adıyla da okunur.
- `panel/src/lib/db.ts` zinciri `DIGITALTWIN_MYSQL_*` → `PASCAL_MYSQL_*` →
  `DATABASE_*`; ama **`scripts/migrate.ts` ve `scripts/seed.ts` yalnız
  `DATABASE_*` okur.**
- `DIGITALTWIN_ALLOW_SQLITE=1` **üretimde asla** — dosya her sürümde silinir.

### 3.3 Sunucu / altyapı

**Docker yok, PM2 yok, systemd yok, Procfile yok, Vercel yok, AWS yok, Redis yok.**
(Doğrulandı: `ecosystem.config*`, `Dockerfile*`, `docker-compose*`, `*.service`,
`Procfile` — hiçbiri mevcut değil.) Docker bu forkta **bilerek silindi**: SQLite
depolamayı ima ediyordu, oysa fork MySQL zorunlu kılıyor.

| | |
|---|---|
| Barındırma | **Hostinger hPanel Node.js uygulama yöneticisi** |
| Repo / dal | `ovurrsl/digitaltwin` / `main` |
| Node | **22.x** · paket yöneticisi npm |
| Build → start | `npm run build` (`setup-native.mjs`) → `npm start` (`node server.js`) |
| Port | `PORT` (vars. 3000), `HOSTNAME` 0.0.0.0 |
| Veritabanı | **MySQL 8** (InnoDB, utf8mb4). Tablolar ilk bağlantıda oluşturulur |
| Restart / log | **CLI yok** — hPanel arayüzü (Node.js uygulaması → Restart / Runtime log) |

Editör UI, 3B viewer, konsol, tüm `/api/*` ve `public/` **aynı süreçten**
servis edilir.

**Sağlık kontrolü — pratikte gereken tek komut:**
```bash
curl -s https://opex.help/api/health
# {"status":"ok","backend":"mysql","db":"ok","auth":"ok", ...}
```
`backend` ≠ `mysql` → env okunmamış. `db` ≠ `ok` → veritabanı cevap vermiyor.

---

## 4. ÖZEL ÇALIŞTIRMA VE DERLEME KOMUTLARI

```bash
# ── ovurrsl/editor (bun + turbo) ──────────────────────────────
bun install
bun run dev            # apps/editor, PORT=3002
bun run test           # turbo → paket başına `bun test`
bun run check-types    # next typegen && tsc --noEmit
bun run check          # biome check      (check:fix düzeltir)
# tek paket / tek dosya:
bunx tsc --noEmit -p packages/editor/tsconfig.json
bun test packages/editor packages/nodes packages/core packages/viewer

# ── ovurrsl/plugin-warehouse (bun) ────────────────────────────
bun run verify         # ⭐ CI'nin BİREBİR üçlüsü: check-types && biome ci . && bun test
bun test -t "tek tıklama tek yerleştirme"    # ada göre

# ── ovurrsl/panel (npm + vitest) ──────────────────────────────
npm run test           # vitest run
npm run typecheck      # ⚠️ panelin kendi CI'ı YOK — elle koş
npm run db:migrate     # DATABASE_* gerekir
npm run db:seed        # + --dev geliştirici hesapları

# ── ovurrsl/Digitaltwin ───────────────────────────────────────
# Test yok — kaynak değil, build çıktısı.
npm install && npm run build && npm start
```

**Bilinmesi gerekenler:**
- **`bun run verify` eklentide CI ile birebir aynıdır.** Yerelde geçip CI'da
  düşen şey neredeyse her zaman **biçimlendirmedir**: `biome check` (rapor) ile
  `biome ci .` (sıkı) farklı davranır → `bunx biome check --write .`
- **Panelin CI'ı yok.** Tip güvenliği tamamen editördeki `pull-panel`'in
  `check-types` kapısına bağlı; panelde bozuk kod yazılırsa hata **editör
  tarafında** patlar ve saatlik vendor akışı sessizce durur.
- Editör ve eklenti `bun test`, panel `vitest` kullanır. Vendoring motoru
  (`scripts/sync-panel.mjs`) testleri iki yön arasında **hiç taşımaz**.

---

## 5. MİMARİ UYARILAR, TEKNİK BORÇLAR VE GEÇİCİ YAMALAR

### 5.1 🔴 ÖNCE BU: canlı sırlar git geçmişinde

`ovurrsl/Digitaltwin` deposunda **`.env` canlı üretim kimlik bilgileriyle
commit edilmiş** (MySQL kullanıcı/parola, `SECRET_ENCRYPTION_KEY`, SMTP parolası
— ki DB parolasıyla aynı — ve yönetici e-postası).

Yapılacaklar, bu sırayla:
1. MySQL parolasını ve SMTP parolasını **rotate et** (ayrı parolalar kullan).
2. Sırları `~/.digitaltwin.env`'e taşı (sürümler arası kalır, repoda değil).
3. `.env`'i git geçmişinden temizle (`git filter-repo`) ve force-push et.
4. **`SECRET_ENCRYPTION_KEY`'i rotate edersen mevcut tüm 2FA kayıtları ölür** —
   kullanıcılara önceden haber ver ve yeniden kayıt akışı planla.

### 5.2 "Şuraya dokunmayın, kırılır"

**`main` dalı (editor).** Upstream'in birebir aynası. Buraya atılan bir commit
`mirror-upstream`'i kilitler; force etmez, **elle müdahale gerektirir**.

**`apps/editor/panel/**`.** Vendor. Burada yapılan düzenleme bir sonraki saatlik
`pull-panel` ile silinir. Evi `ovurrsl/panel`.

**Paylaşılan geometri havuzu (eklenti).** Bir raf şekli, o şekli paylaşan **her**
raf'a aittir. `dispose()` **asla elle çağrılmaz** — serbest bırakma yalnız
`geometry-builder.ts` içindeki süpürme ile, hiçbir tutan kalmadıktan
`SWEEP_GRACE_MS = 5000` sonra olur.

**Geometri cache anahtarı.** Anahtar, builder'ın **ürettiğini** tarif etmeli,
şemanın söylediğini değil. Mesh'i değiştirip anahtarı değiştirmeyen bir alan,
görsel olarak farklı iki rafın tek geometriyi paylaşmasına yol açar. Kapsam
testi iki yönü de iddia ediyor ve **beş gerçek hata yakaladı** — koddan
okuduğuna değil, ona güven.

**`packages/core` katman sınırı.** Three.js ithal edilirse tüm mimari çöker;
`core` saf mantık olarak kalmalı.

**`@pascal-app/*` peer bağımlılıkları eklentide asla pinlenmez.** İkinci bir
kopya = ikinci bir `nodeRegistry` singleton'ı: kind'lar host'un okumadığı
registry'ye kaydolur ve **hiç görünmez**.

**Eklenti panellerinde Tailwind sınıfı yasak.** Tailwind v4 sembolik bağlı
dizinleri taramaz, git bağımlılığı ise her zaman bir semboliktir → sınıf hiç
derlenmez, panel **hatasız biçimde stilsiz** render olur. Inline stil +
host CSS değişkenleri (`src/panels/styles.ts`) kullan.

**`src/index.ts` SSR-güvenli kalmalı.** Host'un sunucu prerender'ında eager
import ediliyor; modül kapsamında `document`/`window`/Three.js'e dokunulamaz.

**Ölçü birimi metredir.** Katalog verileri milimetre — 1000'e böl. **100'ün
üstünde çıplak boyut literali yazma**; kaçak bir `1200`, 1,2 km uzunluğunda bir
palet demek ve hiçbir şey itiraz etmez.

### 5.3 Teknik borçlar ve geçici çözümler

| # | Konu | Neden borç |
|---|---|---|
| B1 | **E2E testi yok** | Uçtan uca doğrulama `deploy-bundle`'ın 2 duman testine + elle teste dayanıyor. Playwright doğal seçim — konteynerde Chromium zaten kurulu |
| B2 | **Panelin CI'ı yok** | Tip güvenliği dolaylı olarak editörün `pull-panel` kapısına bağlı |
| B3 | **Üç guide katmanı kotu kendi içinde telafi ediyor** | `alignment-3d`, `elevation-3d`, `wall-snap-beacon`. #55 çözümü doğru katmanı buldu ama bu üçü hâlâ kendi yamalarını taşıyor. Upstream'e bildirilmeli |
| B4 | **`installedPlugins: []` "hepsini yasakla" demek** | `isNodeKindEnabled` (`core/src/registry/registry.ts:104`) `undefined` için "izin ver", `[]` için "yasakla". Aynı kapı `markDirty`'de de var. Editörün yükleme yolunda `?? defaultInstalledPlugins` fallback'i var, ama ham `setScene` çağrısı korumasız |
| B5 | **Mükerrer düğüm yolları** | §6.5 |
| B6 | **Upstream 41 commit geride** | Zemin hazır (26 bekçi test), merge yapılmadı |
| B7 | **`@mint/pascal-plugin` ve `@pascal-app/plugin-trees` özel bağımlılık** | Ağ erişimi olmayan ortamda `apps/editor` **derlenemez**. Yeni takımın yerel makinesinde bu iki repoya erişim şart |

### 5.4 Fork'un upstream'den ayrıldığı yerler — ve nasıl korunuyor

Fork, upstream'de **olmayan** bir "düzenleme kilidi" kavramı ekliyor
(`sceneLocked`, `lockedCategories`, `hiddenCategories`). Bu kilit **21 upstream
dosyasına** dokunuyor. Bir upstream merge'i o dosyalardan birini "theirs" olarak
alırsa kilit sessizce kaybolur ve **hiçbir test düşmez** — çünkü upstream'in
sürümü kendi içinde tutarlıdır.

Bunun için **26 bekçi test** yazıldı:
- `packages/editor/src/lib/edit-lock-coverage.test.ts` — 21 dosya, her biri
  merge'i çözecek kişiye **ne kaybolduğunu** söyleyen bir gerekçe taşıyor.
- `packages/viewer/src/lib/fork-connections.test.ts` — 4 performans bağlantısı.
- `packages/editor/.../floor-stack-preview.test.ts` — hayalet kotu.

Bekçilerin gerçekten çalıştığı **kanıtlandı**: upstream'in
`floating-action-menu.tsx` sürümü yerine konunca ("theirs" merge senaryosu)
bekçi amaçlanan mesajla düştü.

**Merge yaparken `UPSTREAM.md`'yi oku** — dosya-bazlı kural listesi orada.

---

## 6. EN ZORLU PROBLEMLER VE GELECEK PLANI

### 6.1 Zorlu #1 — Tek nesne silince **tüm ekranın** kararması

**Belirti:** Sarmal konveyörü silince tuvalin tamamı karardı. Tek bir mesh değil,
**her şey**.

**Neden zor:** belirti sebebin yakınında bile değil. Kararan şey silinen nesne
değil, *başka her şey*.

**Kök neden:** WebGPU'da **komut-kodlayıcı zehirlenmesi**. `position.count === 0`
olan (ya da bir attribute'u eksik olduğu için shaderLocation'ları kayan) bir
geometri, vertex buffer slot 0'ı bağlamıyor. Reddedilen çizim **o karenin TÜM
komut tamponunu** düşürüyor.

**Nasıl oluştu:** sekiz konveyör önizlemesi paylaşılan geometriyi **`retain`
etmeden** çekiyordu. Süpürme, tutanı kalmayan şekli serbest bırakıyor; hayalet
elindeki boş tamponla çizmeye çalışıyor.

**Çözüm:** her önizlemeye retain/release; ayrıca sarmalın merkez kolonuna eksik
vertex renk attribute'u. Ders `packages/viewer/src/lib/drawable-geometry.ts`'de
belgeli.

### 6.2 Zorlu #2 — Tek tıkta çift yerleştirme

**Kök neden:** tek bir fiziksel tıklama emitter'a **iki kez** ulaşıyor —
`pointerup`'ta sentezlenen `${kind}:click` (`use-node-events.ts`) ve tarayıcının
gerçek `click`'inden doğan `grid:click` (canvas üzerindeki DOM dinleyicisi,
`use-grid-events.ts`). İkincisine **R3F'in `stopPropagation`'ı ulaşamıyor**.

**İlk (yanlış) yaklaşım:** mevcut koruma konumları karşılaştırıyordu
(`SAME_POINT_M = 0.001`) — iki olay farklı nokta bildirdiği için **hiç
eşleşemezdi**. Zaman penceresi düşündüm ama **kendim vazgeçtim**: meşru hızlı
ardışık yerleştirmeleri yutar ve testler arasında state sızdırır.

**Çözüm:** abonelik başına (modül-global değil) **basış-başına kapı**;
`pointerdown`'da capture ile yeniden kurulur.

### 6.3 Zorlu #3 — Üç koordinat çerçevesinin sessiz karışması

§2.1'de anlatıldı. Zorluğu: **hata hiçbir yerde patlamıyor**, yalnız aktif kat
sıfırdan farklıysa görünür hâle geliyor — yani çoğu sahnede tamamen görünmez.
Üstelik düzeltmenin kendisi ikinci bir çerçeve hatası doğurdu (mesh'in iki kez
kot alması) ve o da yalnız okuyarak yakalandı.

**Genel ders:** bu kod tabanında bir konum değerine dokunurken **her zaman**
"bu hangi çerçevede?" diye sor. Üçü de `[number, number, number]` tipinde ve
tip sistemi hiçbirini ayırt etmiyor.

### 6.4 ❌ Yarım kalan: #50-D3 — 2B'de yeni nesne görünmüyor

**Belirti:** 2B planda bir warehouse nesnesi yerleştiriliyor; nesne **sahneye
giriyor** ama planda çizilmiyor. Görmek için 3B'ye geçip 2B'ye dönmek gerekiyor.
Kullanıcı teyit etti: **yalnız `warehouse:*` nesnelerinde**; duvar/kolon/slab
anında çiziliyor.

**Kanıtla elenen hipotezler** (yeni takım bunları tekrar aramasın):

| Eleme | Kanıt |
|---|---|
| Store aboneliği tetiklenmiyor | `createNodesAction` `{ ...state.nodes }` yazıyor **ve** ebeveynin `children` dizisini tazeliyor (`node-actions.ts:789-825`) |
| `def.floorplan` tembel yükleniyor | Doğrudan fonksiyon (`pallet/definition.ts:112`); builder'lar saf |
| `sceneRegistry` boş (3B mount olmamış) | 3B tuval **hiç unmount olmuyor**, yalnız `display:none`; ayrıca `editor-2d/` **hiç** `sceneRegistry` okumuyor |
| Sızan `isNew`/`isTransient` | Eklenti bu bayrakları hiç yazmıyor; 2B katmanı da bakmıyor |
| Yanlış parent | `parentId: activeLevelId`, host ile aynı |
| `installedPlugins` eksik | `registerEditorHostPanel(warehouseCatalogPanel)` `bootstrap.ts:98`'de **senkron**, `loadExternalPlugins()`'ten önce |

**Kesinleşen mekanizma:** `FloorplanRegistryLayer` (`floorplan-panel.tsx:11463`),
`isFloorplanOpen` kapısıyla açılan `<svg>`'nin (`:11294`) **içinde** — elle
sayarak doğrulandı, arada kapanış etiketi yok. Yani saf 3B'de katman **unmount
oluyor**, dönüşte sıfırdan mount oluyor. Ayrıca dönüşte viewport **sıfırlanıp
yeniden fit** ediliyor (`floorplan-panel.tsx:7827-7840`).

**Geriye kalan tek aday (C):** katman, eklenti commit'inde **hiç yeniden render
olmuyor**. Yerleşik araçlar sahnenin yanı sıra katmanın abone olduğu editör
state'ini de yazıyor (`movingNode` `:437`, `mode`/`tool` `:488-490`); eklenti
commit'i yalnız `useScene` + `useViewer.setSelection` yazıyor.

**Ölçüm reçetesi** (uygulama ayağa kalkar kalkmaz, ~10 dakika):
1. `FloorplanRegistryLayer` tepesine `console.count` — bir raf yerleştir.
   **Sayaç commit'te artmıyor ama görünüm geçişinde artıyorsa → (C) kanıtlandı.**
2. Artıyorsa: `floorplanData.entries` içinde yeni id var mı? Varsa sorun
   çizimde (`geometryCacheRef` / `nodeDepsEqual`, `:3482-3505`, 16 anahtar).
3. Ek olasılık: nesne **görüş alanı dışına** yerleşiyor olabilir; geçişteki
   viewport re-fit onu görünür kılıyor olabilir. Yerleştirdikten sonra
   `nodes[yeniId].position` ile 2B viewport'unu karşılaştır.

### 6.5 ❌ Yarım kalan: #52 — mükerrer düğüm yolları

Teşhis var, düzeltme yok:
- **E1** — sızan `isNew` taslağı: `move-registry-node-tool.tsx:1054-1062`
  temizlikten `isNew`'i **bilerek** dışlıyor.
- **E2** — `use-placement-coordinator.tsx`'te 5 tık aboneliği arasında ortak
  commit kapısı yok.
- **E3** — kat çoğaltmada çift-tık koruması yok; handler bayat prop `levels` ile
  taze store düğümlerini karıştırıyor.
- **E4** — `floorplan-registry-layer.tsx:945` `visit()`'te `seen` kümesi yok;
  `:984`'teki bina-kapsamlı tarama `collectedIds`'e karşı tekilleştirilmiyor.
- **F** — hiçbir yerde **çakışık düğüm tespiti** yok (`findCoincidentNodes`).

### 6.6 Devam etseydim ilk üç işim

1. **#50-D3'ü ölçüp bitir** (§6.4 reçetesi). Uygulama ayağa kalkar kalkmaz
   yarım saatlik iş; tek eksik çalışma zamanı erişimi.
2. **Güvenlik: `.env` sırlarını rotate et ve git geçmişini temizle** (§5.1).
   Aslında sıralamada birinci; teknik olarak ikinci çünkü kod işi değil.
3. **Upstream merge'i yap** (41 commit). Zemin artık hazır: 26 bekçi test bir
   "theirs" kazasını yakalayacak. `UPSTREAM.md` + `review-architecture` skill'i
   ile ilerle. Öncelikli commit'ler: #665, #643, #637; yakınsama #650/#642.

Ardından #52 (mükerrer düğümler) ve B3 (üç guide katmanının kendi yamaları →
upstream'e bildir).

---

## 7. ARAÇLAR, MCP'LER VE SKILL TAVSİYELERİ

### 7.1 Depodaki hazır skill'ler (`editor/.agents/skills/`)

Aynı içerik `.claude/skills/`, `.cursor/skills/`, `.codex/skills/` altında
sembolik bağlarla duruyor — hangi asistanı kullanırsanız kullanın erişilebilir.

| Skill | Ne yapar |
|---|---|
| `review-architecture` | PR'ı mimari kurallara karşı denetler: gerekli wiki sayfalarını yükler, diff'i çeker, yeni dosyaları katmana göre sınıflar, bulguları önem sırasına göre raporlar. **Her PR'da koşturun** |
| `open-pr` | Deponun PR şablonuyla PR açar |
| `verify` | Tipler + lint + testler — CI'nin koştuğu üçlü |
| `changelog` | `CHANGELOG.md` ve README'nin üretilen bloklarını yeniler |

### 7.2 Bu projede gerçekten işe yarayan MCP sunucuları

| MCP | Ne için |
|---|---|
| **GitHub MCP** | PR açma/okuma, CI durumu, workflow dispatch, dosya okuma. Bu oturumda tıkanıklığı (`mergeable_state: dirty`) bulan buydu |
| **Three.js MCP** (`learn_threejs`, `show_threejs_scene`) | WebGPU/three davranışını doğrulamak. §6.1'deki komut-kodlayıcı zehirlenmesi gibi konularda çok değerli |

**Uyarı — bu oturumda bizzat yaşandı:** GitHub MCP'nin `get_status` metodu
**eski statü API'sini** okur ve GitHub Actions tabanlı kontroller orada
görünmez (`total_count: 0`). **Kontrol durumu için `get_check_runs` kullanın.**
`get_status`'a bakıp "CI beklemede" sonucuna varmak yanlıştır.

### 7.3 Yeni takım hangi yeteneklerle donatılmalı

**Kesinlikle gerekli:**

1. **`wiki/architecture/` sayfalarını okuma alışkanlığı.** 20 sayfa var ve
   koda dokunmadan önce ilgili olanı okumak, bu kod tabanında en yüksek getirili
   alışkanlık. Eşleme `AGENTS.md`'de.
2. **Paralel keşif ajanları.** Bu monorepo tek bir bağlama sığmıyor
   (`floorplan-panel.tsx` tek başına 11.000+ satır, `floorplan-registry-layer.tsx`
   3.684 satır). Geniş taramaları alt-ajanlara dağıtın.
   **Ama sonuçlarını doğrulayın** — bu oturumda iki ajan katmanın unmount olup
   olmadığı konusunda **çelişti** ve doğru cevabı elle sayarak buldum.
3. **Playwright** (B1). Konteynerde Chromium kurulu; E2E katmanı eklemek için
   engel yok.

**Çalışma disiplini olarak önerdiklerim:**

- **Anlamlı test ölçütü** (eklentinin kendi kuralı, benimsenmeye değer): doğru
  kodun doğru olduğunu değil, **makul görünen YANLIŞ bir cevabın üretilmediğini**
  iddia et. Bu kod tabanındaki değerli testlerin hepsi böyle.
- **Bekçi testleri yaz ve gerçekten düştüğünü kanıtla.** Düzeltmeyi geri alıp
  testin düştüğünü görmeden "test yazdım" deme. #55'te kanıtladım (0 vs 12,93),
  kilit bekçilerinde de (upstream dosyasını yerine koyarak).
- **Konum değerlerinde çerçeveyi sor** (§6.3). Üçü de aynı tipte.
- **Tahminle düzeltme yazma.** Bu oturumda iki kez yanlış katmana yöneldim ve
  ikisini de okuyarak yakaladım — kod yazarak değil.

---

## Ek: hızlı dosya-yolu dizini

| Ne | Nerede |
|---|---|
| Katman sınırları + fork kuralları | `editor/AGENTS.md` (=`CLAUDE.md`) |
| **Otomasyon topolojisi** | `editor/OTOMASYON.md` |
| Upstream merge kuralları | `editor/UPSTREAM.md` |
| Fork denetimi | `editor/FORK-DENETIMI.md` |
| **Tam mimari + env + dağıtım** | `editor/PROJECT_HANDOVER.md` |
| Eklenti keşfi / boot | `editor/apps/editor/lib/bootstrap.ts` |
| Sahne yükleme | `editor/packages/editor/src/lib/scene.ts` |
| Scene store (MySQL) | `editor/packages/mcp/src/storage/mysql-scene-store.ts` |
| Auth köprüsü | `editor/apps/editor/lib/auth/{session,guard}.ts` |
| Düzenleme kilidi | `editor/packages/editor/src/lib/edit-lock.ts` |
| Silme "balyoz" handler | `editor/packages/editor/src/components/editor/selection-manager.tsx` |
| **Hayalet kot çevirisi (#55)** | `editor/packages/editor/src/components/tools/shared/floor-stack-preview.ts` |
| 2B plan katmanı | `editor/packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.tsx` |
| Plugin manifest | `plugin-warehouse/src/index.ts` |
| Plugin host okumaları | `plugin-warehouse/src/host-adapter.ts` |
| Plugin yerleştirme + `toToolFrame` | `plugin-warehouse/src/placement.ts` |
| Vendoring motoru | `editor/scripts/sync-panel.mjs` |
| Üretim sunucusu | `Digitaltwin/server.js` |
