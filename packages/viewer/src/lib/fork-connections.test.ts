// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { describe, expect, test } from 'bun:test'

/**
 * BEKÇİ: forkun perf mekanizmaları çağrıldıkları yerde DURUYOR mu?
 *
 * ## Neden modül testi yetmiyor
 *
 * Bu paketteki fork mekanizmalarının her birinin kendi testi var:
 * `static-transform.test.ts` dondurmayı, `scene-bvh-maintainer.test.ts`
 * bakımı doğruluyor. Ama hepsi KÜTÜPHANEYİ ölçüyor, ÇAĞRIYI değil.
 *
 * Bir upstream merge'i bu dosyaları toptan alırsa çağrı düşer ve:
 * modül testleri yeşil kalır, tip hatası çıkmaz, uygulama doğru çalışır —
 * yalnız kazanç sessizce geri verilir. Fork sapmalarının kaybolma biçimi
 * tam olarak budur; ölçülmeyen bir kazanç, ilk çakışmada geri alınır.
 *
 * Ters yön daha da sessiz: `wall-system.tsx`'teki dondurma "transformu yalnız
 * bu fonksiyon yazar" varsayımına dayanıyor. Upstream oraya transform yazan
 * ikinci bir yol eklerse duvarlar orijinde çizilir ve hiçbir test konuşmaz.
 * Bu bekçi o durumu yakalayamaz — ama en azından çağrının kaybolduğunu söyler.
 */

const CONNECTIONS: ReadonlyArray<{ file: string; symbol: string; why: string }> = [
  {
    file: 'components/renderers/parametric-node-renderer.tsx',
    symbol: 'useStaticTransform',
    why: 'canlı transformu olmayan parametrik düğümlerin matris compose’u dondurulur',
  },
  {
    file: 'systems/wall/wall-system.tsx',
    symbol: 'freezeObjectTransform',
    why: 'duvar mesh’i geometri güncellemesinden sonra dondurulur',
  },
  {
    file: 'systems/floor-elevation/floor-elevation-system.tsx',
    symbol: 'stampFrozenTransform',
    why: 'kot değişince donmuş matris yeniden damgalanır — damgalanmazsa nesne eski kotta kalır',
  },
  {
    file: 'components/viewer/scene-bvh.tsx',
    symbol: 'createSceneBvhMaintainer',
    why: 'BVH sürekli bakımı — upstream yalnız mount anında tarıyordu, sahne o an boş olduğu için hiçbir şey indekslenmiyordu',
  },
]

describe('fork mekanizmaları bağlı kalıyor', () => {
  test('liste boş değil', () => {
    expect(CONNECTIONS.length).toBeGreaterThan(3)
  })

  for (const { file, symbol, why } of CONNECTIONS) {
    test(`${file} → ${symbol}`, async () => {
      const source = await Bun.file(new URL(`../${file}`, import.meta.url).pathname).text()
      expect(
        source.includes(symbol),
        `${file} artık ${symbol} çağırmıyor. Kaybolan: ${why}. ` +
          'Bu mekanizma upstream’de yok, dolayısıyla onların sürümünde asla bulunmaz — ' +
          'bir merge bu dosyayı toptan almış olabilir.',
      ).toBe(true)
    })
  }
})
