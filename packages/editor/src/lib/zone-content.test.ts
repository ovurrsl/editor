import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  loadPlugin,
  nodeRegistry,
  type Plugin,
  registerZoneTakeoffExtension,
  type SlabNode,
  type WallNode,
  type ZoneNode,
  type ZoneTakeoffExtension,
} from '@pascal-app/core'
import { z } from 'zod'
import { shallow } from 'zustand/shallow'
import {
  collectZoneContentIds,
  collectZoneObjectIds,
  collectZoneObjectLabels,
  resolveZoneTakeoffReports,
} from './zone-content'

/**
 * Standard test plugin definition providing warehouse and custom domain kinds.
 */
const warehousePlugin: Plugin = {
  id: 'ovurrsl:warehouse',
  apiVersion: 1,
  nodes: [
    {
      kind: 'warehouse:pallet-rack',
      schemaVersion: 1,
      schema: z.object({}) as any,
      category: 'furnish',
      defaults: () => ({} as any),
      capabilities: { deletable: true },
    },
    {
      kind: 'warehouse:pallet',
      schemaVersion: 1,
      schema: z.object({}) as any,
      category: 'furnish',
      defaults: () => ({} as any),
      capabilities: { deletable: true },
    },
    {
      kind: 'warehouse:conveyor-roller',
      schemaVersion: 1,
      schema: z.object({}) as any,
      category: 'furnish',
      defaults: () => ({} as any),
      capabilities: { deletable: true },
    },
    {
      kind: 'warehouse:live-rack',
      schemaVersion: 1,
      schema: z.object({}) as any,
      category: 'furnish',
      defaults: () => ({} as any),
      capabilities: { deletable: true },
    },
    {
      kind: 'warehouse:drive-in-rack',
      schemaVersion: 1,
      schema: z.object({}) as any,
      category: 'furnish',
      defaults: () => ({} as any),
      capabilities: { deletable: true },
    },
    {
      kind: 'warehouse:longspan-rack',
      schemaVersion: 1,
      schema: z.object({}) as any,
      category: 'furnish',
      defaults: () => ({} as any),
      capabilities: { deletable: true },
    },
    {
      kind: 'warehouse:m3-rack',
      schemaVersion: 1,
      schema: z.object({}) as any,
      category: 'furnish',
      defaults: () => ({} as any),
      capabilities: { deletable: true },
    },
    {
      kind: 'warehouse:mezzanine',
      schemaVersion: 1,
      schema: z.object({}) as any,
      category: 'furnish',
      defaults: () => ({} as any),
      capabilities: { deletable: true },
    },
    {
      kind: 'warehouse:tote-cart',
      schemaVersion: 1,
      schema: z.object({}) as any,
      category: 'furnish',
      defaults: () => ({} as any),
      capabilities: { deletable: true },
    },
    {
      kind: 'custom:machine',
      schemaVersion: 1,
      schema: z.object({}) as any,
      category: 'furnish',
      defaults: () => ({} as any),
      capabilities: { deletable: true },
    },
    {
      kind: 'bones:lumber',
      schemaVersion: 1,
      schema: z.object({}) as any,
      category: 'furnish',
      defaults: () => ({} as any),
      capabilities: { deletable: true },
    },
  ],
}

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

function positioned(
  id: string,
  type: string,
  x: number,
  z: number,
  parentId = 'level_1',
  props: Record<string, unknown> = {},
) {
  return { id, type, parentId, position: [x, 1, z], ...props } as unknown as AnyNode
}

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  parentId = 'level_1',
  props: Record<string, unknown> = {},
): WallNode {
  return {
    id,
    type: 'wall',
    parentId,
    start,
    end,
    thickness: 0.2,
    height: 3,
    ...props,
  } as unknown as WallNode
}

function slab(
  id: string,
  polygon: [number, number][],
  parentId = 'level_1',
  props: Record<string, unknown> = {},
): SlabNode {
  return {
    id,
    type: 'slab',
    parentId,
    polygon,
    thickness: 0.2,
    ...props,
  } as unknown as SlabNode
}

function ceiling(
  id: string,
  polygon: [number, number][],
  parentId = 'level_1',
  props: Record<string, unknown> = {},
): CeilingNode {
  return {
    id,
    type: 'ceiling',
    parentId,
    polygon,
    thickness: 0.2,
    ...props,
  } as unknown as CeilingNode
}

function column(
  id: string,
  x: number,
  z: number,
  parentId = 'level_1',
  props: Record<string, unknown> = {},
): AnyNode {
  return {
    id,
    type: 'column',
    parentId,
    position: [x, 1, z],
    ...props,
  } as unknown as AnyNode
}

function sceneOf(...nodes: AnyNode[]): Readonly<Record<AnyNodeId, AnyNode>> {
  return Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AnyNodeId, AnyNode>
}

describe('collectZoneObjectIds', () => {
  beforeEach(async () => {
    nodeRegistry._reset()
    await loadPlugin(warehousePlugin)
  })

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

    // The delete path now collects plugin objects as well as items (R1).
    expect(collectZoneContentIds(scene, zone)).toContain('rack_1' as AnyNodeId)
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

describe('resolveZoneTakeoffReports', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  /**
   * Domain-accurate warehouse takeoff extension implementation for testing
   * host integration, takeoff resolution, and boundary filtering.
   */
  const warehouseExtension: ZoneTakeoffExtension = {
    id: 'pascal:warehouse:zone-takeoff',
    pluginId: 'ovurrsl:warehouse',
    supportsZone({ contentIds, nodes }) {
      if (!contentIds || contentIds.length === 0) return false
      return contentIds.some((id) => {
        const type = (nodes[id] as { type?: unknown })?.type
        return typeof type === 'string' && type.startsWith('warehouse:')
      })
    },
    deriveTakeoff({ zone, contentIds, nodes }) {
      let bays = 0
      let levels = 0
      let palletCapacity = 0
      let directAccess = 0
      let pickingCapacity = 0

      let palletRackBays = 0
      let driveInLanes = 0
      let liveRackChannels = 0
      let longspanBays = 0
      let m3Bays = 0
      let floorPallets = 0
      let mezzanines = 0

      for (const id of contentIds) {
        const node = nodes[id] as any
        if (!node || typeof node.type !== 'string' || !node.type.startsWith('warehouse:')) {
          continue
        }

        switch (node.type) {
          case 'warehouse:pallet-rack': {
            const b = node.bays ?? 1
            const lvls = node.levels ?? 4
            const slotsPerBayLevel = node.slotsPerBayLevel ?? 3
            palletRackBays += b
            bays += b
            levels += lvls
            const slots = b * lvls * slotsPerBayLevel
            palletCapacity += slots
            directAccess += slots
            if (node.pickingSlots) {
              pickingCapacity += node.pickingSlots
            }
            break
          }
          case 'warehouse:drive-in-rack': {
            const lanes = node.lanes ?? 1
            const lvls = node.levels ?? 4
            const depthPallets = node.depthPallets ?? 5
            driveInLanes += lanes
            bays += lanes
            levels += lvls
            const slots = lanes * lvls * depthPallets
            palletCapacity += slots
            directAccess += lanes * lvls
            break
          }
          case 'warehouse:live-rack': {
            const channels = node.channels ?? 1
            const lvls = node.levels ?? 3
            const depthPallets = node.depthPallets ?? 4
            liveRackChannels += channels
            bays += channels
            levels += lvls
            palletCapacity += channels * lvls * depthPallets
            directAccess += channels * lvls
            break
          }
          case 'warehouse:longspan-rack': {
            const b = node.bays ?? 1
            const lvls = node.levels ?? 4
            longspanBays += b
            bays += b
            levels += lvls
            pickingCapacity += b * lvls * 10
            break
          }
          case 'warehouse:m3-rack': {
            const b = node.bays ?? 1
            const lvls = node.levels ?? 5
            const drawers = node.drawers ?? 8
            m3Bays += b
            bays += b
            levels += lvls
            pickingCapacity += drawers
            break
          }
          case 'warehouse:mezzanine': {
            mezzanines += 1
            break
          }
          case 'warehouse:pallet': {
            floorPallets += 1
            palletCapacity += 1
            directAccess += 1
            break
          }
          case 'warehouse:tote-cart': {
            const cap = node.capacity ?? 4
            pickingCapacity += cap
            break
          }
        }
      }

      if (
        bays === 0 &&
        palletCapacity === 0 &&
        pickingCapacity === 0 &&
        floorPallets === 0 &&
        mezzanines === 0
      ) {
        return null
      }

      return {
        id: `${zone.id}:warehouse-takeoff`,
        title: 'Warehouse storage takeoff',
        metrics: [
          {
            key: 'total-bays',
            label: 'Storage Bays',
            value: bays,
            abbreviation: 'Bays',
            sublabel: `${bays} storage bays`,
          },
          {
            key: 'total-levels',
            label: 'Storage Levels',
            value: levels,
            abbreviation: 'Lvls',
            sublabel: 'Beams & shelves',
          },
          {
            key: 'pallet-capacity',
            label: 'Pallet Capacity',
            value: palletCapacity,
            abbreviation: 'Pallets',
            sublabel: `${directAccess} direct access`,
          },
          {
            key: 'picking-capacity',
            label: 'Carton / Picking',
            value: pickingCapacity,
            abbreviation: 'Pick',
            sublabel: 'Carton & tote slots',
          },
        ],
        breakdown: [
          ...(palletRackBays > 0
            ? [
                {
                  id: 'selective-pallet-rack',
                  label: 'Selective Pallet Rack',
                  count: palletRackBays,
                },
              ]
            : []),
          ...(driveInLanes > 0
            ? [{ id: 'drive-in-rack', label: 'Drive-In Rack', count: driveInLanes }]
            : []),
          ...(liveRackChannels > 0
            ? [{ id: 'live-rack', label: 'Live Dynamic Racking', count: liveRackChannels }]
            : []),
          ...(longspanBays > 0
            ? [{ id: 'longspan-shelving', label: 'Longspan M7 Shelving', count: longspanBays }]
            : []),
          ...(m3Bays > 0
            ? [{ id: 'm3-shelving', label: 'M3 Picking Shelving', count: m3Bays }]
            : []),
          ...(floorPallets > 0
            ? [{ id: 'floor-pallets', label: 'Floor Pallet Staging', count: floorPallets }]
            : []),
          ...(mezzanines > 0
            ? [{ id: 'mezzanines', label: 'Mezzanine Raised Platforms', count: mezzanines }]
            : []),
        ],
      }
    },
  }

  test('returns stable EMPTY_TAKEOFF_REPORTS when no extensions are active', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 5, 5),
    )
    const reports1 = resolveZoneTakeoffReports(scene, zone)
    const reports2 = resolveZoneTakeoffReports(scene, zone)

    expect(reports1).toEqual([])
    expect(reports2).toEqual([])
    expect(reports1).toBe(reports2) // Stable empty array reference
  })

  test('returns stable EMPTY_TAKEOFF_REPORTS when zone has no warehouse objects', () => {
    registerZoneTakeoffExtension(warehouseExtension)
    const scene = sceneOf(zone as unknown as AnyNode, positioned('item_1', 'item', 5, 5))
    const reports = resolveZoneTakeoffReports(scene, zone)
    expect(reports).toEqual([])
  })

  test('resolves detailed warehouse metrics (bays, levels, pallet/carton capacities) for rack nodes', () => {
    registerZoneTakeoffExtension(warehouseExtension)

    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 3, 3, 'level_1', {
        bays: 4,
        levels: 5,
        slotsPerBayLevel: 3, // 4 * 5 * 3 = 60 pallets
        pickingSlots: 12,
      }),
      positioned('drivein_1', 'warehouse:drive-in-rack', 7, 7, 'level_1', {
        lanes: 2,
        levels: 4,
        depthPallets: 5, // 2 * 4 * 5 = 40 pallets
      }),
    )

    const reports = resolveZoneTakeoffReports(scene, zone)
    expect(reports).toHaveLength(1)

    const report = reports[0]!
    expect(report.id).toBe('zone_a:warehouse-takeoff')
    expect(report.title).toBe('Warehouse storage takeoff')

    // Bays: 4 (pallet rack) + 2 (drive in lanes) = 6 bays
    const baysMetric = report.metrics.find((m) => m.key === 'total-bays')
    expect(baysMetric?.value).toBe(6)

    // Levels: 5 (pallet rack) + 4 (drive in) = 9 levels
    const levelsMetric = report.metrics.find((m) => m.key === 'total-levels')
    expect(levelsMetric?.value).toBe(9)

    // Pallet capacity: 60 + 40 = 100 pallet positions
    const palletMetric = report.metrics.find((m) => m.key === 'pallet-capacity')
    expect(palletMetric?.value).toBe(100)

    // Picking slots: 12
    const pickMetric = report.metrics.find((m) => m.key === 'picking-capacity')
    expect(pickMetric?.value).toBe(12)

    // Breakdown includes both rack kinds with exact counts
    expect(report.breakdown).toBeDefined()
    expect(report.breakdown?.find((b) => b.id === 'selective-pallet-rack')?.count).toBe(4)
    expect(report.breakdown?.find((b) => b.id === 'drive-in-rack')?.count).toBe(2)
  })

  test('resolves mixed multi-equipment takeoff: live-rack, longspan, m3, mezzanine, floor pallet, tote cart', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('live_1', 'warehouse:live-rack', 2, 2, 'level_1', {
        channels: 3,
        levels: 4,
        depthPallets: 5, // 3 * 4 * 5 = 60 pallets
      }),
      positioned('longspan_1', 'warehouse:longspan-rack', 4, 4, 'level_1', {
        bays: 2,
        levels: 4, // 2 * 4 * 10 = 80 picking items
      }),
      positioned('m3_1', 'warehouse:m3-rack', 6, 6, 'level_1', {
        bays: 3,
        levels: 6,
        drawers: 24, // 24 drawers
      }),
      positioned('pallet_1', 'warehouse:pallet', 8, 2, 'level_1'),
      positioned('cart_1', 'warehouse:tote-cart', 8, 4, 'level_1', { capacity: 6 }),
      positioned('mezz_1', 'warehouse:mezzanine', 8, 8, 'level_1'),
    )

    const reports = resolveZoneTakeoffReports(scene, zone, [warehouseExtension])
    expect(reports).toHaveLength(1)

    const report = reports[0]!
    // Bays: 3 (live) + 2 (longspan) + 3 (m3) = 8 bays
    expect(report.metrics.find((m) => m.key === 'total-bays')?.value).toBe(8)
    // Levels: 4 + 4 + 6 = 14 levels
    expect(report.metrics.find((m) => m.key === 'total-levels')?.value).toBe(14)
    // Pallet capacity: 60 (live) + 1 (floor pallet) = 61 pallets
    expect(report.metrics.find((m) => m.key === 'pallet-capacity')?.value).toBe(61)
    // Picking capacity: 80 (longspan) + 24 (m3 drawers) + 6 (tote cart) = 110 picking slots
    expect(report.metrics.find((m) => m.key === 'picking-capacity')?.value).toBe(110)

    // Breakdown includes all categories
    const breakdownIds = report.breakdown?.map((b) => b.id)
    expect(breakdownIds).toContain('live-rack')
    expect(breakdownIds).toContain('longspan-shelving')
    expect(breakdownIds).toContain('m3-shelving')
    expect(breakdownIds).toContain('floor-pallets')
    expect(breakdownIds).toContain('mezzanines')
  })

  test('excludes objects outside the zone polygon from takeoff calculation', () => {
    registerZoneTakeoffExtension(warehouseExtension)

    const scene = sceneOf(
      zone as unknown as AnyNode,
      // Inside zone (0..10, 0..10)
      positioned('inside_rack', 'warehouse:pallet-rack', 5, 5, 'level_1', {
        bays: 2,
        levels: 4,
        slotsPerBayLevel: 2, // 16 pallets
      }),
      // Outside zone polygon
      positioned('outside_rack', 'warehouse:pallet-rack', 50, 50, 'level_1', {
        bays: 10,
        levels: 10,
        slotsPerBayLevel: 3, // 300 pallets
      }),
      positioned('outside_pallet', 'warehouse:pallet', 100, 100, 'level_1'),
    )

    const reports = resolveZoneTakeoffReports(scene, zone)
    expect(reports).toHaveLength(1)

    const report = reports[0]!
    // Only inside_rack (2 bays, 16 pallets) is counted; outside racks are completely excluded
    expect(report.metrics.find((m) => m.key === 'total-bays')?.value).toBe(2)
    expect(report.metrics.find((m) => m.key === 'pallet-capacity')?.value).toBe(16)
    expect(report.breakdown?.find((b) => b.id === 'selective-pallet-rack')?.count).toBe(2)
    expect(report.breakdown?.find((b) => b.id === 'floor-pallets')).toBeUndefined()
  })

  test('excludes objects on different parent levels from takeoff calculation', () => {
    registerZoneTakeoffExtension(warehouseExtension)

    const scene = sceneOf(
      zone as unknown as AnyNode,
      // On level_1 (matching zone.parentId)
      positioned('level1_rack', 'warehouse:pallet-rack', 5, 5, 'level_1', {
        bays: 3,
        levels: 4,
        slotsPerBayLevel: 2, // 24 pallets
      }),
      // On level_2 (different level)
      positioned('level2_rack', 'warehouse:pallet-rack', 5, 5, 'level_2', {
        bays: 8,
        levels: 5,
        slotsPerBayLevel: 3, // 120 pallets
      }),
    )

    const reports = resolveZoneTakeoffReports(scene, zone)
    expect(reports).toHaveLength(1)

    const report = reports[0]!
    expect(report.metrics.find((m) => m.key === 'total-bays')?.value).toBe(3)
    expect(report.metrics.find((m) => m.key === 'pallet-capacity')?.value).toBe(24)
  })

  test('excludes zone fabric nodes (wall, slab, ceiling, zone) from takeoff calculation', () => {
    registerZoneTakeoffExtension(warehouseExtension)

    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('wall_1', 'wall', 5, 5),
      positioned('slab_1', 'slab', 5, 5),
      positioned('ceiling_1', 'ceiling', 5, 5),
      positioned('zone_2', 'zone', 5, 5),
      positioned('rack_1', 'warehouse:pallet-rack', 5, 5, 'level_1', {
        bays: 2,
        levels: 3,
        slotsPerBayLevel: 2, // 12 pallets
      }),
    )

    const reports = resolveZoneTakeoffReports(scene, zone)
    expect(reports).toHaveLength(1)
    expect(reports[0]?.metrics.find((m) => m.key === 'total-bays')?.value).toBe(2)
  })

  /**
   * Shallow equality and render stability test to guard against React 185 render loops.
   */
  test('preserves reference and shallow equality stability across multiple evaluations of unchanged scene', () => {
    registerZoneTakeoffExtension(warehouseExtension)

    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 4, 4, 'level_1', {
        bays: 2,
        levels: 4,
        slotsPerBayLevel: 2,
      }),
      positioned('m3_1', 'warehouse:m3-rack', 6, 6, 'level_1', {
        bays: 1,
        levels: 4,
        drawers: 8,
      }),
    )

    const run1 = resolveZoneTakeoffReports(scene, zone)
    const run2 = resolveZoneTakeoffReports(scene, zone)

    // Deep equality of reports across evaluations
    expect(run1).toEqual(run2)
    expect(run1[0]?.metrics).toEqual(run2[0]?.metrics)
    expect(run1[0]?.breakdown).toEqual(run2[0]?.breakdown)

    // Metric keys and values match exactly
    const metricKeys1 = run1[0]?.metrics.map((m) => `${m.key}:${m.value}`)
    const metricKeys2 = run2[0]?.metrics.map((m) => `${m.key}:${m.value}`)
    expect(shallow(metricKeys1, metricKeys2)).toBe(true)

    // Empty scene yields identical reference for EMPTY_TAKEOFF_REPORTS
    const emptyScene = sceneOf(zone as unknown as AnyNode)
    const emptyRun1 = resolveZoneTakeoffReports(emptyScene, zone)
    const emptyRun2 = resolveZoneTakeoffReports(emptyScene, zone)
    expect(emptyRun1).toBe(emptyRun2)
    expect(shallow(emptyRun1, emptyRun2)).toBe(true)
  })

  test('scene mutation properly changes report and breaks shallow equality for reactivity', () => {
    registerZoneTakeoffExtension(warehouseExtension)

    const before = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 4, 4, 'level_1', {
        bays: 2,
        levels: 4,
        slotsPerBayLevel: 2,
      }),
    )
    // Move rack outside the zone
    const after = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 99, 99, 'level_1', {
        bays: 2,
        levels: 4,
        slotsPerBayLevel: 2,
      }),
    )

    const reportsBefore = resolveZoneTakeoffReports(before, zone)
    const reportsAfter = resolveZoneTakeoffReports(after, zone)

    expect(reportsBefore).toHaveLength(1)
    expect(reportsAfter).toHaveLength(0)
    expect(shallow(reportsBefore, reportsAfter)).toBe(false)
  })
})

// ============================================================================
// TIER 1: FEATURE COVERAGE (R1: Plugin Objects & R2: Structural Hosts)
// ============================================================================
describe('collectZoneContentIds - Tier 1: Feature Coverage (R1 & R2)', () => {
  beforeEach(async () => {
    nodeRegistry._reset()
    await loadPlugin(warehousePlugin)
  })

  // --------------------------------------------------------------------------
  // R1: Plugin-Contributed Object Deletion
  // --------------------------------------------------------------------------
  test('R1: collects warehouse:pallet-rack located inside zone polygon', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 3, 3),
      positioned('rack_2', 'warehouse:pallet-rack', 7, 7),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('rack_1' as AnyNodeId)
    expect(contentIds).toContain('rack_2' as AnyNodeId)
  })

  test('R1: collects warehouse:pallet located inside zone polygon', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('pallet_1', 'warehouse:pallet', 2, 2),
      positioned('pallet_2', 'warehouse:pallet', 8, 8),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('pallet_1' as AnyNodeId)
    expect(contentIds).toContain('pallet_2' as AnyNodeId)
  })

  test('R1: collects warehouse:conveyor-roller located inside zone polygon', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('conveyor_1', 'warehouse:conveyor-roller', 4, 4),
      positioned('conveyor_2', 'warehouse:conveyor-roller', 6, 6),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('conveyor_1' as AnyNodeId)
    expect(contentIds).toContain('conveyor_2' as AnyNodeId)
  })

  test('R1: collects warehouse:live-rack and warehouse:drive-in-rack located inside zone polygon', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('live_1', 'warehouse:live-rack', 3, 3),
      positioned('drivein_1', 'warehouse:drive-in-rack', 6, 6),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('live_1' as AnyNodeId)
    expect(contentIds).toContain('drivein_1' as AnyNodeId)
  })

  test('R1: collects multiple diverse plugin-contributed objects (mezzanine, cart, bones:lumber, custom:machine)', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('mezz_1', 'warehouse:mezzanine', 2, 2),
      positioned('cart_1', 'warehouse:tote-cart', 3, 3),
      positioned('lumber_1', 'bones:lumber', 4, 4),
      positioned('machine_1', 'custom:machine', 5, 5),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('mezz_1' as AnyNodeId)
    expect(contentIds).toContain('cart_1' as AnyNodeId)
    expect(contentIds).toContain('lumber_1' as AnyNodeId)
    expect(contentIds).toContain('machine_1' as AnyNodeId)
  })

  // --------------------------------------------------------------------------
  // R2: Structural Host Preservation
  // --------------------------------------------------------------------------
  test('R2: strictly excludes structural column nodes located inside zone polygon', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      column('col_center', 5, 5),
      column('col_corner', 2, 2),
      positioned('rack_1', 'warehouse:pallet-rack', 5, 5),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('rack_1' as AnyNodeId)
    expect(contentIds).not.toContain('col_center' as AnyNodeId)
    expect(contentIds).not.toContain('col_corner' as AnyNodeId)
  })

  test('R2: strictly excludes interior partition walls that do NOT lie on zone boundary', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      // Interior partition wall inside zone [0..10, 0..10]
      wall('interior_wall', [2, 5], [8, 5]),
      positioned('rack_1', 'warehouse:pallet-rack', 5, 3),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('rack_1' as AnyNodeId)
    expect(contentIds).not.toContain('interior_wall' as AnyNodeId)
  })

  test('R2: strictly excludes non-matching slabs (e.g. partial slab or building-wide slab)', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      // Building-wide slab with different footprint
      slab('building_slab', [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ]),
      // Partial interior slab
      slab('partial_slab', [
        [2, 2],
        [6, 2],
        [6, 6],
        [2, 6],
      ]),
      positioned('item_1', 'item', 4, 4),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('item_1' as AnyNodeId)
    expect(contentIds).not.toContain('building_slab' as AnyNodeId)
    expect(contentIds).not.toContain('partial_slab' as AnyNodeId)
  })

  test('R2: strictly excludes non-matching ceilings', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      ceiling('partial_ceiling', [
        [1, 1],
        [4, 1],
        [4, 4],
        [1, 4],
      ]),
      positioned('item_1', 'item', 5, 5),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('item_1' as AnyNodeId)
    expect(contentIds).not.toContain('partial_ceiling' as AnyNodeId)
  })

  test('R2: strictly excludes other zone nodes located inside polygon', () => {
    const subZone = {
      id: 'nested_zone',
      type: 'zone',
      parentId: 'level_1',
      polygon: [
        [2, 2],
        [4, 2],
        [4, 4],
        [2, 4],
      ],
    } as unknown as ZoneNode

    const scene = sceneOf(
      zone as unknown as AnyNode,
      subZone as unknown as AnyNode,
      positioned('item_1', 'item', 3, 3),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('item_1' as AnyNodeId)
    expect(contentIds).not.toContain('nested_zone' as AnyNodeId)
  })

  test('R2: strictly excludes structural container kinds (level, building, site)', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('site_node', 'site', 5, 5),
      positioned('building_node', 'building', 5, 5),
      positioned('level_node', 'level', 5, 5),
      positioned('item_1', 'item', 5, 5),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('item_1' as AnyNodeId)
    expect(contentIds).not.toContain('site_node' as AnyNodeId)
    expect(contentIds).not.toContain('building_node' as AnyNodeId)
    expect(contentIds).not.toContain('level_node' as AnyNodeId)
  })

  // --------------------------------------------------------------------------
  // Standard Items & Fabric Baseline
  // --------------------------------------------------------------------------
  test('collects standard item nodes located inside zone polygon', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('item_1', 'item', 2, 2),
      positioned('item_2', 'item', 8, 8),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('item_1' as AnyNodeId)
    expect(contentIds).toContain('item_2' as AnyNodeId)
  })

  test('collects boundary walls that lie on the zone perimeter segments', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      wall('wall_south', [0, 0], [10, 0]),
      wall('wall_east', [10, 0], [10, 10]),
      wall('wall_north', [10, 10], [0, 10]),
      wall('wall_west', [0, 10], [0, 0]),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('wall_south' as AnyNodeId)
    expect(contentIds).toContain('wall_east' as AnyNodeId)
    expect(contentIds).toContain('wall_north' as AnyNodeId)
    expect(contentIds).toContain('wall_west' as AnyNodeId)
  })

  test('collects matching slab and ceiling surfaces with identical footprint', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      slab('zone_slab', [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
      ceiling('zone_ceiling', [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('zone_slab' as AnyNodeId)
    expect(contentIds).toContain('zone_ceiling' as AnyNodeId)
  })
})

// ============================================================================
// TIER 2: BOUNDARY, COORDINATE & LEVEL EDGE CASES
// ============================================================================
describe('collectZoneContentIds - Tier 2: Boundary, Geometry & Level Edge Cases', () => {
  beforeEach(async () => {
    nodeRegistry._reset()
    await loadPlugin(warehousePlugin)
  })

  test('excludes plugin objects and items located outside zone polygon', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('inside_rack', 'warehouse:pallet-rack', 5, 5),
      positioned('outside_rack_x', 'warehouse:pallet-rack', 15, 5),
      positioned('outside_rack_z', 'warehouse:pallet-rack', 5, -5),
      positioned('outside_item', 'item', 25, 25),
      positioned('far_rack', 'warehouse:pallet-rack', 1000, 1000),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('inside_rack' as AnyNodeId)
    expect(contentIds).not.toContain('outside_rack_x' as AnyNodeId)
    expect(contentIds).not.toContain('outside_rack_z' as AnyNodeId)
    expect(contentIds).not.toContain('outside_item' as AnyNodeId)
    expect(contentIds).not.toContain('far_rack' as AnyNodeId)
  })

  test('excludes plugin objects and items on different levels (parentId mismatch)', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('level1_rack', 'warehouse:pallet-rack', 5, 5, 'level_1'),
      positioned('level1_item', 'item', 6, 6, 'level_1'),
      positioned('level2_rack', 'warehouse:pallet-rack', 5, 5, 'level_2'),
      positioned('level2_item', 'item', 6, 6, 'level_2'),
      positioned('null_parent_rack', 'warehouse:pallet-rack', 5, 5, null as any),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('level1_rack' as AnyNodeId)
    expect(contentIds).toContain('level1_item' as AnyNodeId)
    expect(contentIds).not.toContain('level2_rack' as AnyNodeId)
    expect(contentIds).not.toContain('level2_item' as AnyNodeId)
    expect(contentIds).not.toContain('null_parent_rack' as AnyNodeId)
  })

  test('handles objects located directly on polygon perimeter segments and vertices within POINT_TOLERANCE (0.5m)', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      // Exactly on corner vertices
      positioned('rack_origin', 'warehouse:pallet-rack', 0, 0),
      positioned('rack_corner_ne', 'warehouse:pallet-rack', 10, 10),
      // Exactly on boundary edge
      positioned('rack_edge_south', 'warehouse:pallet-rack', 5, 0),
      // Inside 0.5m tolerance envelope (e.g. x = 10.3)
      positioned('rack_near_east', 'warehouse:pallet-rack', 10.3, 5),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('rack_origin' as AnyNodeId)
    expect(contentIds).toContain('rack_corner_ne' as AnyNodeId)
    expect(contentIds).toContain('rack_edge_south' as AnyNodeId)
    expect(contentIds).toContain('rack_near_east' as AnyNodeId)
  })

  test('excludes objects just outside the POINT_TOLERANCE margin (> 0.5m)', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      // Outside tolerance (0.7m away from edge x = 10)
      positioned('rack_too_far_east', 'warehouse:pallet-rack', 10.7, 5),
      positioned('item_too_far_north', 'item', 5, 10.7),
    )
    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).not.toContain('rack_too_far_east' as AnyNodeId)
    expect(contentIds).not.toContain('item_too_far_north' as AnyNodeId)
  })

  test('returns empty array when zone parentId is null or empty string', () => {
    const orphanZone = {
      id: 'orphan_zone',
      type: 'zone',
      parentId: null as any,
      polygon: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    } as unknown as ZoneNode

    const scene = sceneOf(
      orphanZone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 5, 5, 'level_1'),
      positioned('item_1', 'item', 5, 5, 'level_1'),
    )
    expect(collectZoneContentIds(scene, orphanZone)).toEqual([])
  })

  test('returns empty array when scene has no matching nodes or empty scene', () => {
    const emptyScene = sceneOf(zone as unknown as AnyNode)
    expect(collectZoneContentIds(emptyScene, zone)).toEqual([])

    const emptyRecord: Record<AnyNodeId, AnyNode> = {}
    expect(collectZoneContentIds(emptyRecord, zone)).toEqual([])
  })

  test('handles nodes with malformed or missing positions gracefully without throwing', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      { id: 'pos_none', type: 'warehouse:pallet-rack', parentId: 'level_1' } as unknown as AnyNode,
      {
        id: 'pos_short',
        type: 'warehouse:pallet-rack',
        parentId: 'level_1',
        position: [5],
      } as unknown as AnyNode,
      {
        id: 'pos_nan',
        type: 'warehouse:pallet-rack',
        parentId: 'level_1',
        position: [NaN, 1, 5],
      } as unknown as AnyNode,
      {
        id: 'pos_string',
        type: 'warehouse:pallet-rack',
        parentId: 'level_1',
        position: ['5', '1', '5'] as any,
      } as unknown as AnyNode,
      positioned('valid_rack', 'warehouse:pallet-rack', 5, 5),
    )

    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('valid_rack' as AnyNodeId)
    expect(contentIds).not.toContain('pos_none' as AnyNodeId)
    expect(contentIds).not.toContain('pos_short' as AnyNodeId)
    expect(contentIds).not.toContain('pos_nan' as AnyNodeId)
    expect(contentIds).not.toContain('pos_string' as AnyNodeId)
  })

  test('handles non-convex (L-shaped) zone polygon containment correctly', () => {
    const lZone = {
      id: 'l_zone',
      type: 'zone',
      parentId: 'level_1',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 5],
        [5, 5],
        [5, 10],
        [0, 10],
      ],
    } as unknown as ZoneNode

    const scene = sceneOf(
      lZone as unknown as AnyNode,
      positioned('inside_main', 'warehouse:pallet-rack', 2, 2),
      positioned('inside_arm_x', 'warehouse:pallet-rack', 8, 2),
      positioned('inside_arm_z', 'warehouse:pallet-rack', 2, 8),
      // In the cutout corner (7, 7) — outside L-shape
      positioned('in_cutout_rack', 'warehouse:pallet-rack', 7, 7),
      positioned('in_cutout_item', 'item', 8, 8),
    )

    const contentIds = collectZoneContentIds(scene, lZone)
    expect(contentIds).toContain('inside_main' as AnyNodeId)
    expect(contentIds).toContain('inside_arm_x' as AnyNodeId)
    expect(contentIds).toContain('inside_arm_z' as AnyNodeId)
    expect(contentIds).not.toContain('in_cutout_rack' as AnyNodeId)
    expect(contentIds).not.toContain('in_cutout_item' as AnyNodeId)
  })

  test('handles negative coordinate zone polygons correctly', () => {
    const negZone = {
      id: 'neg_zone',
      type: 'zone',
      parentId: 'level_1',
      polygon: [
        [-20, -20],
        [-10, -20],
        [-10, -10],
        [-20, -10],
      ],
    } as unknown as ZoneNode

    const scene = sceneOf(
      negZone as unknown as AnyNode,
      positioned('inside_neg_rack', 'warehouse:pallet-rack', -15, -15),
      positioned('inside_neg_item', 'item', -12, -18),
      positioned('outside_pos_rack', 'warehouse:pallet-rack', 5, 5),
    )

    const contentIds = collectZoneContentIds(scene, negZone)
    expect(contentIds).toContain('inside_neg_rack' as AnyNodeId)
    expect(contentIds).toContain('inside_neg_item' as AnyNodeId)
    expect(contentIds).not.toContain('outside_pos_rack' as AnyNodeId)
  })

  test('handles rotated or angled boundary walls collinear with zone edges', () => {
    const diamondZone = {
      id: 'diamond_zone',
      type: 'zone',
      parentId: 'level_1',
      polygon: [
        [0, 5],
        [5, 10],
        [10, 5],
        [5, 0],
      ],
    } as unknown as ZoneNode

    const scene = sceneOf(
      diamondZone as unknown as AnyNode,
      wall('w1', [0, 5], [5, 10]),
      wall('w2', [5, 10], [10, 5]),
      wall('w3', [10, 5], [5, 0]),
      wall('w4', [5, 0], [0, 5]),
      positioned('rack_center', 'warehouse:pallet-rack', 5, 5),
    )

    const contentIds = collectZoneContentIds(scene, diamondZone)
    expect(contentIds).toContain('w1' as AnyNodeId)
    expect(contentIds).toContain('w2' as AnyNodeId)
    expect(contentIds).toContain('w3' as AnyNodeId)
    expect(contentIds).toContain('w4' as AnyNodeId)
    expect(contentIds).toContain('rack_center' as AnyNodeId)
  })
})

// ============================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS
// ============================================================================
describe('collectZoneContentIds - Tier 3: Cross-Feature Combinations', () => {
  beforeEach(async () => {
    nodeRegistry._reset()
    await loadPlugin(warehousePlugin)
  })

  test('mixed scene: collects boundary walls, matching slab/ceiling, items, and racks while strictly excluding columns, interior walls, and upstairs elements', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      // Boundary walls (should be collected)
      wall('b_wall_1', [0, 0], [10, 0]),
      wall('b_wall_2', [10, 0], [10, 10]),
      wall('b_wall_3', [10, 10], [0, 10]),
      wall('b_wall_4', [0, 10], [0, 0]),
      // Matching surfaces (should be collected)
      slab('match_slab', [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
      ceiling('match_ceiling', [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
      // Inside plugin objects (should be collected - R1)
      positioned('rack_a', 'warehouse:pallet-rack', 3, 3),
      positioned('rack_b', 'warehouse:pallet-rack', 7, 3),
      positioned('pallet_a', 'warehouse:pallet', 3, 7),
      positioned('conveyor_a', 'warehouse:conveyor-roller', 7, 7),
      // Inside items (should be collected)
      positioned('item_box_1', 'item', 4, 4),
      positioned('item_box_2', 'item', 6, 6),
      // Structural columns inside zone (MUST BE EXCLUDED - R2)
      column('column_grid_1', 2, 5),
      column('column_grid_2', 8, 5),
      // Interior non-boundary wall inside zone (MUST BE EXCLUDED - R2)
      wall('interior_partition', [4, 2], [4, 8]),
      // Elements outside zone (MUST BE EXCLUDED)
      positioned('rack_outside', 'warehouse:pallet-rack', 50, 50),
      column('column_outside', 50, 50),
      wall('wall_outside', [50, 0], [60, 0]),
      // Elements on level_2 (MUST BE EXCLUDED)
      positioned('rack_level2', 'warehouse:pallet-rack', 5, 5, 'level_2'),
      positioned('item_level2', 'item', 5, 5, 'level_2'),
    )

    const contentIds = collectZoneContentIds(scene, zone)

    // Expected collected IDs
    const expectedCollected: AnyNodeId[] = [
      'b_wall_1' as AnyNodeId,
      'b_wall_2' as AnyNodeId,
      'b_wall_3' as AnyNodeId,
      'b_wall_4' as AnyNodeId,
      'match_slab' as AnyNodeId,
      'match_ceiling' as AnyNodeId,
      'rack_a' as AnyNodeId,
      'rack_b' as AnyNodeId,
      'pallet_a' as AnyNodeId,
      'conveyor_a' as AnyNodeId,
      'item_box_1' as AnyNodeId,
      'item_box_2' as AnyNodeId,
    ]

    for (const expectedId of expectedCollected) {
      expect(contentIds).toContain(expectedId)
    }

    // Expected excluded IDs
    const expectedExcluded: AnyNodeId[] = [
      'column_grid_1' as AnyNodeId,
      'column_grid_2' as AnyNodeId,
      'interior_partition' as AnyNodeId,
      'rack_outside' as AnyNodeId,
      'column_outside' as AnyNodeId,
      'wall_outside' as AnyNodeId,
      'rack_level2' as AnyNodeId,
      'item_level2' as AnyNodeId,
    ]

    for (const excludedId of expectedExcluded) {
      expect(contentIds).not.toContain(excludedId)
    }

    expect(contentIds).toHaveLength(expectedCollected.length)
  })

  test('multi-equipment warehouse aisle with interleaved columns and racks', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('rack_1', 'warehouse:pallet-rack', 2, 2),
      column('col_1', 2, 5),
      positioned('rack_2', 'warehouse:pallet-rack', 2, 8),
      positioned('cart_1', 'warehouse:tote-cart', 5, 2),
      column('col_2', 5, 5),
      positioned('cart_2', 'warehouse:tote-cart', 5, 8),
    )

    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('rack_1' as AnyNodeId)
    expect(contentIds).toContain('rack_2' as AnyNodeId)
    expect(contentIds).toContain('cart_1' as AnyNodeId)
    expect(contentIds).toContain('cart_2' as AnyNodeId)
    expect(contentIds).not.toContain('col_1' as AnyNodeId)
    expect(contentIds).not.toContain('col_2' as AnyNodeId)
  })

  test('co-located item, plugin rack, and column at the exact same XZ coordinate: item and rack collected, column preserved', () => {
    const scene = sceneOf(
      zone as unknown as AnyNode,
      positioned('colocated_item', 'item', 5, 5),
      positioned('colocated_rack', 'warehouse:pallet-rack', 5, 5),
      column('colocated_col', 5, 5),
    )

    const contentIds = collectZoneContentIds(scene, zone)
    expect(contentIds).toContain('colocated_item' as AnyNodeId)
    expect(contentIds).toContain('colocated_rack' as AnyNodeId)
    expect(contentIds).not.toContain('colocated_col' as AnyNodeId)
  })
})

// ============================================================================
// TIER 4: REAL-WORLD APPLICATION SCENARIOS
// ============================================================================
describe('collectZoneContentIds - Tier 4: Real-World Application Scenarios', () => {
  beforeEach(async () => {
    nodeRegistry._reset()
    await loadPlugin(warehousePlugin)
  })

  /**
   * Scenario 1: Full Warehouse Bay Zone Deletion
   *
   * A 50m x 30m storage bay zone containing:
   * - 10 Selective pallet racks
   * - 4 Live dynamic racks
   * - 20 Floor pallet staging positions
   * - 15 Tote carts
   * - 8 Standard inventory items
   * - 6 Heavy structural building columns (grid lines)
   * - 4 Building perimeter boundary walls
   * - 2 Interior office partition walls
   * - 1 Matching bay foundation slab
   *
   * Requirement: All warehouse storage equipment, floor pallets, carts, items,
   * boundary walls, and slab must be collected for deletion.
   * All 6 structural columns and 2 interior partition walls must remain intact.
   */
  test('Scenario 1: Full Warehouse Bay Zone Deletion - Pallet racks and loose boxes deleted, structural columns and building envelope intact', () => {
    const bayZone = {
      id: 'zone_bay_1',
      type: 'zone',
      parentId: 'level_ground',
      polygon: [
        [0, 0],
        [50, 0],
        [50, 30],
        [0, 30],
      ],
    } as unknown as ZoneNode

    const nodes: AnyNode[] = [
      bayZone as unknown as AnyNode,
      // 4 Perimeter Boundary Walls
      wall('bay_wall_s', [0, 0], [50, 0], 'level_ground'),
      wall('bay_wall_e', [50, 0], [50, 30], 'level_ground'),
      wall('bay_wall_n', [50, 30], [0, 30], 'level_ground'),
      wall('bay_wall_w', [0, 30], [0, 0], 'level_ground'),
      // Matching Bay Slab
      slab(
        'bay_slab',
        [
          [0, 0],
          [50, 0],
          [50, 30],
          [0, 30],
        ],
        'level_ground',
      ),
      // 2 Interior Office Partition Walls (must NOT be deleted)
      wall('office_wall_1', [40, 20], [48, 20], 'level_ground'),
      wall('office_wall_2', [40, 20], [40, 28], 'level_ground'),
    ]

    // 6 Structural Building Grid Columns at (x=10,30, y=5,15,25) (must NOT be deleted)
    const columnIds: string[] = []
    let colIdx = 1
    for (const x of [10, 30]) {
      for (const z of [5, 15, 25]) {
        const id = `struct_col_${colIdx++}`
        columnIds.push(id)
        nodes.push(column(id, x, z, 'level_ground'))
      }
    }

    // 10 Selective Pallet Racks
    const rackIds: string[] = []
    for (let i = 1; i <= 10; i++) {
      const id = `pallet_rack_${i}`
      rackIds.push(id)
      nodes.push(positioned(id, 'warehouse:pallet-rack', i * 4, 10, 'level_ground'))
    }

    // 4 Live Racks
    const liveRackIds: string[] = []
    for (let i = 1; i <= 4; i++) {
      const id = `live_rack_${i}`
      liveRackIds.push(id)
      nodes.push(positioned(id, 'warehouse:live-rack', i * 10, 20, 'level_ground'))
    }

    // 20 Floor Pallets
    const floorPalletIds: string[] = []
    for (let i = 1; i <= 20; i++) {
      const id = `floor_pallet_${i}`
      floorPalletIds.push(id)
      nodes.push(positioned(id, 'warehouse:pallet', (i % 10) * 4 + 2, Math.floor(i / 10) * 4 + 2, 'level_ground'))
    }

    // 15 Tote Carts
    const cartIds: string[] = []
    for (let i = 1; i <= 15; i++) {
      const id = `tote_cart_${i}`
      cartIds.push(id)
      nodes.push(positioned(id, 'warehouse:tote-cart', (i % 5) * 8 + 3, Math.floor(i / 5) * 8 + 3, 'level_ground'))
    }

    // 8 Standard Items
    const itemIds: string[] = []
    for (let i = 1; i <= 8; i++) {
      const id = `inventory_item_${i}`
      itemIds.push(id)
      nodes.push(positioned(id, 'item', i * 5 + 1, 15, 'level_ground'))
    }

    const scene = sceneOf(...nodes)
    const contentIds = collectZoneContentIds(scene, bayZone)

    // Verify all racks, live-racks, pallets, carts, and items collected
    for (const id of rackIds) expect(contentIds).toContain(id as AnyNodeId)
    for (const id of liveRackIds) expect(contentIds).toContain(id as AnyNodeId)
    for (const id of floorPalletIds) expect(contentIds).toContain(id as AnyNodeId)
    for (const id of cartIds) expect(contentIds).toContain(id as AnyNodeId)
    for (const id of itemIds) expect(contentIds).toContain(id as AnyNodeId)

    // Verify boundary walls and slab collected
    expect(contentIds).toContain('bay_wall_s' as AnyNodeId)
    expect(contentIds).toContain('bay_wall_e' as AnyNodeId)
    expect(contentIds).toContain('bay_wall_n' as AnyNodeId)
    expect(contentIds).toContain('bay_wall_w' as AnyNodeId)
    expect(contentIds).toContain('bay_slab' as AnyNodeId)

    // Verify all 6 structural columns are preserved
    for (const id of columnIds) expect(contentIds).not.toContain(id as AnyNodeId)

    // Verify interior office partition walls are preserved
    expect(contentIds).not.toContain('office_wall_1' as AnyNodeId)
    expect(contentIds).not.toContain('office_wall_2' as AnyNodeId)

    // Total collected count: 10 racks + 4 live + 20 pallets + 15 carts + 8 items + 4 walls + 1 slab = 62
    expect(contentIds).toHaveLength(62)
  })

  /**
   * Scenario 2: Mezzanine Storage Zone Deletion
   *
   * A mezzanine storage zone (20m x 20m) with longspan shelving, m3 picking units,
   * raised mezzanine platforms, and loose items, constructed around central building columns.
   *
   * Requirement: Mezzanine platforms, shelving units, carts, and items are collected;
   * structural building columns passing through the platform must remain untouched.
   */
  test('Scenario 2: Mezzanine Storage Zone Deletion - Mixed equipment and racking deleted without deleting building columns', () => {
    const mezzZone = {
      id: 'zone_mezzanine',
      type: 'zone',
      parentId: 'level_mezz',
      polygon: [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ],
    } as unknown as ZoneNode

    const scene = sceneOf(
      mezzZone as unknown as AnyNode,
      // Mezzanine equipment & platforms
      positioned('mezz_platform_1', 'warehouse:mezzanine', 5, 5, 'level_mezz'),
      positioned('mezz_platform_2', 'warehouse:mezzanine', 15, 15, 'level_mezz'),
      positioned('longspan_1', 'warehouse:longspan-rack', 4, 4, 'level_mezz'),
      positioned('longspan_2', 'warehouse:longspan-rack', 8, 4, 'level_mezz'),
      positioned('m3_1', 'warehouse:m3-rack', 12, 12, 'level_mezz'),
      positioned('m3_2', 'warehouse:m3-rack', 16, 12, 'level_mezz'),
      positioned('cart_1', 'warehouse:tote-cart', 10, 10, 'level_mezz'),
      positioned('item_tote', 'item', 10, 12, 'level_mezz'),
      // Structural building columns (MUST NOT BE DELETED)
      column('main_col_1', 10, 5, 'level_mezz'),
      column('main_col_2', 10, 15, 'level_mezz'),
      // Adjacent floor items outside zone
      positioned('outside_item', 'item', 30, 30, 'level_mezz'),
    )

    const contentIds = collectZoneContentIds(scene, mezzZone)

    expect(contentIds).toContain('mezz_platform_1' as AnyNodeId)
    expect(contentIds).toContain('mezz_platform_2' as AnyNodeId)
    expect(contentIds).toContain('longspan_1' as AnyNodeId)
    expect(contentIds).toContain('longspan_2' as AnyNodeId)
    expect(contentIds).toContain('m3_1' as AnyNodeId)
    expect(contentIds).toContain('m3_2' as AnyNodeId)
    expect(contentIds).toContain('cart_1' as AnyNodeId)
    expect(contentIds).toContain('item_tote' as AnyNodeId)

    // Structural columns preserved
    expect(contentIds).not.toContain('main_col_1' as AnyNodeId)
    expect(contentIds).not.toContain('main_col_2' as AnyNodeId)
    expect(contentIds).not.toContain('outside_item' as AnyNodeId)
  })

  /**
   * Scenario 3: Multi-zone Facility with Adjacent Shared Columns and Boundary Walls
   *
   * Two adjacent warehouse zones: Zone A [0..20, 0..20] and Zone B [20..40, 0..20].
   * Dividing wall at x=20 and structural columns along the common grid line x=20.
   *
   * Requirement: Deleting Zone A collects Zone A contents and Zone A boundary walls,
   * while preserving Zone B contents, Zone B interior racks, and the structural columns.
   */
  test('Scenario 3: Multi-zone Facility with Adjacent Shared Columns and Boundary Walls', () => {
    const zoneA = {
      id: 'zone_A',
      type: 'zone',
      parentId: 'level_1',
      polygon: [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ],
    } as unknown as ZoneNode

    const zoneB = {
      id: 'zone_B',
      type: 'zone',
      parentId: 'level_1',
      polygon: [
        [20, 0],
        [40, 0],
        [40, 20],
        [20, 20],
      ],
    } as unknown as ZoneNode

    const scene = sceneOf(
      zoneA as unknown as AnyNode,
      zoneB as unknown as AnyNode,
      // Boundary walls for Zone A
      wall('wall_A_south', [0, 0], [20, 0]),
      wall('wall_shared_div', [20, 0], [20, 20]),
      wall('wall_A_north', [20, 20], [0, 20]),
      wall('wall_A_west', [0, 20], [0, 0]),
      // Boundary walls for Zone B
      wall('wall_B_south', [20, 0], [40, 0]),
      wall('wall_B_east', [40, 0], [40, 20]),
      wall('wall_B_north', [40, 20], [20, 20]),
      // Shared grid structural columns at x=20 (MUST NOT BE DELETED)
      column('grid_col_1', 20, 5),
      column('grid_col_2', 20, 15),
      // Contents in Zone A
      positioned('rack_in_A', 'warehouse:pallet-rack', 10, 10),
      positioned('item_in_A', 'item', 5, 5),
      // Contents in Zone B
      positioned('rack_in_B', 'warehouse:pallet-rack', 30, 10),
      positioned('item_in_B', 'item', 35, 5),
    )

    const contentIdsA = collectZoneContentIds(scene, zoneA)

    // Zone A contents collected
    expect(contentIdsA).toContain('rack_in_A' as AnyNodeId)
    expect(contentIdsA).toContain('item_in_A' as AnyNodeId)
    expect(contentIdsA).toContain('wall_A_south' as AnyNodeId)
    expect(contentIdsA).toContain('wall_shared_div' as AnyNodeId)
    expect(contentIdsA).toContain('wall_A_north' as AnyNodeId)
    expect(contentIdsA).toContain('wall_A_west' as AnyNodeId)

    // Structural grid columns preserved
    expect(contentIdsA).not.toContain('grid_col_1' as AnyNodeId)
    expect(contentIdsA).not.toContain('grid_col_2' as AnyNodeId)

    // Zone B contents preserved
    expect(contentIdsA).not.toContain('rack_in_B' as AnyNodeId)
    expect(contentIdsA).not.toContain('item_in_B' as AnyNodeId)
    expect(contentIdsA).not.toContain('wall_B_east' as AnyNodeId)
  })
})
