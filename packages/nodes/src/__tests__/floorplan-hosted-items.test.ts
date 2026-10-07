import { describe, expect, test } from 'bun:test'
import {
  CabinetModuleNode,
  CabinetNode,
  DoorNode,
  getOpeningWallPlacement,
  ItemNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  ShelfNode,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { nodeLevelFrame } from '@pascal-app/core/procedural-items'
import { buildCabinetFloorplan } from '../cabinet/floorplan'
import { buildDoorFloorplan } from '../door/floorplan'
import { resolveItemTransform } from '../item/floorplan'
import { buildShelfFloorplan } from '../shelf/floorplan'
import { buildWindowFloorplan } from '../window/floorplan'

describe('Issue #992: Floor Plan Hosted Items 2D/3D Parity', () => {
  test('wall -> shelf -> item matches 3D world pose in 2D floor plan', () => {
    const level = LevelNode.parse({ id: 'level_1' })
    const wall = WallNode.parse({
      id: 'wall_1',
      parentId: level.id,
      start: [2, 3],
      end: [6, 5],
      thickness: 0.4,
    })
    const shelf = ShelfNode.parse({
      id: 'shelf_1',
      parentId: wall.id,
      position: [1, 0.4, 0],
      rotation: [0, 0.5, 0],
    })
    const item = ItemNode.parse({
      id: 'item_1',
      parentId: shelf.id,
      position: [0.1, 0.2, 0.1],
      rotation: [0, 0, 0],
      asset: {
        id: 'box',
        name: 'Box',
        dimensions: [0.2, 0.2, 0.2],
        category: 'furniture',
        thumbnail: 'asset://thumb.png',
        src: 'asset://box.glb',
      },
    })
    const nodes: Record<string, any> = {
      [level.id]: level,
      [wall.id]: wall,
      [shelf.id]: shelf,
      [item.id]: item,
    }
    const ctx = {
      resolve: (id: string) => nodes[id],
      parent: shelf,
      viewState: {},
    } as any

    const expected3D = nodeLevelFrame(item.id, nodes, undefined, { planOnly: true })
    const plan2D = resolveItemTransform(item, ctx)

    expect(plan2D).not.toBeNull()
    expect(plan2D!.x).toBeCloseTo(expected3D.position[0], 4)
    expect(plan2D!.y).toBeCloseTo(expected3D.position[2], 4)
  })

  test('wall -> shelf matches 3D world pose in 2D floor plan', () => {
    const level = LevelNode.parse({ id: 'level_1' })
    const wall = WallNode.parse({
      id: 'wall_1',
      parentId: level.id,
      start: [2, 3],
      end: [6, 5],
      thickness: 0.4,
    })
    const shelf = ShelfNode.parse({
      id: 'shelf_1',
      parentId: wall.id,
      position: [1, 0.4, 0],
      rotation: [0, 0.5, 0],
    })
    const nodes: Record<string, any> = {
      [level.id]: level,
      [wall.id]: wall,
      [shelf.id]: shelf,
    }
    const ctx = {
      resolve: (id: string) => nodes[id],
      parent: wall,
      viewState: {},
    } as any

    const expected3D = nodeLevelFrame(shelf.id, nodes, undefined, { planOnly: true })
    const planGeom = buildShelfFloorplan(shelf, ctx)

    expect(planGeom.kind).toBe('group')
    if (planGeom.kind === 'group' && planGeom.transform) {
      expect(planGeom.transform.translate[0]).toBeCloseTo(expected3D.position[0], 4)
      expect(planGeom.transform.translate[1]).toBeCloseTo(expected3D.position[2], 4)
    }
  })

  test('wall -> cabinet cascades parent wall transform', () => {
    const level = LevelNode.parse({ id: 'level_1' })
    const wall = WallNode.parse({
      id: 'wall_1',
      parentId: level.id,
      start: [2, 3],
      end: [6, 5],
      thickness: 0.4,
    })
    const cabinet = CabinetNode.parse({
      id: 'cabinet_1',
      parentId: wall.id,
      position: [1, 0, 0],
      rotation: 0,
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_1',
      parentId: cabinet.id,
      position: [0.2, 0, 0.1],
      rotation: 0,
      width: 0.6,
      depth: 0.6,
    })
    const nodes: Record<string, any> = {
      [level.id]: level,
      [wall.id]: wall,
      [cabinet.id]: cabinet,
      [module.id]: module,
    }
    const ctx = {
      resolve: (id: string) => nodes[id],
      parent: wall,
      children: [module],
      siblings: [],
      viewState: {},
    } as any

    const expectedCab3D = nodeLevelFrame(cabinet.id, nodes, undefined, { planOnly: true })
    const cabGeom = buildCabinetFloorplan(cabinet, ctx)
    expect(cabGeom.kind).toBe('group')
    if (cabGeom.kind === 'group' && cabGeom.children[0]?.kind === 'group') {
      const childGroup = cabGeom.children[0]
      expect(childGroup.transform?.translate[0]).toBeCloseTo(expectedCab3D.position[0], 4)
      expect(childGroup.transform?.translate[1]).toBeCloseTo(expectedCab3D.position[2], 4)
    }
  })

  test('curved wall -> door follows arc frame and matches 3D placement', () => {
    const level = LevelNode.parse({ id: 'level_1' })
    const curvedWall = WallNode.parse({
      id: 'wall_curved_1',
      parentId: level.id,
      start: [0, 0],
      end: [10, 0],
      curveOffset: 2.0,
      thickness: 0.3,
    })
    const door = DoorNode.parse({
      id: 'door_1',
      parentId: curvedWall.id,
      position: [5, 1, 0],
      width: 0.9,
    })
    const nodes: Record<string, any> = {
      [level.id]: level,
      [curvedWall.id]: curvedWall,
      [door.id]: door,
    }
    const ctx = {
      resolve: (id: string) => nodes[id],
      parent: curvedWall,
      viewState: {},
    } as any

    const door3D = getOpeningWallPlacement(curvedWall, door, nodes)
    const doorGeom = buildDoorFloorplan(door, ctx)
    expect(doorGeom).not.toBeNull()

    expect(doorGeom!.kind).toBe('group')
    const polygon = (doorGeom as any).children.find((c: any) => c.kind === 'polygon')
    expect(polygon).toBeDefined()
    const pts = polygon.points as [number, number][]
    const avgX = pts.reduce((sum, p) => sum + p[0], 0) / pts.length
    const avgZ = pts.reduce((sum, p) => sum + p[1], 0) / pts.length

    // The door must be near z ≈ -1.98 on the curve, NOT on chord at z ≈ 0!
    expect(avgZ).toBeLessThan(-1.0)
    expect(avgX).toBeCloseTo(door3D.position[0], 2)
    expect(avgZ).toBeCloseTo(door3D.position[2], 2)
  })

  test('curved wall -> window follows arc frame and matches 3D placement', () => {
    const level = LevelNode.parse({ id: 'level_1' })
    const curvedWall = WallNode.parse({
      id: 'wall_curved_1',
      parentId: level.id,
      start: [0, 0],
      end: [10, 0],
      curveOffset: 2.0,
      thickness: 0.3,
    })
    const window = WindowNode.parse({
      id: 'window_1',
      parentId: curvedWall.id,
      position: [5, 1, 0],
      width: 1.2,
    })
    const nodes: Record<string, any> = {
      [level.id]: level,
      [curvedWall.id]: curvedWall,
      [window.id]: window,
    }
    const ctx = {
      resolve: (id: string) => nodes[id],
      parent: curvedWall,
      viewState: {},
    } as any

    const win3D = getOpeningWallPlacement(curvedWall, window, nodes)
    const winGeom = buildWindowFloorplan(window, ctx)
    expect(winGeom).not.toBeNull()

    const polygon = (winGeom as any).children.find((c: any) => c.kind === 'polygon')
    expect(polygon).toBeDefined()
    const pts = polygon.points as [number, number][]
    const avgX = pts.reduce((sum, p) => sum + p[0], 0) / pts.length
    const avgZ = pts.reduce((sum, p) => sum + p[1], 0) / pts.length

    expect(avgZ).toBeLessThan(-1.0)
    expect(avgX).toBeCloseTo(win3D.position[0], 2)
    expect(avgZ).toBeCloseTo(win3D.position[2], 2)
  })

  test('roof segment hosted door and window render non-null 2D floorplan', () => {
    const level = LevelNode.parse({ id: 'level_1' })
    const roof = RoofNode.parse({
      id: 'roof_1',
      parentId: level.id,
      position: [10, 3, 10],
      rotation: 0,
    })
    const segment = RoofSegmentNode.parse({
      id: 'rseg_1',
      parentId: roof.id,
      position: [2, 0, 1],
      rotation: 0,
      wallThickness: 0.2,
    })
    const door = DoorNode.parse({
      id: 'door_roof',
      parentId: segment.id,
      roofSegmentId: segment.id,
      roofFace: 'front',
      position: [0.5, 0, 0],
      width: 0.9,
    })
    const window = WindowNode.parse({
      id: 'window_roof',
      parentId: segment.id,
      roofSegmentId: segment.id,
      roofFace: 'front',
      position: [1.5, 1, 0],
      width: 1.0,
    })
    const nodes: Record<string, any> = {
      [level.id]: level,
      [roof.id]: roof,
      [segment.id]: segment,
      [door.id]: door,
      [window.id]: window,
    }

    const doorCtx = {
      resolve: (id: string) => nodes[id],
      parent: segment,
      viewState: {},
    } as any

    const winCtx = {
      resolve: (id: string) => nodes[id],
      parent: segment,
      viewState: {},
    } as any

    const doorGeom = buildDoorFloorplan(door, doorCtx)
    const winGeom = buildWindowFloorplan(window, winCtx)

    expect(doorGeom).not.toBeNull()
    expect(winGeom).not.toBeNull()

    const doorPoly = (doorGeom as any).children.find((c: any) => c.kind === 'polygon')
    expect(doorPoly).toBeDefined()
    const doorPts = doorPoly.points as [number, number][]
    const doorAvgX = doorPts.reduce((sum, p) => sum + p[0], 0) / doorPts.length
    const doorAvgZ = doorPts.reduce((sum, p) => sum + p[1], 0) / doorPts.length

    // Roof is at [10, 3, 10], segment at [2, 0, 1]
    expect(doorAvgX).toBeGreaterThan(5)
    expect(doorAvgZ).toBeGreaterThan(5)
  })
})
