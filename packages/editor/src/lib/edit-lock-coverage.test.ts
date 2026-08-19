import { describe, expect, test } from 'bun:test'

/**
 * BEKÇİ: kilit kapıları bulundukları dosyalarda DURUYOR mu?
 *
 * ## Neden bu teste ihtiyaç var
 *
 * Sahne/kategori kilidi upstream'de olmayan bir kavram. Uygulaması tek bir
 * yerde toplanamıyor: kapı, düzenlemenin gerçekleştiği her yüzeye ayrı ayrı
 * konmak zorunda — seçim, silme, taşıma, döndürme, tutamaklar, komut paleti,
 * klavye, 2B plan. Bugün **21 upstream dosyasına** dağılmış durumda.
 *
 * `edit-lock.test.ts` predikatın kendisini koruyor. Ama predikat doğru olduğu
 * hâlde ÇAĞRILMIYORSA özellik yine ölü, ve o durumu hiçbir şey yakalamıyordu:
 * kapı düşünce tip hatası çıkmaz, test kırılmaz, uygulama sorunsuz çalışır —
 * yalnız kullanıcı Layers'tan kilitler ve hiçbir şey olmaz.
 *
 * Bu, kuramsal bir risk değil: PR #22'de kapılar eklenirken Duplicate
 * atlandı, kimse fark etmedi, ve sonuç kilit altında üretilen görünmez +
 * seçilemez + silinemez mükerrer node'lar oldu. Bir upstream merge'i aynı şeyi
 * 21 dosyanın herhangi birinde yapabilir.
 *
 * ## Bu liste bir merge sırasında ne işe yarar
 *
 * Çakışmayı çözen kişi için: her satır, o dosyadaki kapının NE İÇİN orada
 * olduğunu söylüyor. "Toptan onlarınkini al" seçilirse hangi davranışın
 * kaybolacağı burada yazılı.
 *
 * Bu bekçi kapının VARLIĞINI ölçer, DOĞRULUĞUNU değil — davranış testleri
 * `edit-lock.test.ts`'te. İkisi ayrı sorular ve ikisi de gerekli.
 */

/** Kapının varlığını gösteren sembollerden herhangi biri yeterli. */
const GATE_SYMBOLS = [
  'isNodeEditLocked',
  'isNodeIdEditLocked',
  'useIsNodeIdEditLocked',
  'filterEditableIds',
  'sceneLocked',
  'lockedCategories',
]

const GATED_FILES: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'components/editor/selection-manager.tsx',
    why: 'kilitli node seçilemez ve silme modunda (X) silinemez — beş ayrı kapı',
  },
  {
    file: 'components/editor/floating-action-menu.tsx',
    why: '3B eylem menüsünde Move / Delete / Duplicate kilit altında gizli',
  },
  {
    file: 'components/editor-2d/floorplan-registry-action-menu.tsx',
    why: '2B plan eylem menüsünde aynı düğmeler kilit altında gizli',
  },
  {
    file: 'components/editor/group-actions.ts',
    why: 'toplu silme ve Cut kilitli üyeleri atlar',
  },
  {
    file: 'components/tools/select/box-select-tool.tsx',
    why: 'marquee seçimi kilitli node’ları toplamaz',
  },
  {
    file: 'components/editor/group-move-3d.ts',
    why: '3B grup taşıması kilitli üyeyi sürüklemez',
  },
  {
    file: 'components/editor-2d/floorplan-group-move.tsx',
    why: '2B grup taşıması kilitli üyeyi sürüklemez',
  },
  {
    file: 'components/editor/node-arrow-handles.tsx',
    why: 'ok tutamakları kilitli node’da çizilmez',
  },
  {
    file: 'components/editor/group-rotate-handle.tsx',
    why: 'grup döndürme tutamağı kilit altında çizilmez',
  },
  {
    file: 'components/editor/wall-move-side-handles.tsx',
    why: 'duvarın yan/uç tutamakları kilit altında çizilmez',
  },
  {
    file: 'components/editor/slab-hole-highlights.tsx',
    why: 'döşeme deliği düzenleme afordansı kilit altında gizli',
  },
  {
    file: 'components/systems/selection-affordance-manager.tsx',
    why: 'seçim afordansları kilitli node için mount edilmez',
  },
  {
    file: 'components/systems/ceiling/ceiling-selection-affordance-system.tsx',
    why: 'tavan düzenleme afordansı kilit altında gizli',
  },
  {
    file: 'components/systems/roof/roof-edit-system.tsx',
    why: 'çatı düzenleme sistemi kilit altında devreye girmez',
  },
  {
    file: 'components/editor-2d/renderers/floorplan-registry-layer.tsx',
    why: '2B planda tutamak ve doğrudan taşıma kilit altında kapalı',
  },
  {
    file: 'components/editor-2d/renderers/floorplan-stair-layer.tsx',
    why: '2B merdiven etkileşimi kilit altında kapalı',
  },
  {
    file: 'components/ui/command-palette/editor-commands.tsx',
    why: 'komut paletindeki düzenleme komutları kilit altında çalışmaz',
  },
  {
    file: 'hooks/use-keyboard.ts',
    why: 'klavyeden silme kilitli node’u silmez',
  },
  {
    file: 'components/ui/sidebar/panels/site-panel/tree-node-actions.tsx',
    why: 'ağaç satırındaki kilit rozeti ve eylemler',
  },
  {
    file: 'components/tools/tool-manager.tsx',
    why: 'kategori kilitliyken o kategorinin yerleştirme aracı hiç mount edilmez',
  },
]

describe('kilit kapıları yerinde duruyor', () => {
  test('liste boş değil — boşa düşerse döngü sıfır iddiayla yeşil kalır', () => {
    expect(GATED_FILES.length).toBeGreaterThan(15)
  })

  for (const { file, why } of GATED_FILES) {
    test(`${file} — ${why}`, async () => {
      const path = new URL(`../${file}`, import.meta.url).pathname
      const source = await Bun.file(path).text()
      const found = GATE_SYMBOLS.filter((symbol) => source.includes(symbol))
      expect(
        found.length,
        `${file} artık kilit kapısı taşımıyor. Kaybolan davranış: ${why}. ` +
          'Bir upstream merge’i bu dosyayı toptan almış olabilir — kapıyı geri koyun ' +
          '(kilit kavramı upstream’de yok, dolayısıyla onların sürümünde asla bulunmaz).',
      ).toBeGreaterThan(0)
    })
  }
})
