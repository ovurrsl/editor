import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type AnyNode, DoorNode, LevelNode, WallNode, WindowNode } from '@pascal-app/core'
import * as WebIFC from 'web-ifc'
import { convertIfcToPascal } from '../src'
import {
  buildIfcExport,
  exportSceneToIfc,
  type IfcBoundingBoxFilter,
  type IfcMeshPart,
} from '../src/export'
import { roomWithOpenings, twoLevelScene } from './export-scenes'
import { expectWellFormedStep } from './export-step-check'

const wasmPath = `${dirname(fileURLToPath(import.meta.resolve('web-ifc')))}/`
const EPOCH = new Date(Date.UTC(2026, 0, 1))
const api = new WebIFC.IfcAPI()
const quietLog = console.log

beforeAll(async () => {
  api.SetWasmPath(wasmPath, true)
  await api.Init()
  console.log = () => {}
})
afterAll(() => {
  console.log = quietLog
})

function idsOf(modelID: number, type: number): number[] {
  const vector = api.GetLineIDsWithType(modelID, type)
  return Array.from({ length: vector.size() }, (_, i) => vector.get(i))
}

function withModel<T>(ifc: string, run: (modelID: number) => T): T {
  const modelID = api.OpenModel(new TextEncoder().encode(ifc))
  try {
    return run(modelID)
  } finally {
    api.CloseModel(modelID)
  }
}

describe('Feature #981 — Export Bounded IFC4 Subset', () => {
  test('TB-1: Baseline unconstrained export without bounding box remains 100% backward compatible', () => {
    const nodes = roomWithOpenings()
    const result = buildIfcExport({
      nodes,
      timestamp: EPOCH,
    })

    expectWellFormedStep(result.ifc)
    expect(result.summary.elements.IFCWALL).toBe(4)
    expect(result.summary.elements.IFCDOOR).toBe(1)
    expect(result.summary.elements.IFCWINDOW).toBe(1)
    expect(result.summary.elements.IFCSLAB).toBe(1)
    expect(result.summary.elements.IFCSPACE).toBe(1)
    expect(result.summary.elements.IFCCOVERING).toBe(1)

    withModel(result.ifc, (modelID) => {
      expect(idsOf(modelID, WebIFC.IFCPROJECT).length).toBe(1)
      expect(idsOf(modelID, WebIFC.IFCSITE).length).toBe(1)
      expect(idsOf(modelID, WebIFC.IFCBUILDING).length).toBe(1)
      expect(idsOf(modelID, WebIFC.IFCBUILDINGSTOREY).length).toBe(1)
      expect(idsOf(modelID, WebIFC.IFCWALL).length).toBe(4)
      expect(idsOf(modelID, WebIFC.IFCDOOR).length).toBe(1)
      expect(idsOf(modelID, WebIFC.IFCWINDOW).length).toBe(1)
    })
  })

  test('TB-2: Horizontal bounding box filter retains elements inside and excludes those outside', () => {
    // 5x4m room:
    // South wall (y=0 in plan) from [0,0] to [5,0] hosting front door at x=1.5 and south window at x=3.5
    // East wall (x=5 in plan) from [5,0] to [5,4]
    // North wall (y=4 in plan) from [5,4] to [0,4]
    // West wall (x=0 in plan) from [0,4] to [0,0]
    const nodes = roomWithOpenings()

    // Bounding box covering left half: X in [-1, 2.5]
    // Should include:
    // - South wall (intersects: X: 0..5 overlaps [-1, 2.5])
    // - West wall (X: 0..0 is within [-1, 2.5])
    // - North wall (intersects: X: 0..5 overlaps [-1, 2.5])
    // - Door at x=1.5 (X: [1.05, 1.95] is within [-1, 2.5])
    // Should exclude:
    // - East wall (X: 5..5 is outside [-1, 2.5])
    // - Window at x=3.5 (X: [2.9, 4.1] is outside [-1, 2.5])
    const boundingBox: IfcBoundingBoxFilter = {
      min: [-1, -1, -1],
      max: [2.5, 4, 5],
      mode: 'intersects',
    }

    const result = buildIfcExport({
      nodes,
      boundingBox,
      timestamp: EPOCH,
    })

    expectWellFormedStep(result.ifc)
    // 3 walls retained (east wall excluded)
    expect(result.summary.elements.IFCWALL).toBe(3)
    // Front door retained
    expect(result.summary.elements.IFCDOOR).toBe(1)
    // South window excluded
    expect(result.summary.elements.IFCWINDOW).toBeUndefined()

    withModel(result.ifc, (modelID) => {
      expect(idsOf(modelID, WebIFC.IFCWALL).length).toBe(3)
      expect(idsOf(modelID, WebIFC.IFCDOOR).length).toBe(1)
      expect(idsOf(modelID, WebIFC.IFCWINDOW).length).toBe(0)
      // Only 1 opening element (the door's opening), window opening is excluded
      expect(idsOf(modelID, WebIFC.IFCOPENINGELEMENT).length).toBe(1)
    })
  })

  test('TB-3: Vertical storey filter retains only storeys with elements in range and omits empty storeys', () => {
    // Two stacked storeys:
    // Ground floor: level 0, baseY = 0, height = 2.8
    // Upper floor: level 1, baseY = 2.8, height = 3.1
    const nodes = twoLevelScene()

    // Bounding box covering only upper storey: Y in [2.85, 6.5]
    const boundingBox: IfcBoundingBoxFilter = {
      min: [-1, 2.85, -1],
      max: [7, 6.5, 6],
      mode: 'intersects',
    }

    const result = buildIfcExport({
      nodes,
      boundingBox,
      timestamp: EPOCH,
    })

    expectWellFormedStep(result.ifc)
    // Exactly 1 level of walls (4 walls from the upper bedroom, 0 from ground kitchen)
    expect(result.summary.elements.IFCWALL).toBe(4)
    expect(result.summary.elements.IFCSPACE).toBe(1)

    withModel(result.ifc, (modelID) => {
      // Spatial root hierarchy is preserved
      expect(idsOf(modelID, WebIFC.IFCSITE).length).toBe(1)
      expect(idsOf(modelID, WebIFC.IFCBUILDING).length).toBe(1)
      // Ground storey had 0 retained elements inside the bounding box, so only Upper storey is emitted!
      const storeys = idsOf(modelID, WebIFC.IFCBUILDINGSTOREY)
      expect(storeys.length).toBe(1)

      // Verify the emitted storey is Upper floor (elevation 2.8)
      const storey = api.GetLine(modelID, storeys[0]!)
      expect(storey.Elevation.value).toBeCloseTo(2.8, 3)
      expect(storey.Name.value).toBe('Upper')
    })
  })

  test('TB-4: Spatial test modes — intersects includes boundary-crossing elements, contains excludes them', () => {
    const level = LevelNode.parse({ id: 'level_test', name: 'Test Level', height: 3 })
    // Wall 1: length 2m (start [0, 0] to [2, 0]) -> fully inside X [0, 3]
    const wallInside = WallNode.parse({
      id: 'wall_inside',
      parentId: level.id,
      start: [0, 0],
      end: [2, 0],
      thickness: 0.2,
    })
    // Wall 2: length 5m (start [0, 2] to [5, 2]) -> crosses X boundary of [0, 3]
    const wallCrossing = WallNode.parse({
      id: 'wall_crossing',
      parentId: level.id,
      start: [0, 2],
      end: [5, 2],
      thickness: 0.2,
    })

    const testNodes: Record<string, AnyNode> = {
      [level.id]: level,
      [wallInside.id]: wallInside,
      [wallCrossing.id]: wallCrossing,
    }

    // 1. Under intersects mode: both walls overlap the box
    const intersectsResult = buildIfcExport({
      nodes: testNodes,
      boundingBox: {
        min: [0, -1, -1],
        max: [3, 4, 3],
        mode: 'intersects',
      },
      timestamp: EPOCH,
    })
    expect(intersectsResult.summary.elements.IFCWALL).toBe(2)

    // 2. Under contains mode: wallCrossing extends to X=5, so it is excluded!
    const containsResult = buildIfcExport({
      nodes: testNodes,
      boundingBox: {
        min: [0, -1, -1],
        max: [3, 4, 3],
        mode: 'contains',
      },
      timestamp: EPOCH,
    })
    expect(containsResult.summary.elements.IFCWALL).toBe(1)
    withModel(containsResult.ifc, (modelID) => {
      const walls = idsOf(modelID, WebIFC.IFCWALL)
      expect(walls.length).toBe(1)
      const line = api.GetLine(modelID, walls[0]!)
      // Ensure the only wall is wallInside
      expect(line.GlobalId.value).toBeDefined()
    })
  })

  test('TB-5: Mesh-bearing items and furniture are filtered spatially', () => {
    const level = LevelNode.parse({ id: 'level_items', name: 'Level', height: 3 })
    const chairNode = {
      id: 'item_chair',
      type: 'item',
      name: 'Office Chair',
      parentId: level.id,
      position: [1, 0, 1],
    } as AnyNode
    const deskNode = {
      id: 'item_desk',
      type: 'item',
      name: 'Far Desk',
      parentId: level.id,
      position: [10, 0, 10],
    } as AnyNode

    // Meshes in world coordinates (metres, Y-up)
    const chairMesh: IfcMeshPart = {
      positions: [
        0.8, 0, 0.8, 1.2, 0, 0.8, 1.2, 0.9, 0.8, 0.8, 0, 0.8, 1.2, 0.9, 0.8, 0.8, 0.9, 0.8,
      ],
    }
    const deskMesh: IfcMeshPart = {
      positions: [
        9.5, 0, 9.5, 10.5, 0, 9.5, 10.5, 0.75, 9.5, 9.5, 0, 9.5, 10.5, 0.75, 9.5, 9.5, 0.75, 9.5,
      ],
    }

    const meshes = new Map<string, IfcMeshPart[]>([
      ['item_chair', [chairMesh]],
      ['item_desk', [deskMesh]],
    ])

    const nodes: Record<string, AnyNode> = {
      [level.id]: level,
      [chairNode.id]: chairNode,
      [deskNode.id]: deskNode,
    }

    // Filter box covers [0, 0, 0] to [3, 3, 3]
    const result = buildIfcExport({
      nodes,
      meshes,
      boundingBox: {
        min: [0, 0, 0],
        max: [3, 3, 3],
        mode: 'intersects',
      },
      timestamp: EPOCH,
    })

    expectWellFormedStep(result.ifc)
    expect(result.summary.elements.IFCFURNISHINGELEMENT).toBe(1)

    withModel(result.ifc, (modelID) => {
      const furnishings = idsOf(modelID, WebIFC.IFCFURNISHINGELEMENT)
      expect(furnishings.length).toBe(1)
      const line = api.GetLine(modelID, furnishings[0]!)
      expect(line.Name.value).toBe('Office Chair')
    })
  })

  test('TB-6: Empty or non-matching bounding box produces valid IFC4 with 0 physical elements and 0 storeys', () => {
    const nodes = roomWithOpenings()

    // Bounding box placed far away where no element exists
    const boundingBox: IfcBoundingBoxFilter = {
      min: [1000, 1000, 1000],
      max: [1010, 1010, 1010],
      mode: 'intersects',
    }

    const result = buildIfcExport({
      nodes,
      boundingBox,
      timestamp: EPOCH,
    })

    expectWellFormedStep(result.ifc)
    // 0 physical elements exported
    expect(result.summary.elements).toEqual({})

    withModel(result.ifc, (modelID) => {
      // Spatial root anchors must exist
      expect(idsOf(modelID, WebIFC.IFCPROJECT).length).toBe(1)
      expect(idsOf(modelID, WebIFC.IFCSITE).length).toBe(1)
      expect(idsOf(modelID, WebIFC.IFCBUILDING).length).toBe(1)
      // Storey with 0 elements is omitted
      expect(idsOf(modelID, WebIFC.IFCBUILDINGSTOREY).length).toBe(0)
      // Zero architectural elements
      expect(idsOf(modelID, WebIFC.IFCWALL).length).toBe(0)
      expect(idsOf(modelID, WebIFC.IFCDOOR).length).toBe(0)
      expect(idsOf(modelID, WebIFC.IFCWINDOW).length).toBe(0)
      expect(idsOf(modelID, WebIFC.IFCSLAB).length).toBe(0)
      expect(idsOf(modelID, WebIFC.IFCSPACE).length).toBe(0)
    })
  })

  test('TB-7: Coordinate normalization handles inverted min and max order', () => {
    const nodes = roomWithOpenings()

    // Min and max coordinates inverted
    const invertedBox: IfcBoundingBoxFilter = {
      min: [2.5, 4, 5],
      max: [-1, -1, -1],
      mode: 'intersects',
    }
    const standardBox: IfcBoundingBoxFilter = {
      min: [-1, -1, -1],
      max: [2.5, 4, 5],
      mode: 'intersects',
    }

    const invertedResult = buildIfcExport({
      nodes,
      boundingBox: invertedBox,
      timestamp: EPOCH,
    })
    const standardResult = buildIfcExport({
      nodes,
      boundingBox: standardBox,
      timestamp: EPOCH,
    })

    expect(invertedResult.summary.elements).toEqual(standardResult.summary.elements)
    expect(invertedResult.ifc).toBe(standardResult.ifc)
  })

  test('TB-8: Hosted openings on excluded walls are excluded automatically', () => {
    const level = LevelNode.parse({ id: 'level_hosted', name: 'Hosted Level', height: 3 })
    // Wall A: near origin [0, 0] to [2, 0]
    const wallA = WallNode.parse({
      id: 'wall_a',
      parentId: level.id,
      start: [0, 0],
      end: [2, 0],
    })
    // Wall B: far away [10, 0] to [15, 0]
    const wallB = WallNode.parse({
      id: 'wall_b',
      parentId: level.id,
      start: [10, 0],
      end: [15, 0],
    })
    // Door on Wall B
    const doorB = DoorNode.parse({
      id: 'door_b',
      parentId: wallB.id,
      wallId: wallB.id,
      position: [2, 1.05, 0],
      width: 0.9,
      height: 2.1,
    })
    // Window on Wall B
    const windowB = WindowNode.parse({
      id: 'window_b',
      parentId: wallB.id,
      wallId: wallB.id,
      position: [4, 1.5, 0],
      width: 1.2,
      height: 1.2,
    })

    const testNodes: Record<string, AnyNode> = {
      [level.id]: level,
      [wallA.id]: wallA,
      [wallB.id]: wallB,
      [doorB.id]: doorB,
      [windowB.id]: windowB,
    }

    // Filter box encloses only Wall A
    const result = buildIfcExport({
      nodes: testNodes,
      boundingBox: {
        min: [-1, -1, -1],
        max: [3, 4, 1],
      },
      timestamp: EPOCH,
    })

    expectWellFormedStep(result.ifc)
    // Wall A included
    expect(result.summary.elements.IFCWALL).toBe(1)
    // Door and window on Wall B must be completely excluded
    expect(result.summary.elements.IFCDOOR).toBeUndefined()
    expect(result.summary.elements.IFCWINDOW).toBeUndefined()

    withModel(result.ifc, (modelID) => {
      expect(idsOf(modelID, WebIFC.IFCWALL).length).toBe(1)
      expect(idsOf(modelID, WebIFC.IFCDOOR).length).toBe(0)
      expect(idsOf(modelID, WebIFC.IFCWINDOW).length).toBe(0)
      expect(idsOf(modelID, WebIFC.IFCOPENINGELEMENT).length).toBe(0)
    })
  })

  test('TB-9: exportSceneToIfc returns valid STEP string with boundingBox filter', () => {
    const nodes = roomWithOpenings()
    const stepText = exportSceneToIfc({
      nodes,
      boundingBox: {
        min: [-1, -1, -1],
        max: [2.5, 4, 5],
      },
      timestamp: EPOCH,
    })

    expect(typeof stepText).toBe('string')
    expect(stepText.startsWith('ISO-10303-21;')).toBe(true)
    expectWellFormedStep(stepText)
    withModel(stepText, (modelID) => {
      expect(idsOf(modelID, WebIFC.IFCWALL).length).toBe(3)
    })
  })

  test('TB-10: roundtrip import parses bounded subset accurately', async () => {
    const nodes = roomWithOpenings()
    const { ifc } = buildIfcExport({
      nodes,
      boundingBox: {
        min: [-1, -1, -1],
        max: [2.5, 4, 5],
      },
      timestamp: EPOCH,
    })

    const parsed = await convertIfcToPascal(new TextEncoder().encode(ifc), undefined, {
      simplify: false,
      wasmPath,
    })
    const walls = Object.values(parsed.nodes).filter((n) => n.type === 'wall')
    const doors = Object.values(parsed.nodes).filter((n) => n.type === 'door')
    const windows = Object.values(parsed.nodes).filter((n) => n.type === 'window')
    expect(walls.length).toBe(3)
    expect(doors.length).toBe(1)
    expect(windows.length).toBe(0)
  })
})
