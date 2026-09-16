import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  LevelNode,
  SpawnNode,
  WallNode,
} from '@pascal-app/core/schema'
import { buildLevelDuplicateCreateOps } from './level-duplication'

describe('buildLevelDuplicateCreateOps', () => {
  test('parents a duplicated bootstrap level back to its building', () => {
    const level = LevelNode.parse({ level: 0, height: 3.25, children: [] })
    const building = BuildingNode.parse({ children: [level.id] })
    const wall = WallNode.parse({
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    })
    const sourceLevel = { ...level, children: [wall.id] } satisfies LevelNode
    const nodes = {
      [building.id]: building,
      [sourceLevel.id]: sourceLevel,
      [wall.id]: wall,
    } as Record<AnyNodeId, AnyNode>

    const { createOps, newLevelId } = buildLevelDuplicateCreateOps({
      nodes,
      level: sourceLevel,
      levels: [sourceLevel],
      preset: 'everything',
    })

    const levelCreateOp = createOps.find((op) => op.node.id === newLevelId)

    expect(sourceLevel.parentId).toBeNull()
    expect(levelCreateOp?.parentId).toBe(building.id)
    expect(levelCreateOp?.node.type === 'level' ? levelCreateOp.node.height : undefined).toBe(3.25)
  })

  test('does not copy spawn points from the source level', () => {
    const building = BuildingNode.parse({})
    const spawn = SpawnNode.parse({ parentId: 'level_source' })
    const level = LevelNode.parse({
      id: 'level_source',
      level: 0,
      parentId: building.id,
      children: [spawn.id],
    })
    const nodes = {
      [building.id]: { ...building, children: [level.id] },
      [level.id]: level,
      [spawn.id]: spawn,
    } as Record<AnyNodeId, AnyNode>

    const { createOps, newLevelId } = buildLevelDuplicateCreateOps({
      nodes,
      level,
      levels: [level],
      preset: 'everything',
    })

    const copiedLevel = createOps.find((op) => op.node.id === newLevelId)?.node as
      | LevelNode
      | undefined

    expect(createOps.some((op) => op.node.type === 'spawn')).toBe(false)
    expect(copiedLevel?.children).toEqual([])
  })

  test('structure preset strips slots and material fields from duplicated nodes', () => {
    const building = BuildingNode.parse({})
    const level = LevelNode.parse({ level: 0, height: 3.0, children: [] })
    const wall = WallNode.parse({
      parentId: level.id,
      start: [0, 0],
      end: [5, 0],
      materialPreset: 'brick_red',
      slots: {
        'face-interior': 'library:paint-white',
        'face-exterior': 'library:brick-red',
      },
    })
    const sourceLevel = { ...level, children: [wall.id] } satisfies LevelNode
    const nodes = {
      [building.id]: building,
      [sourceLevel.id]: sourceLevel,
      [wall.id]: wall,
    } as Record<AnyNodeId, AnyNode>

    // 1. Structure preset: strips materials and slots
    const { createOps } = buildLevelDuplicateCreateOps({
      nodes,
      level: sourceLevel,
      levels: [sourceLevel],
      preset: 'structure',
    })

    const copiedWallOp = createOps.find((op) => op.node.type === 'wall')
    expect(copiedWallOp).toBeDefined()
    const copiedWall = copiedWallOp!.node as any
    expect(copiedWall.slots).toBeUndefined()
    expect(copiedWall.material).toBeUndefined()
    expect(copiedWall.materialPreset).toBeUndefined()
    expect(copiedWall.interiorMaterial).toBeUndefined()
    expect(copiedWall.exteriorMaterial).toBeUndefined()
    // Geometry coordinates are preserved
    expect(copiedWall.start).toEqual([0, 0])
    expect(copiedWall.end).toEqual([5, 0])

    // 2. Everything preset: preserves materials and slots
    const { createOps: everythingOps } = buildLevelDuplicateCreateOps({
      nodes,
      level: sourceLevel,
      levels: [sourceLevel],
      preset: 'everything',
    })
    const everythingWall = everythingOps.find((op) => op.node.type === 'wall')!.node as any
    expect(everythingWall.slots).toEqual({
      'face-interior': 'library:paint-white',
      'face-exterior': 'library:brick-red',
    })
    expect(everythingWall.materialPreset).toBe('brick_red')
  })

  test('stripMaterials removes slots and material presets from all architectural elements', () => {
    const { stripMaterials, MATERIAL_FIELDS_BY_KIND } = require('./level-duplication')
    expect(MATERIAL_FIELDS_BY_KIND.wall).toContain('slots')
    expect(MATERIAL_FIELDS_BY_KIND.slab).toContain('slots')
    expect(MATERIAL_FIELDS_BY_KIND.shelf).toContain('slots')
    expect(MATERIAL_FIELDS_BY_KIND.column).toContain('slots')
    expect(MATERIAL_FIELDS_BY_KIND.door).toContain('slots')
    expect(MATERIAL_FIELDS_BY_KIND.window).toContain('slots')

    const slabNode = {
      id: 'slab_1',
      type: 'slab',
      slots: { top: 'library:concrete' },
      materialPreset: 'smooth_concrete',
      polygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
    }
    const strippedSlab = stripMaterials(slabNode)
    expect(strippedSlab.slots).toBeUndefined()
    expect(strippedSlab.materialPreset).toBeUndefined()
    expect(strippedSlab.polygon).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]])
  })
})

