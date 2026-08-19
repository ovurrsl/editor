# Teşhis: sahne yüklenirken ekran kararması

**Durum:** kök neden bulundu ve kod üzerinden doğrulandı.
**Bu belge kim için:** düzeltmeyi uygulayacak geliştirici/ajan.
**Yazan:** Claude · 19 Ağustos 2026

> Bu, **daha önce düzeltilen kararma hatasının aynısı değildir.** O hata
> konveyör önizlemelerinin paylaşılan geometriyi tutmamasıydı ve **silme
> anında** oluyordu; düzeltmesi canlıda (eklenti pin'i `710408a`, düzeltme
> commit'i `7d3b39c`'nin üstünde — doğrulandı). Buradaki hata **sahne
> yüklenirken** oluşuyor ve kaynağı tamamen başka.

---

## 1. Belirti

Sahne açılırken tuvalin **tamamı** kararıyor — tek bir nesne değil. Konsol
kaydı (kullanıcının canlı oturumu), sırasıyla:

```
[digitaltwin:registry] loaded pascal:core v1 (46 kinds: …)
[digitaltwin:registry] + 3 discovered plugin(s)
[viewer] WebGPU device ready
[viewer/post-processing] Building pipeline                              ×2
Asset not found: 8c32355e-f50d-4f58-b0e7-3b17adc385ee
Calling [RenderPassEncoder (unlabeled)].Draw with a vertex count of 0 is unusual.
[viewer] Skipping BVH for incompatible mesh geometry.                   ×16
[viewer/post-processing] Render pass failed.
[viewer/post-processing] Building pipeline                              ×2
```

**Dikkat edilecek nokta:** logda `[viewer] skipped a draw with an empty
position buffer` **yok**. Yani bu iş için yazılmış olan mevcut emniyet kapısı
(`installEmptyDrawGuard`) devreye girmemiş — çünkü aşağıda açıklanan geometri o
kapının baktığı testi **geçiyor**.

---

## 2. Mekanizma — neden tek bozuk geometri tüm ekranı karartıyor

WebGPU'da reddedilen tek bir çizim, **o karenin komut kodlayıcısını
zehirliyor**: sıradaki `queue.submit` "Invalid CommandBuffer" ile düşüyor ve o
karedeki **diğer bütün çizimler** (sahne + her editör kaplaması) iptal oluyor.
Görünen sonuç, hatalı mesh'in kaybolması değil, **tuvalin tamamının
kararması/bozulması**.

Bu, depoda zaten belgeli:
`packages/viewer/src/lib/drawable-geometry.ts:5-19`.

---

## 3. Kök neden

### 3.1 Tek cümleyle

`createPlaceholderGeometry(groupCount)` (`packages/nodes/src/shared/placeholder-geometry.ts:22-32`)
her çağrıda **`groupCount` adet "count-0" malzeme grubu** ekliyor:

```ts
for (let group = 0; group < groupCount; group++) {
  geometry.addGroup(0, 0, group)      // start 0, count 0
}
```

Bu gruplar iki ayrı hasar üretiyor.

### 3.2 Hasar A — `Draw with a vertex count of 0`

three.js, bir mesh'i malzeme grubu başına çiziyor. Grubun `count`'u 0 olduğu
için çizim `vertexCount = 0` ile veriliyor. three 0.185.1'de
`RenderObject.getDrawParameters()` yalnız `count < 0` ve `count === Infinity`
durumlarında vazgeçiyor; **`count === 0` olduğu gibi geçiyor**.

Konsoldaki `Calling [RenderPassEncoder (unlabeled)].Draw with a vertex count of
0 is unusual.` satırı **birebir budur**.

### 3.3 Hasar B — 16 adet `Skipping BVH`

`scene-bvh-maintainer.ts:101-113`, `geometry.computeBoundsTree()` **fırlattığında**
uyarı basıyor. three-mesh-bvh, paketlenmiş ağacı **malzeme grubuna göre**
bölüyor:

1. `getPrimitiveGroupRanges` her count-0 grubu `{ offset: 0, count: 0 }`'a
   çeviriyor.
2. Filtre `groupStart < drawRangeEnd && groupEnd > drawRangeStart` → `0 > 0`
   **her grup için false**. Hiç aralık üretilmiyor.
3. `buildTree.js` boş `rootRanges` dizisinde `rootRanges[0].offset` okuyor →
   `TypeError` → yakalanıp uyarıya dönüşüyor.

**16 sayısı tesadüf değil**: sahnedeki duvar + çatı + çatı-parçası + merdiven +
merdiven-parçası düğümlerinin toplamı. Yükleme ânında hepsi placeholder
taşıyor, sonra gerçek geometrileri geliyor — bu yüzden hata **yalnız açılışta**
görülüyor ve tekrarlamıyor.

### 3.4 Neden iki emniyet kapısı da yakalamıyor

| Kapı | Ne bakıyor | Neden geçiyor |
|---|---|---|
| `hasDrawableGeometry` (`drawable-geometry.ts:21-24`) | `position.count > 0` | Placeholder'ın **3 köşesi var** → geçer. Kapı `groups`'a hiç bakmıyor |
| `hasBvhCompatibleGeometry` (`scene-bvh-maintainer.ts:36-43`) | index/position sayısı ≥ 3 | Aynı sebeple geçer. `groups` ve `drawRange` hiç okunmuyor |

İkisi de **köşe sayısına** bakıyor; hasar ise **grup aralığından** geliyor.

### 3.5 En güçlü kanıt: bu tehlike depoda zaten belgeli

Aynı fikrin ikinci bir uygulaması var ve **tam olarak bu tuzağı yazıyla
işaretlemiş** — `packages/viewer/src/systems/roof/roof-system.tsx:134-137`:

> *"**Deliberately NO groups: count-0 groups crash MeshBVH's packed-tree build**
> (it partitions roots by group), and a BoxGeometry's 6 groups against the 4
> roof materials crash raycasts and GLTFExporter. Group-less + a zero-area
> triangle is safe everywhere."*

`createDegenerateRoofPlaceholder` (aynı dosya, `:141-150`) grup eklemiyor ve
`computeGeometryBoundsTree(placeholder)`'ı **sorunsuz** çağırabiliyor.
`packages/nodes`'daki paylaşılan yardımcı ise tam tersini yapıyor.

Yani bu bir keşif değil, **iki uygulama arasındaki bir ayrışma**. Doğru cevap
depoda zaten yazılı.

### 3.6 Etkilenen çağrı yerleri

| Kind | Dosya:satır | Grup |
|---|---|---|
| wall | `packages/nodes/src/wall/renderer.tsx:39` | **3** ❌ |
| wall (çarpışma) | `packages/nodes/src/wall/renderer.tsx:40` | 0 ✅ |
| roof | `packages/nodes/src/roof/renderer.tsx:85` | **4** ❌ |
| roof-segment | `packages/nodes/src/roof-segment/renderer.tsx:41` | **4** ❌ |
| stair | `packages/nodes/src/stair/renderer.tsx:137` | **2** ❌ |
| stair-segment | `packages/nodes/src/stair-segment/renderer.tsx:60` | **2** ❌ |
| ceiling | `packages/nodes/src/ceiling/renderer.tsx:25` | 0 ✅ |

---

## 4. Kalan tek belirsizlik (dürüstlük payı)

Kanıtlanan: count-0 grupların **BVH'yi fırlattığı** (16×) ve **sıfır köşeli
çizim ürettiği**.

**Kanıtlanmayan:** o sıfır köşeli çizimin `Render pass failed`'i — yani asıl
kararmayı — tek başına tetiklediği. Dawn'ın mesajı bir *uyarı* ("unusual"),
ölümcül bir hata değil. Kararmanın kendisi `Render pass failed` satırında.

Bunu kesinleştirmenin yolu: konsolda `[viewer/post-processing] Render pass
failed. ▶ Object` satırının içeriğine bakmak.

**Ama bu belirsizlik düzeltmeyi geciktirmemeli:** count-0 gruplar bu depoda
zaten "zararlı" diye belgeli, BVH'yi kanıtlanmış biçimde çökertiyor (yani
raycast hızlandırması o 16 mesh için tamamen devre dışı kalıyor) ve
kaldırılmaları risksiz. Kararmanın ek bir sebebi çıksa bile bu düzeltilmeli.

---

## 5. Önerilen düzeltme

### 5.1 Birincil — placeholder'dan grupları kaldır

`packages/nodes/src/shared/placeholder-geometry.ts`

`groupCount` döngüsünü kaldır; `roof-system.tsx:141-150`'deki kardeş
uygulamayla aynı hâle getir (öznitelikler kalsın, grup olmasın). İmzayı
koruyup parametreyi yok saymak yerine **parametreyi tamamen kaldırıp** yedi
çağrı yerini güncellemek daha temiz — böylece kimse "grup istersem verebilirim"
sanmaz.

Docstring'i de düzelt: mevcut metin grupların *gerekli* olduğunu söylüyor
("matching the mesh's material-array length so raycasts / BVH never index past
the materials") — **bu iddia yanlış ve zararın kaynağı**. `roof-system.tsx`'in
gerekçesiyle değiştir: grupsuz + sıfır alanlı üçgen her yerde güvenli; dizi
malzeme altında hiçbir şey çizilmez ve ışın hiç isabet edemez.

### 5.2 İkincil — emniyet kapısını grup-farkındalı yap

`packages/viewer/src/lib/drawable-geometry.ts`

`hasDrawableGeometry`, geometrinin `groups` dizisi doluysa **çizilebilir bir
grup** olup olmadığına da baksın (en az bir grup `count > 0`). Böylece aynı
sınıftan gelecek bir sonraki hata kapıya takılır. Aynı düşünce
`hasBvhCompatibleGeometry` (`scene-bvh-maintainer.ts:36-43`) için de geçerli —
grupları olan ama hiçbiri çizmeyen bir geometri BVH kuyruğuna hiç girmemeli.

> Bu ikinci adım **birincinin yerine geçmez**. Kapı son savunma hattıdır;
> bozuk geometriyi üretmemek asıl çözümdür.

### 5.3 Bu belgeye dahil DEĞİL (ayrı işler)

Araştırma sırasında çıkan, kararmayla ilgisi olmayan iki ayrı hata —
karıştırılmasın diye ayrı tutuldu:

- **`Asset not found` zararsız.** `packages/core/src/lib/asset-storage.ts:58`.
  Yalnız `guide` ve `scan` renderer'larından gelebiliyor ve ikisi de çözülmemiş
  URL'de **hiç mesh mount etmiyor** (`guide/renderer.tsx:25`,
  `scan/renderer.tsx:23`). Kozmetik bir uyarı. **Kararmanın sebebi değil.**
  *(Ama not: `asset://` varlıkları IndexedDB'de, yani tarayıcı-yerel saklanıyor
  — sahneler sunucuda. Bu, "#35 dokular bir bilgisayarda gelmiyor" hatasının
  kök nedeni ve ayrı bir mimari iş.)*
- **Kullanıcı yüklemesi GLB item'lar her zaman kırmızı kutu.** Şema
  `item.asset.src` için `asset://`'e izin veriyor (`core/src/schema/asset-url.ts:37`)
  ama `ItemRenderer` onu **senkron** `resolveCdnUrl` ile çözüyor, o da
  `asset://` için `null` dönüyor (`viewer/src/lib/asset-url.ts:43-45`) →
  `renderer.tsx:409` yedek kutuya düşüyor. Ayrı, tekrarlanabilir bir hata.

---

## 6. Doğrulama

### 6.1 Önce düşen bir test yaz

Bu deponun kuralı: test, **doğru kodun doğru olduğunu** değil, **makul görünen
YANLIŞ bir cevabın üretilmediğini** iddia etmeli.

Buradaki yanlış cevap: "geometrinin 3 köşesi var, demek ki çizilebilir." Test
şunu iddia etmeli — `createPlaceholderGeometry(...)` çıktısında **çizilebilir
bir grup ya hiç grup olmamalı**, ve `computeBoundsTree()` **fırlatmamalı**.

`packages/nodes` içinde saf bir test yeterli:

```
placeholder-geometry.test.ts
  - üretilen geometride count-0 grup bulunmamalı
  - computeBoundsTree() fırlatmamalı   ← düzeltmesiz hâlde DÜŞER
  - position.count === 3 olmalı (boş öznitelik regresyonu geri gelmesin)
```

**Düzeltmeyi geri alıp testin gerçekten düştüğünü gör.** Düşmüyorsa test
yanlış yazılmıştır.

### 6.2 Komutlar

```bash
bun test packages/nodes packages/viewer packages/editor packages/core
bun run check-types
bunx biome check          # --write düzeltir
```

### 6.3 Elle doğrulama (canlıda / dev'de)

Duvarlı ve çatılı bir sahne aç, konsolu izle. **Kaybolması gerekenler:**

- `Skipping BVH for incompatible mesh geometry` (16 kez) → **0 kez**
- `Draw with a vertex count of 0 is unusual`
- `Render pass failed`

Ek fayda: o 16 mesh artık BVH kazanıyor, yani üzerlerinde ışın testi
hızlanıyor — bugün tamamen devre dışı.

---

## 7. Dokunulmaması gerekenler

- **Paylaşılan geometri havuzunda `dispose()` elle çağrılmaz.** Bir şekil, onu
  paylaşan her düğüme aittir; serbest bırakma yalnız `geometry-builder.ts`
  içindeki süpürme ile, hiçbir tutan kalmadıktan `SWEEP_GRACE_MS = 5000` sonra
  olur.
- **Placeholder'ın öznitelikleri (position/normal/uv/uv2) kalmalı.** Boş bir
  `position` (count 0) vertex buffer slot 0'ı bağlamıyor — asıl zehirlenme
  odur. Sıfır değerli 3 köşe bilinçli bir tercihtir; **kaldırılan şey yalnız
  gruplar olmalı.**
- **`packages/core` Three.js ithal edemez.** Düzeltme `packages/nodes` ve
  `packages/viewer` içinde kalmalı.
- Mimariye dokunan bir değişiklik yapılacaksa önce `wiki/architecture/`
  içindeki ilgili sayfa okunmalı (eşleme `AGENTS.md`'de).

---

## 8. Referanslar

| Ne | Nerede |
|---|---|
| Hatalı yardımcı | `packages/nodes/src/shared/placeholder-geometry.ts:22-32` |
| **Doğru kardeş uygulama + gerekçe** | `packages/viewer/src/systems/roof/roof-system.tsx:128-150` |
| BVH bakıcısı ve uyarı | `packages/viewer/src/lib/scene-bvh-maintainer.ts:36-43, 101-113` |
| Çizim kapısı | `packages/viewer/src/lib/drawable-geometry.ts:21-24` |
| Kapının kurulumu | `packages/viewer/src/components/viewer/index.tsx:108-144` |
| Zehirlenmenin açıklaması | `packages/viewer/src/lib/drawable-geometry.ts:5-19` |
| `Asset not found` kaynağı | `packages/core/src/lib/asset-storage.ts:55-60` |
