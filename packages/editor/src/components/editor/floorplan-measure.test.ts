import { describe, expect, test } from 'bun:test'
import { computeFloorplanAnalyticalBounds } from '../../lib/floorplan-bounds'

describe('computeFloorplanAnalyticalBounds (H8 Regression Suite)', () => {
  test('returns null for an empty scene', () => {
    const bounds = computeFloorplanAnalyticalBounds({})
    expect(bounds).toBeNull()
  })

  test('returns null for nodes without geometric coordinates', () => {
    const nodes = {
      n1: { id: 'n1', type: 'group' },
      n2: { id: 'n2', type: 'metadata', name: 'test' },
    }
    const bounds = computeFloorplanAnalyticalBounds(nodes)
    expect(bounds).toBeNull()
  })

  test('computes valid finite bounds for scenes containing ONLY WallNodes (start & end)', () => {
    const nodes = {
      wall_1: {
        id: 'wall_1',
        type: 'wall',
        start: [10, 20],
        end: [30, 20],
      },
      wall_2: {
        id: 'wall_2',
        type: 'wall',
        start: [30, 20],
        end: [30, 60],
      },
    }

    const bounds = computeFloorplanAnalyticalBounds(nodes)
    expect(bounds).not.toBeNull()
    expect(bounds).toEqual({
      x: 10,
      y: 20,
      width: 20,
      height: 40,
    })
    expect(Number.isFinite(bounds!.x)).toBe(true)
    expect(Number.isFinite(bounds!.y)).toBe(true)
    expect(Number.isFinite(bounds!.width)).toBe(true)
    expect(Number.isFinite(bounds!.height)).toBe(true)
  })

  test('computes valid finite bounds for scenes containing ONLY SlabNodes (polygon)', () => {
    const nodes = {
      slab_1: {
        id: 'slab_1',
        type: 'slab',
        polygon: [
          [-15, -10],
          [25, -10],
          [25, 35],
          [-15, 35],
        ],
      },
    }

    const bounds = computeFloorplanAnalyticalBounds(nodes)
    expect(bounds).not.toBeNull()
    expect(bounds).toEqual({
      x: -15,
      y: -10,
      width: 40,
      height: 45,
    })
  })

  test('computes valid finite bounds for scenes containing ONLY ZoneNodes (polygon)', () => {
    const nodes = {
      zone_1: {
        id: 'zone_1',
        type: 'zone',
        polygon: [
          [5, 5],
          [15, 5],
          [15, 25],
          [5, 25],
        ],
      },
    }

    const bounds = computeFloorplanAnalyticalBounds(nodes)
    expect(bounds).not.toBeNull()
    expect(bounds).toEqual({
      x: 5,
      y: 5,
      width: 10,
      height: 20,
    })
  })

  test('computes combined bounding box for mixed scenes with walls, slabs, and zones', () => {
    const nodes = {
      wall_1: {
        id: 'wall_1',
        type: 'wall',
        start: [0, 0],
        end: [50, 0],
      },
      slab_1: {
        id: 'slab_1',
        type: 'slab',
        polygon: [
          [-20, -10],
          [10, -10],
          [10, 10],
          [-20, 10],
        ],
      },
      zone_1: {
        id: 'zone_1',
        type: 'zone',
        polygon: [
          [10, 20],
          [60, 20],
          [60, 40],
          [10, 40],
        ],
      },
      item_1: {
        id: 'item_1',
        type: 'item',
        position: [70, 0, 50],
        width: 10,
        length: 10,
      },
    }

    const bounds = computeFloorplanAnalyticalBounds(nodes)
    expect(bounds).not.toBeNull()
    // minX = Math.min(0, 50, -20, 10, 10, 60, 70 - 5 = 65) = -20
    // maxX = Math.max(0, 50, -20, 10, 10, 60, 70 + 5 = 75) = 75
    // minZ = Math.min(0, 0, -10, 10, 20, 40, 50 - 5 = 45) = -10
    // maxZ = Math.max(0, 0, -10, 10, 20, 40, 50 + 5 = 55) = 55
    expect(bounds).toEqual({
      x: -20,
      y: -10,
      width: 95,
      height: 65,
    })
  })

  test('handles malformed or NaN coordinates gracefully without crashing', () => {
    const nodes = {
      corrupt_wall: {
        id: 'corrupt_wall',
        type: 'wall',
        start: [Number.NaN, 0],
        end: [10, Number.POSITIVE_INFINITY],
      },
      corrupt_slab: {
        id: 'corrupt_slab',
        type: 'slab',
        polygon: [[undefined, null], 'invalid'],
      },
      valid_wall: {
        id: 'valid_wall',
        type: 'wall',
        start: [5, 5],
        end: [15, 25],
      },
    }

    const bounds = computeFloorplanAnalyticalBounds(nodes as any)
    expect(bounds).not.toBeNull()
    expect(bounds).toEqual({
      x: 5,
      y: 5,
      width: 10,
      height: 20,
    })
  })
})
