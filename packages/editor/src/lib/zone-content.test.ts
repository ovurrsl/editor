import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  loadPlugin,
  nodeRegistry,
  type ZoneNode,
} from '@pascal-app/core'
import { shallow } from 'zustand/shallow'
import {
  collectZoneContentIds,
  collectZoneObjectIds,
  collectZoneObjectLabels,
} from './zone-content'

/**
 * A 10x10 zone with its corner at the origin, on level `level_1`.
 */
const zone = {
  id: 'zone_a',
  type: 'zone',
  parentId: 'level_1',
  polygon: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
} as unknown as ZoneNode

function positioned(id: string, type: string, x: number, z: number, parentId = 'level_1') {
  return { id, type, parentId, position: [x, 1, z] } as unknown as AnyNode
}

function sceneOf(...nodes: AnyNode[]): Readonly<Record<AnyNodeId, AnyNode>> {
  return Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
}

describe('collectZoneObjectIds', () => {
  /**
   * The defect this function exists for: a zone full of racking reported
   * nothing inside it, because the only positioned kind the delete path knows
   * is `item` and a rack is `warehouse:pallet-rack`.
   */
  test('finds plugin-contributed kinds, not only item nodes', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 5, 5),
      positioned('item_1', 'item', 6, 6),
    )

    const found = collectZoneObjectIds(scene, zone)
    expect(found).toContain('rack_1' as AnyNodeId)
    expect(found).toContain('item_1' as AnyNodeId)

    // The delete path sees the item and misses the rack — the discrepancy this
    // function was added to work around rather than silently widen.
    expect(collectZoneContentIds(scene, zone)).not.toContain('rack_1' as AnyNodeId)
  })

  test('excludes objects standing outside the polygon', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('inside', 'warehouse:pallet', 1, 1),
      positioned('outside', 'warehouse:pallet', 40, 40),
    )
    const found = collectZoneObjectIds(scene, zone)
    expect(found).toContain('inside' as AnyNodeId)
    expect(found).not.toContain('outside' as AnyNodeId)
  })

  test('excludes objects on another level', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('here', 'warehouse:pallet', 5, 5),
      positioned('upstairs', 'warehouse:pallet', 5, 5, 'level_2'),
    )
    const found = collectZoneObjectIds(scene, zone)
    expect(found).toEqual(['here' as AnyNodeId])
  })

  /** A zone is not standing inside itself, and neither is its own fabric. */
  test('excludes the zone fabric and other zones', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('other_zone', 'zone', 5, 5),
      positioned('a_wall', 'wall', 5, 5),
      positioned('a_slab', 'slab', 5, 5),
      positioned('a_rack', 'warehouse:pallet-rack', 5, 5),
    )
    expect(collectZoneObjectIds(scene, zone)).toEqual(['a_rack' as AnyNodeId])
  })

  test('a node without a usable position is skipped rather than throwing', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      { id: 'no_pos', type: 'warehouse:pallet', parentId: 'level_1' } as unknown as AnyNode,
      positioned('ok', 'warehouse:pallet', 5, 5),
    )
    expect(collectZoneObjectIds(scene, zone)).toEqual(['ok' as AnyNodeId])
  })
})

describe('collectZoneObjectLabels', () => {
  // Read widened: a plugin kind is not in `AnyNode['type']`, which is the whole
  // reason a zone full of racking looked empty before `collectZoneObjectIds`.
  const displayName = (node: AnyNode) =>
    (node.type as string) === 'warehouse:pallet-rack' ? 'Pallet Rack' : ''

  test('one label per node standing in the zone', () => {
    const scene = sceneOf(
      positioned('a', 'warehouse:pallet-rack', 2, 2),
      positioned('b', 'warehouse:pallet-rack', 3, 3),
      positioned('c', 'item', 4, 4),
      positioned('far', 'warehouse:pallet-rack', 90, 90),
    )

    expect(collectZoneObjectLabels(scene, zone, displayName)).toEqual([
      'Pallet Rack',
      'Pallet Rack',
      'item',
    ])
  })

  /**
   * THE reason this returns strings.
   *
   * The panel reads it through `useShallow`, which compares elements with
   * `Object.is`. When the selector built `{ label, count }` objects, two calls
   * over an identical scene were never shallow-equal, so every render reported
   * a changed snapshot and React never settled — error 185, and the editor went
   * down the moment a zone panel opened. Nothing about the rendered output
   * catches that; only the stability of the value does.
   */
  test('two calls over an unchanged scene are shallow-equal', () => {
    const scene = sceneOf(
      positioned('a', 'warehouse:pallet-rack', 2, 2),
      positioned('b', 'warehouse:pallet-rack', 3, 3),
      positioned('c', 'item', 4, 4),
    )

    expect(
      shallow(
        collectZoneObjectLabels(scene, zone, displayName),
        collectZoneObjectLabels(scene, zone, displayName),
      ),
    ).toBe(true)
  })

  test('a moved node makes it shallow-UNequal, so the panel still updates', () => {
    const before = sceneOf(positioned('a', 'warehouse:pallet-rack', 2, 2))
    const after = sceneOf(positioned('a', 'warehouse:pallet-rack', 90, 90))

    expect(
      shallow(
        collectZoneObjectLabels(before, zone, displayName),
        collectZoneObjectLabels(after, zone, displayName),
      ),
    ).toBe(false)
  })
})

describe('collectZoneContentIds — delete with contents', () => {
  /**
   * `isPluginContributedKind` asks the REGISTRY, not the kind string, so a kind
   * only counts as plugin-contributed once a plugin has actually registered it.
   * Loading a real plugin manifest is what makes this test exercise the shipped
   * path instead of a prefix match that would pass for a string nobody owns.
   */
  beforeEach(async () => {
    await loadPlugin({
      id: 'test:warehouse',
      apiVersion: 1,
      nodes: [
        {
          kind: 'warehouse:pallet-rack',
          schemaVersion: 1,
          schema: {} as never,
          category: 'furnish',
          defaults: () => ({}) as never,
          capabilities: {},
          presentation: { label: 'Rack', icon: { kind: 'iconify', name: 'lucide:square' } },
        },
      ],
    } as never)
  })

  afterEach(() => {
    nodeRegistry._reset()
  })

  /**
   * The reported gap. Deleting a zone with its contents took the walls, the
   * slab and the ceiling and left a hundred pallet racks standing on a floor
   * that no longer existed. Nothing errored — the zone was simply gone and its
   * racking was not.
   */
  test('takes plugin objects standing in the zone', () => {
    const scene = sceneOf(
      positioned('rack', 'warehouse:pallet-rack', 2, 2),
      positioned('crate', 'item', 3, 3),
    )

    const found = collectZoneContentIds(scene, zone)
    expect(found).toContain('rack' as AnyNodeId)
    expect(found).toContain('crate' as AnyNodeId)
  })

  /**
   * The half that could go wrong quietly. Widening this to every positioned
   * node would start deleting host structural kinds from a menu entry whose
   * users have never seen it do that — a column inside the zone is not what
   * anyone means by "the zone's contents".
   */
  test('leaves host structural kinds alone', () => {
    const scene = sceneOf(positioned('col', 'column', 4, 4))
    expect(collectZoneContentIds(scene, zone)).not.toContain('col' as AnyNodeId)
  })

  test('ignores plugin objects outside the polygon', () => {
    const scene = sceneOf(positioned('far', 'warehouse:pallet-rack', 90, 90))
    expect(collectZoneContentIds(scene, zone)).not.toContain('far' as AnyNodeId)
  })
})
