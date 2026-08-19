# Fork Denetimi — `ovurrsl/editor` ⟷ `pascalorg/editor`

*19 Ağustos 2026. Kaynak: `git diff origin/main...origin/integration` + üç bağımsız kod incelemesi.*
*`origin/main` upstream'in birebir aynasıdır, dolayısıyla bu diff **tam olarak bizim yaptıklarımızdır**.*

**Sorulan soru:** Performans için sistemin çalışma mantığını değiştirdik mi, ve
yaptıklarımız ileride upstream güncellemelerini nasıl etkiler?

---

## 0. Kısa cevap

**Performans için çalışma mantığını neredeyse hiç değiştirmedik.** Perf gerekçeli
değişikliklerin çoğu *salt maliyet* — aynı çıktı, daha ucuz — ve çoğu testle
korunuyor. Davranış değiştiren iki perf işi var, ikisi de bilinçli ve gerekliydi.

**Asıl risk performansta değil, üç başka yerde:**

1. **Kilit sistemi 21 upstream dosyasına yayılmış ve o 21 dosyadaki kapıların
   hiçbirinin testi yok.** Bir merge'de kapı düşerse hiçbir test kırılmaz, tip
   hatası çıkmaz — özellik sessizce ölür.
2. **Üretim veritabanı backend'inin (1017 satır) davranış testi yok**, ve kodda
   var olmayan bir parite testine atıf yapan yanıltıcı bir yorum duruyor.
3. **`UPSTREAM.md` değiştirdiğimiz 80 dosyanın yalnız 24'ünü kapsıyor.** En
   tehlikeli tek karar (üretimde SQLite yasağı) belgede hiç geçmiyor.

---

## 1. Forkun ölçüsü

| | |
|---|---|
| Fork'a özgü commit | **203** |
| Değişen dosya (toplam) | **363** |
| **Upstream dosyası değiştirilmiş** | **80** ← merge sürtünmesi buradan gelir |
| Yeni eklenen dosya (upstream'de yok) | 30 |
| `apps/editor` (çoğu vendor panel + bizim uygulama) | 229 |

363'ün büyük kısmı **ekleme** — upstream'de karşılığı olmadığı için hiç
çakışmaz. Gerçek yüzey, upstream'in kendi dosyalarına dokunduğumuz 80 yer.

### Çarpışma sıcak noktaları

Upstream'in son 120 günde o dosyaya dokunma sayısı:

| Dokunma | Dosya | Bizim ne yaptığımız |
|---|---|---|
| 75 | `packages/editor/src/index.tsx` | barrel export (çakışması mekanik) |
| 66 | `packages/core/src/index.ts` | barrel export |
| **53** | `editor/selection-manager.tsx` | **kilit kapıları ×5 + silme modu** |
| 49 | `viewer/src/index.ts` | barrel export |
| **45** | `editor-2d/floorplan-registry-layer.tsx` | kilit kapıları ×3 |
| 38 | `hooks/use-keyboard.ts` | silme modu toggle + kilit |
| 35 | `tools/tool-manager.tsx` | kilit kapısı |
| **32** | `editor/floating-action-menu.tsx` | **kilit kapıları + Duplicate** |

Kilit sistemimiz, upstream'in **en sık değiştirdiği dosyaların** içinde duruyor.

---

## 2. Performans gerekçeli değişiklikler — tek tek

Sınıflandırma: **(a)** aynı çıktı daha ucuz · **(b)** davranış/semantik farklı ·
**(c)** upstream'de olmayan yetenek.

| Değişiklik | Sınıf | Test | Not |
|---|---|---|---|
| `viewer/systems/wall/wall-cutout.tsx` — yüksekliği thunk'a al, seçilmemiş duvarda hiç hesaplama | **(a)** | ✅ çağrı sayacı | Boole çıktısı birebir aynı |
| `viewer/lib/merged-outline-node.ts` — iç geçişlerde `matrixWorldAutoUpdate=false` | **(a)** | ✅ 3 test | Ön koşul: geçişler arası transform yazılmamalı |
| `core/services/level-index.ts` + `stair-rise.ts` — lineer arama yerine indeks | **(a)** | ✅ | `stair-rise` birebir eşdeğer |
| `core/systems/stair/stair-opening-sync.ts` — sahne taraması yerine indeks | **(a)** + bir **(b)** kenar durumu | ✅ **Proxy tarama sayacı** | Çelişkili `parentId`/`children` olan miras sahnelerde farklı sonuç |
| `editor/lib/stair-levels.ts` — aynı indeks | **(a)** | ❌ | ⚠️ sıralama garantisi `getLevelIndex`'e devredilmiş |
| `viewer/scene-bvh` → `lib/scene-bvh-maintainer.ts` | **(b)** + **(c)** | ✅ ama **bağlantı testsiz** | Upstream'inki niyetini hiç gerçekleştirmiyordu (mount anında sahne boş) |
| `viewer/lib/static-transform.ts` — matris compose dondurma | **(b)** sözleşme değişikliği | ✅ kütüphane, ❌ **3 çağrı yeri** | Donmuş nesneye imperatif yazım artık görünmez |
| `editor/tools/shared/drag-bounding-box.tsx` — geometri/materyal paylaşımı | **(a)** | ❌ **hiç yok** | Aslında perf değil **GPU çökme düzeltmesi** |
| `core/lib/space-detection.ts` — 10.000 m² oda tavanı kaldırıldı | **(b)** | ✅ 10×10→200×150 süpürme | Aşağıda ayrıntı |

### `space-detection` — perf değil, **doğruluk**

Silinen tek koşul: `signedArea > 10_000` → oda değil.

Upstream'de 100 × 120 m'lik bir depo çeperi (12.000 m²) **hiç oda sayılmıyordu**.
Sonucu tek bir şey değil, beş şey birden: otomatik döşeme yok, tavan yok, bölge
yok, `wallClosesRoom` false — yani duvar aracı konturu **kapatmıyor** bile. Hata
yok, uyarı yok.

Kodun kendi yorumunun iddiası denetlendi ve **doğru**: sınır ne dış yüzü eliyordu
(dış yüz zaten `signedArea <= 0` ile düşüyor) ne de maliyet koruması idi (poligon
o noktada zaten kurulmuş). Alt sınır (`< 0.5`) duruyor ve ayrı testle korunuyor.

### `packages/nodes` — ölçek tavanları (perf değil ama aynı aile)

`wall`, `column`, `door`, `ceiling`, `slab`, `downspout` panellerinden ev-ölçeği
tavanları kaldırıldı (`max={20m}`, `height.max: 6` vb.).

Kritik gerekçe: `SliderControl` **sürüklemede de yazımda da clamp ediyor**. Yani
bu bir slider aralığı değil, **sessiz veri kaybıydı** — 120 m'lik bir duvar
mevcuttu, biri Length alanına dokunduğu an 20 m oluyordu; hata yok, uyarı yok,
ölçmeden fark edilmiyor.

**Forkun en iyi korunan alanı burası:** üç guard testi **kaynak metnini okuyup**
`max=` yokluğunu doğruluyor, yani merge'de upstream'in tavanı geri gelirse
**anında kırmızı yanıyor**.

---

## 3. Sessiz kayıp riski — testsiz bağlantı noktaları

Denetimin en önemli çıktısı bu. Aşağıdakiler bir upstream merge'inde
**hiçbir testi kırmadan** yok olabilir:

### 3.1 Kilit sistemi — 21 dosya, ~54 nokta, sıfır bağlantı testi

Kavram tek yerde tanımlı (`packages/editor/src/lib/edit-lock.ts`) ve **o dosyanın
testi var**. Ama kapıların kendisi 21 upstream dosyasına serpilmiş ve **hiçbiri
test edilmiyor**. En kötüsü `selection-manager.tsx`: 5 ayrı kapı, ~700 satır
aralığa dağılmış, ve upstream'in en sık dokunduğu dosyalardan biri.

> Bugün yaşadığımız "kilitliyken Duplicate serbest kalmış" hatası bunun ilk
> örneğiydi: PR #22'de kapılar eklenirken Duplicate atlandı, kimse fark etmedi,
> ve sonuç görünmez + seçilemez + silinemez mükerrer node'lardı.

**İyi haber:** kapılar kilit kapalıyken no-op, yani kilit yokken davranış
upstream ile birebir aynı. Ve her kapı tek satırlık erken-dönüş — çakışmalar
çok sayıda ama mekanik.

### 3.2 Dört render bağlantısı

| Dosya | Bağlantı | Kaybın şekli |
|---|---|---|
| `viewer/renderers/parametric-node-renderer.tsx` | `useStaticTransform` çağrısı | Sessiz yavaşlama |
| `viewer/systems/wall/wall-system.tsx` | `freezeObjectTransform` | Ters yönde: transform yazan ikinci bir yol eklenirse **duvarlar orijinde çizilir** |
| `viewer/systems/floor-elevation/floor-elevation-system.tsx` | `stampFrozenTransform` | Sessiz |
| `viewer/renderers/node-renderer.tsx` | kategori görünürlük geçidi | Özellik ölür, uygulama çalışmaya devam eder |

⚠️ **`category-visibility.test.ts` geçidi import etmek yerine KOPYALIYOR**
(`// Mirrors the gate in node-renderer.tsx exactly`). Yani `node-renderer.tsx`
upstream'inkiyle değiştirilse bile test **yeşil kalır**. Bu, sahte güvenlik ağının
ders kitabı örneği.

### 3.3 Üretim veritabanı backend'i testsiz

| Backend | Üretimde mi | Kod | Davranış testi |
|---|---|---|---|
| SQLite | Hayır (yalnız dev) | — | 648 satır: shares, revisions, presence, retention |
| **MySQL** | **Evet** | **1017 satır** | **Sıfır** |

Üstelik `sqlite-scene-store.ts`'teki bir yorum şunu iddia ediyor:
*"the two stores are asserted to behave identically by `store.test.ts`"* —
**bu yanlış.** `store.test.ts` 124 satır ve tamamı slug testi; içinde `mysql`
kelimesi geçmiyor. Merge eden kişi **olmayan bir güvenlik ağına** güveniyor.

---

## 4. Veri katmanı — en büyük sapma

`packages/mcp`: 2177+ / 122−.

| Değişiklik | Sınıf | Risk |
|---|---|---|
| `mysql-scene-store.ts` (1017 satır, **yeni**) | (c) | Upstream'de yok → çakışmaz, ama testsiz |
| `sqlite-scene-store.ts` (317/111) | (b) | En büyük tekil çakışma yüzeyi |
| `scene-store-shared.ts` (183, **yeni**) | (c) | İki backend'in ortak kalbi |
| `scene-operations.ts` (116/0, **saf ekleme**) | (c) | Yetenek sondaları + delege metotlar |
| `types.ts` (72/1) | (c) | `backend` union'ı → garantili tek-satır çakışması |
| `index.ts` (54/6) | **(b) tersine çevirme** | Aşağıda |

### `createSceneStore` — upstream sözleşmesinin tersine çevrilmesi

Upstream'in `createSceneStore`'u 6 satır ve **asla fırlatmaz**, her zaman bir
store döner. Bizimki üretimde MySQL yoksa **fırlatıyor**.

Bu, veri katmanındaki en tehlikeli tek karar — ve **doğru** karar: fallback
geri gelirse müşterinin sahneleri her yayında silinen host diskine yazılır,
**hiçbir hata vermeden**. Uygulama açılır, sahneler kaydolur, sonraki deploy'da
yok olur.

✅ Üç testle kilitli (`mysql-scene-store.test.ts`). Denetimdeki **en iyi korunan
sapma**. ❌ Ama `UPSTREAM.md`'de tek satırı yok.

### `sqlite-scene-store.ts` — hata modu düzeltmesi

`UPSTREAM.md` "yeniden inline etmek MySQL'i bozar" diyor. Ölçüldü: **bozmaz —
daha kötüsünü yapar.** Toptan alım `scene-store-shared.ts`'i silmez, MySQL
derlenmeye devam eder. Gerçek hasar **sessiz ayrışma**: SQLite kendi kopyalarına
döner, MySQL shared'ı kullanmaya devam eder, ve o andan sonra upstream'in bu
yardımcılara yaptığı **her düzeltme yalnız dev'e iner, üretim eski davranışta
kalır**. Bu tam olarak upstream `#597`'nin şekli (sessiz veri silme).

### Belgelenmemiş regresyon: `editorUrlForScene`

`PASCAL_EDITOR_ORIGIN` desteği sessizce düşürülmüş, ama `packages/cli` o
değişkeni hâlâ **set ediyor**. CLI'nin mutlak sahne URL'leri fork'ta çalışmıyor.
Hiçbir yerde belgeli değil.

---

## 5. Altyapı

| Değişiklik | Risk |
|---|---|
| **Kök `build` script'i** — `turbo run build` → 6 komutluk yıkıcı Hostinger zinciri | En yıkıcı tek madde (aşağıda) |
| `Dockerfile` / `docker-compose.yml` / `.dockerignore` **silindi** | Silme + upstream değişikliği **sessizce geri gelir**; hiçbir test yokluğu doğrulamıyor |
| `biome.jsonc` — panel alt-ağacı için `useExhaustiveDependencies: off` | Override dizisinin **başına** eklenmiş → her upstream eklemesinde çakışır. `noRestrictedImports` **değiştirilmemiş** |
| `.github/workflows/ci.yml` | Branch adı + `cli-smoke` silmesi; **merge kuralı yok** |
| `.github/workflows/release.yml` | **Yalnızca bir boş satır** — sıfır değer, kalıcı çakışma adayı |
| `scripts/` (3 yeni dosya) | Katkısız ekleme |

### `build` script'i — iki kanıtlanmış sorun

1. **Yıkıcı:** `rm -rf node_modules` içeriyor. "Sadece derle" bekleyen her çağrı
   bunu yer.
2. **Argüman-güvenli değil:** `bun run build --filter editor` çağrısında
   argümanlar zincirin *son* komutuna iliştiği için `cp … server.js --filter
   editor` olur ve iki dakikalık derlemenin sonunda patlar. **`ci.yml`'deki
   `cli-smoke` işi tam bu yüzden silinmek zorunda kaldı.**

---

## 6. `UPSTREAM.md` boşluğu

Belge iyi yazılmış ama **80 değiştirilmiş dosyanın 24'ünü** kapsıyor; **56'sı hiç
geçmiyor.** En ciddi eksikler:

**Veri katmanı:** `storage/index.ts` (üretim SQLite yasağı — en büyük davranış
tersine çevirmesi, tek satırı yok), `types.ts`, `scene-operations.ts`,
`mysql-scene-store.ts`, `lib/env.ts`, `scene-store-shared.ts` (kendi kural satırı
yok), `editorUrlForScene` regresyonu.

**Uygulama:** `scene-api-security.ts` (**güvenlik yüzeyi**), `viewer-toolbar.tsx`
(154/9 — en büyük belgelenmemiş UI sapması), `save-button.tsx`,
`client-bootstrap.tsx`, `tsconfig.json`, `privacy/terms` sayfaları, `favicon.ico`
(**ikili dosya — git birleştiremez**).

**Altyapı:** Docker silmeleri, üç workflow, `biome.jsonc`'un ne değiştirdiği,
`build` argüman tehlikesi.

---

## 7. Öneriler — ucuzdan pahalıya

### Bedava (kod davranışına hiç dokunmadan)

1. **Formatlama gürültüsünü geri al.** `apps/editor/tsconfig.json` ve
   `package.json` bütünüyle yeniden formatlanmış ve sondaki newline'ları
   kaybolmuş; `release.yml`'de tek bir kazara boş satır var. Bunları upstream
   formatına döndürmek çakışma yüzeyini ~34 satırdan ~10'a indirir. Upstream bu
   dosyalara **her bağımlılık güncellemesinde** dokunuyor.
2. **`trimRevisions` yorumundaki yanlış iddiayı düzelt** — var olmayan bir parite
   testine atıf yapıyor.
3. **`UPSTREAM.md`'ye eksik 56 dosyayı ekle**, en azından şu üçünü öncelikle:
   `storage/index.ts`, `scene-api-security.ts`, Docker silmeleri.

### Ucuz ve yüksek getirili

4. **Kilit kapıları için bağlantı testleri yaz.** 21 dosyanın hepsi değil —
   `selection-manager.tsx`, `floating-action-menu.tsx`,
   `floorplan-registry-action-menu.tsx` ve `tool-manager.tsx` yeter. Test,
   kapının *varlığını* değil *etkisini* iddia etmeli.
5. **`category-visibility.test.ts`'i düzelt** — geçidi kopyalamayı bırakıp
   `node-renderer.tsx`'ten import etsin.
6. **Docker dosyalarının yokluğunu iddia eden bir satır** ekle
   (`deploy-bundle.test.ts`'e). Geri gelirlerse CI kırmızı yanar.
7. **`next.config.ts`'in `output: 'standalone'`'unu teste bağla** — bugün
   kaybı en geç noktada (deploy kopyalama adımında) fark ediliyor.

### Orta

8. **`build` zincirini `scripts/build-hostinger.mjs`'e taşı**, kök `build`'i
   upstream'in `turbo run build`'ine geri ver, `build:deploy` diye ayrı script
   ekle. O satır bir daha hiç çakışmaz ve argüman tehlikesi biter.
9. **`store.test.ts`'i gerçek parite süitine çevir** — aynı gövdeyi iki store'a
   da koştur (MySQL için CI servisi). Bu, üretim backend'inin testsizliğini ve
   iki store'un ayrışma riskini aynı anda kapatır.
10. **`MysqlSceneStore`'un `SceneStore`'un her opsiyonel metodunu implement
    ettiğini derleme zamanında zorla.** Upstream yeni metot eklerse derleme
    kırılır — sessiz yerine gürültülü.

### Uzun vade

11. **Aynanın sessiz kalmasını engelle.** `mirror-upstream` 7 Ağustos'ta
    upstream'in `ci.yml` değişikliğine çarpıp her gece kırmızı yandı ve **dört
    gün fark edilmedi** — çünkü canlıya hiç yansımadı. Sonuç: bir sonraki alım
    bir avuç yerine 56 commit oldu. "Son başarılı çalışma 48 saatten eskiyse
    issue aç" adımı bunu bir daha yaşatmaz.
12. **Upstream'e PR gönder:** pluggable store factory, helper ayrıştırması,
    paylaşım/presence/revizyon metotları, portable build'in config seçeneği
    olması. Kabul edilen her madde çakışma listesinden **kalıcı olarak** düşer.
