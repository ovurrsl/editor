// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNodeDefinition, nodeRegistry, registerNode } from '@pascal-app/core'
import { isHiddenByCategory as shippedIsHiddenByCategory } from '../lib/category-visibility'
import useViewer from './use-viewer'

// Minimal definitions — categoryOf reads only kind / category / presentation, so
// the schema and defaults can be stubs here.
function def(
  kind: string,
  category: AnyNodeDefinition['category'],
  paletteSection?: 'site' | 'structure' | 'furnish',
): AnyNodeDefinition {
  return {
    kind,
    schemaVersion: 1,
    schema: {} as never,
    category,
    defaults: () => ({}) as never,
    capabilities: {},
    presentation: {
      label: kind,
      icon: { kind: 'iconify', name: 'lucide:square' },
      ...(paletteSection ? { paletteSection } : {}),
    },
  } as AnyNodeDefinition
}

// The SHIPPED predicate, not a copy of it. `node-renderer.tsx` calls this same
// function, so if the renderer ever loses the gate in an upstream merge, this
// file stops describing reality — which is the point: a copy would have stayed
// green while the feature quietly died.
function isHiddenByCategory(kind: string): boolean {
  return shippedIsHiddenByCategory(kind, useViewer.getState().hiddenCategories)
}

beforeEach(() => {
  nodeRegistry._reset()
  registerNode(def('warehouse:pallet-rack', 'furnish'))
  registerNode(def('wall', 'structure', 'structure'))
  registerNode(def('route', 'site', 'site'))
  registerNode(def('level', 'site', 'site'))
  useViewer.setState({
    hiddenCategories: new Set(),
    lockedCategories: new Set(),
    sceneLocked: false,
  })
})

afterEach(() => {
  nodeRegistry._reset()
  useViewer.setState({ hiddenCategories: new Set() })
})

describe('hiddenCategories render predicate', () => {
  test('hiding a category hides only that category', () => {
    useViewer.getState().setCategoryHidden('furnish', true)

    expect(isHiddenByCategory('warehouse:pallet-rack')).toBe(true)
    expect(isHiddenByCategory('wall')).toBe(false)
    expect(isHiddenByCategory('route')).toBe(false)
  })

  test('hierarchy containers are never hidden, even when their palette section is hidden', () => {
    // level's palette section is 'site'; hiding 'site' must not remove the level
    // container (it hosts the whole subtree).
    useViewer.getState().setCategoryHidden('site', true)

    expect(isHiddenByCategory('route')).toBe(true)
    expect(isHiddenByCategory('level')).toBe(false)
  })

  test('setCategoryHidden(false) reveals the category again', () => {
    useViewer.getState().setCategoryHidden('furnish', true)
    useViewer.getState().setCategoryHidden('furnish', false)
    expect(isHiddenByCategory('warehouse:pallet-rack')).toBe(false)
  })

  test('toggling one category preserves the identity of an unchanged set', () => {
    const before = useViewer.getState().hiddenCategories
    useViewer.getState().setCategoryHidden('furnish', false) // already absent → no-op
    expect(useViewer.getState().hiddenCategories).toBe(before)
  })
})

/**
 * BEKÇİ: renderer geçidi GERÇEKTEN çağırıyor mu?
 *
 * Yukarıdaki testler predikatın doğruluğunu koruyor ama çağrıldığını değil.
 * Bir upstream merge'i `node-renderer.tsx`'i toptan alırsa çağrı düşer,
 * predikat testleri yeşil kalır ve kategori gizleme sessizce ölür — kullanıcı
 * Layers'tan gizler, hiçbir şey olmaz, hiçbir test kırılmaz.
 *
 * Bu paket aynı sınıf için (ölçek tavanları, walkthrough hızı) kaynak metnini
 * okuyan bekçiler kullanıyor; bağlantı da öyle korunuyor.
 */
describe('geçit renderer’a bağlı kalıyor', () => {
  test('node-renderer.tsx isHiddenByCategory çağırıyor', async () => {
    const source = await Bun.file(
      new URL('../components/renderers/node-renderer.tsx', import.meta.url).pathname,
    ).text()
    expect(
      source.includes('isHiddenByCategory('),
      'node-renderer.tsx artık kategori geçidini çağırmıyor: kategori gizleme özelliği ölü, ama predikat testleri hâlâ yeşil',
    ).toBe(true)
  })
})
