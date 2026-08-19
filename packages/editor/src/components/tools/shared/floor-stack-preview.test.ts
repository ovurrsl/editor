import { beforeEach, describe, expect, test } from 'bun:test'
import { type AnyNode, type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Group } from 'three'
import { getFloorStackPreviewPosition, getStoreyPreviewLift } from './floor-stack-preview'

const GROUND_ID = 'level_ground' as AnyNodeId
const BASEMENT_ID = 'level_basement' as AnyNodeId
const NODE_ID = 'shelf_test' as AnyNodeId

// The storey elevations from the report that found this: a basement pushes the
// ground floor to 12.93 m, so every level-local preview Y is 12.93 m short of
// the building-local frame it is drawn in.
const GROUND_Y = 12.93
const BASEMENT_Y = 7.25

function level(id: AnyNodeId, index: number): AnyNode {
  return {
    id,
    type: 'level',
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    level: index,
    baseElevation: 0,
  } as unknown as AnyNode
}

function registerLevel(id: AnyNodeId, y: number) {
  const group = new Group()
  group.position.y = y
  sceneRegistry.nodes.set(id, group)
}

describe('preview positions are lifted out of the storey frame', () => {
  beforeEach(() => {
    sceneRegistry.clear()
    registerLevel(GROUND_ID, GROUND_Y)
    registerLevel(BASEMENT_ID, BASEMENT_Y)
    useViewer.setState({
      selection: { buildingId: null, levelId: GROUND_ID, zoneId: null, selectedIds: [] },
    } as never)
    useScene.setState({
      nodes: { [GROUND_ID]: level(GROUND_ID, 0), [BASEMENT_ID]: level(BASEMENT_ID, -1) },
    } as never)
  })

  test('a draft on the active storey is drawn at the storey, not the building base', () => {
    const draft = {
      id: NODE_ID,
      type: 'shelf',
      object: 'node',
      parentId: null,
      visible: true,
      metadata: {},
      position: [3, 0, -4],
    } as unknown as AnyNode

    const [x, y, z] = getFloorStackPreviewPosition({ node: draft, position: [3, 0, -4] })

    // The failure this guards: `0`, which is what a level-local Y renders as in
    // the building-local tool group — the ghost 12.93 m under the cursor while
    // the click still places correctly.
    expect(y).toBeCloseTo(GROUND_Y, 6)
    expect([x, z]).toEqual([3, -4])
  })

  test("a node's own storey wins over the active selection", () => {
    const parented = {
      id: NODE_ID,
      type: 'shelf',
      object: 'node',
      parentId: BASEMENT_ID,
      visible: true,
      metadata: {},
      position: [0, 0, 0],
    } as unknown as AnyNode

    useScene.setState({
      nodes: {
        [GROUND_ID]: level(GROUND_ID, 0),
        [BASEMENT_ID]: level(BASEMENT_ID, -1),
        [NODE_ID]: parented,
      },
    } as never)

    const [, y] = getFloorStackPreviewPosition({ node: parented, position: [0, 0, 0] })
    expect(y).toBeCloseTo(BASEMENT_Y, 6)
  })

  test('an explicit levelId beats the active selection', () => {
    expect(getStoreyPreviewLift(BASEMENT_ID)).toBeCloseTo(BASEMENT_Y, 6)
    expect(getStoreyPreviewLift()).toBeCloseTo(GROUND_Y, 6)
  })

  test('an unregistered storey lifts by nothing rather than throwing', () => {
    sceneRegistry.clear()
    expect(getStoreyPreviewLift(GROUND_ID)).toBe(0)
    useViewer.setState({
      selection: { buildingId: null, levelId: null, zoneId: null, selectedIds: [] },
    } as never)
    expect(getStoreyPreviewLift()).toBe(0)
  })
})
