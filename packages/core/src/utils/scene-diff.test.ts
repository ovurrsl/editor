import { describe, expect, test, beforeEach } from 'bun:test'
import { WallNode, SiteNode, BuildingNode, LevelNode } from '../schema'
import type { SceneGraph } from './clone-scene-graph'
import {
  computeSceneGraphDiff,
  applySceneGraphPatch,
  applySceneGraphPatchToStore,
  type SceneGraphPatch,
} from './scene-diff'
import useScene from '../store/use-scene'

describe('R1: Scene Graph Diffing, Patching, and Granular Store Application', () => {
  const site = SiteNode.parse({ id: 'site_1' })
  const building = BuildingNode.parse({ id: 'building_1', parentId: 'site_1' })
  const level = LevelNode.parse({ id: 'level_1', parentId: 'building_1' })
  const wall1 = WallNode.parse({ id: 'wall_1', parentId: 'level_1', start: [0, 0], end: [5, 0] })
  const wall2 = WallNode.parse({ id: 'wall_2', parentId: 'level_1', start: [5, 0], end: [5, 5] })

  const baseGraph: SceneGraph = {
    nodes: {
      [site.id]: site,
      [building.id]: building,
      [level.id]: level,
      [wall1.id]: wall1,
      [wall2.id]: wall2,
    },
    rootNodeIds: [site.id],
    collections: {},
    materials: {},
    installedPlugins: [],
  }

  test('computeSceneGraphDiff returns null when graphs are identical', () => {
    const diff = computeSceneGraphDiff(baseGraph, structuredClone(baseGraph), 1)
    expect(diff).toBeNull()
  })

  test('computeSceneGraphDiff detects single node movement with compact patch payload', () => {
    const movedWall1 = { ...wall1, start: [1, 1], end: [6, 1] }
    const updatedGraph: SceneGraph = {
      ...baseGraph,
      nodes: {
        ...baseGraph.nodes,
        [wall1.id]: movedWall1,
      },
    }

    const diff = computeSceneGraphDiff(baseGraph, updatedGraph, 1)
    expect(diff).not.toBeNull()
    expect(diff?.baseVersion).toBe(1)
    expect(diff?.updatedNodes).toBeDefined()
    expect(Object.keys(diff!.updatedNodes!)).toEqual(['wall_1'])
    expect(diff!.updatedNodes!['wall_1'].start).toEqual([1, 1])
    expect(diff?.createdNodes).toBeUndefined()
    expect(diff?.deletedNodeIds).toBeUndefined()
    expect(diff?.rootNodeIds).toBeUndefined()
  })

  test('Benchmark: single node movement payload size is significantly smaller than full graph JSON', () => {
    // Generate a larger scene with 100 walls
    const largeNodes: Record<string, any> = {
      [site.id]: site,
      [building.id]: building,
      [level.id]: level,
    }
    for (let i = 0; i < 100; i++) {
      const w = WallNode.parse({
        id: `wall_${i}`,
        parentId: 'level_1',
        start: [i * 2, 0],
        end: [i * 2 + 2, 0],
      })
      largeNodes[w.id] = w
    }
    const largeGraph: SceneGraph = {
      nodes: largeNodes,
      rootNodeIds: [site.id],
      collections: {},
      materials: {},
      installedPlugins: ['trees', 'warehouse'],
    }

    // Move only 1 wall
    const movedGraph: SceneGraph = {
      ...largeGraph,
      nodes: {
        ...largeGraph.nodes,
        wall_50: {
          ...largeGraph.nodes.wall_50,
          start: [999, 999],
          end: [1000, 1000],
        },
      },
    }

    const diff = computeSceneGraphDiff(largeGraph, movedGraph, 5)
    expect(diff).not.toBeNull()

    const fullGraphPayload = JSON.stringify(movedGraph)
    const patchPayload = JSON.stringify(diff)

    const fullSizeBytes = Buffer.byteLength(fullGraphPayload, 'utf8')
    const patchSizeBytes = Buffer.byteLength(patchPayload, 'utf8')

    // Patch size should be < 5% of full graph size (in reality < 2%)
    expect(patchSizeBytes).toBeLessThan(fullSizeBytes * 0.05)
    expect(patchSizeBytes).toBeLessThan(500) // Under 500 bytes (~250 bytes)
    expect(fullSizeBytes).toBeGreaterThan(15000) // Full graph is ~20KB

  })

  test('computeSceneGraphDiff detects node creation and deletion', () => {
    const wall3 = WallNode.parse({ id: 'wall_3', parentId: 'level_1', start: [5, 5], end: [0, 5] })
    const modifiedGraph: SceneGraph = {
      ...baseGraph,
      nodes: {
        [site.id]: site,
        [building.id]: building,
        [level.id]: level,
        // wall1 deleted
        [wall2.id]: wall2,
        [wall3.id]: wall3, // wall3 created
      },
    }

    const diff = computeSceneGraphDiff(baseGraph, modifiedGraph, 2)
    expect(diff).not.toBeNull()
    expect(diff?.deletedNodeIds).toEqual(['wall_1'])
    expect(Object.keys(diff?.createdNodes ?? {})).toEqual(['wall_3'])
  })

  test('applySceneGraphPatch transforms baseGraph accurately into targetGraph', () => {
    const movedWall1 = { ...wall1, start: [2, 2], end: [7, 2] }
    const wall3 = WallNode.parse({ id: 'wall_3', parentId: 'level_1', start: [0, 5], end: [0, 0] })

    const targetGraph: SceneGraph = {
      nodes: {
        [site.id]: site,
        [building.id]: building,
        [level.id]: level,
        [wall1.id]: movedWall1,
        // wall2 removed
        [wall3.id]: wall3,
      },
      rootNodeIds: [site.id],
      collections: {
        col_1: { id: 'col_1' as any, name: 'Zone A', nodeIds: ['wall_1' as any] },
      },
      materials: {
        mat_1: { id: 'mat_1' as any, name: 'Brick Wall', color: '#aa3333' } as any,
      },
      installedPlugins: ['trees'],
    }

    const diff = computeSceneGraphDiff(baseGraph, targetGraph, 1)
    expect(diff).not.toBeNull()

    const reconstructed = applySceneGraphPatch(baseGraph, diff!)
    expect(reconstructed.nodes['wall_1'].start).toEqual([2, 2])
    expect(reconstructed.nodes['wall_2']).toBeUndefined()
    expect(reconstructed.nodes['wall_3']).toBeDefined()
    expect(reconstructed.collections?.col_1?.name).toBe('Zone A')
    expect(reconstructed.materials?.mat_1?.name).toBe('Brick Wall')
    expect(reconstructed.installedPlugins).toEqual(['trees'])
  })

  test('applySceneGraphPatchToStore updates useScene store granularly without freezing', () => {
    // Setup initial store state
    useScene.getState().setScene(baseGraph.nodes as any, baseGraph.rootNodeIds as any)
    expect(useScene.getState().nodes['wall_1']).toBeDefined()
    expect(useScene.getState().nodes['wall_1'].start).toEqual([0, 0])

    const patch: SceneGraphPatch = {
      baseVersion: 1,
      updatedNodes: {
        wall_1: { ...wall1, start: [10, 10], end: [15, 10] },
      },
    }

    const startTs = performance.now()
    const success = applySceneGraphPatchToStore(patch)
    const durationMs = performance.now() - startTs

    expect(success).toBe(true)
    expect(durationMs).toBeLessThan(10) // Executed in < 10ms (typically < 0.5ms)

    const updatedNode = useScene.getState().nodes['wall_1']
    expect(updatedNode.start).toEqual([10, 10])
    expect(useScene.getState().nodes['wall_2']).toBeDefined() // wall_2 untouched
    expect(useScene.getState().dirtyNodes.has('wall_1' as any)).toBe(true)
  })

  test('applySceneGraphPatchToStore clears active live overrides & live transforms for modified nodes', async () => {
    const { default: useLiveNodeOverrides } = await import('../store/use-live-node-overrides')
    const { default: useLiveTransforms } = await import('../store/use-live-transforms')

    useScene.getState().setScene(baseGraph.nodes as any, baseGraph.rootNodeIds as any)

    // Set transient live transforms & overrides on wall_1 and wall_2
    useLiveTransforms.getState().set('wall_1', { position: [1, 2, 3], rotation: 45 })
    useLiveNodeOverrides.getState().set('wall_1', { dragging: true })
    useLiveTransforms.getState().set('wall_2', { position: [4, 5, 6], rotation: 90 })

    expect(useLiveTransforms.getState().get('wall_1')).toBeDefined()
    expect(useLiveNodeOverrides.getState().get('wall_1')).toBeDefined()

    // Remote patch touches wall_1
    const patch: SceneGraphPatch = {
      baseVersion: 1,
      updatedNodes: {
        wall_1: { ...wall1, start: [20, 20], end: [25, 20] },
      },
    }

    const applied = applySceneGraphPatchToStore(patch)
    expect(applied).toBe(true)

    // wall_1 live transform and override must be cleared
    expect(useLiveTransforms.getState().get('wall_1')).toBeUndefined()
    expect(useLiveNodeOverrides.getState().get('wall_1')).toBeUndefined()

    // Untouched wall_2 live transform remains intact
    expect(useLiveTransforms.getState().get('wall_2')).toBeDefined()
  })

  test('applySceneGraphPatchToStore marks slot-bearing nodes dirty when material changes', () => {
    const wallWithSlot = WallNode.parse({
      id: 'wall_slotted',
      parentId: 'level_1',
      start: [0, 0],
      end: [4, 0],
      slots: { front: 'mat_brick' },
    } as any)

    const graphWithSlot: SceneGraph = {
      ...baseGraph,
      nodes: {
        ...baseGraph.nodes,
        [wallWithSlot.id]: wallWithSlot,
      },
      materials: {
        mat_brick: { id: 'mat_brick' as any, name: 'Red Brick', color: '#ff0000' } as any,
      },
    }

    useScene.getState().setScene(graphWithSlot.nodes as any, graphWithSlot.rootNodeIds as any, {
      materials: graphWithSlot.materials as any,
    })
    useScene.getState().dirtyNodes.clear()
    expect(useScene.getState().dirtyNodes.size).toBe(0)

    // Patch updates mat_brick color
    const patch: SceneGraphPatch = {
      materials: {
        mat_brick: { id: 'mat_brick' as any, name: 'Dark Brick', color: '#330000' } as any,
      },
    }

    const applied = applySceneGraphPatchToStore(patch)
    expect(applied).toBe(true)

    // The node using mat_brick must be marked dirty
    expect(useScene.getState().dirtyNodes.has('wall_slotted' as any)).toBe(true)
  })

  test('Adversarial: applySceneGraphPatch & store automatically filter deleted nodes from rootNodeIds when patch.rootNodeIds is omitted', () => {
    const site2 = SiteNode.parse({ id: 'site_2' })
    const graphWithTwoRoots: SceneGraph = {
      ...baseGraph,
      nodes: {
        ...baseGraph.nodes,
        [site2.id]: site2,
      },
      rootNodeIds: [site.id, site2.id],
    }

    useScene.getState().setScene(graphWithTwoRoots.nodes as any, graphWithTwoRoots.rootNodeIds as any)
    expect(useScene.getState().rootNodeIds).toEqual([site.id, site2.id])

    // Patch deletes site_2 without specifying rootNodeIds
    const patchWithoutRoots: SceneGraphPatch = {
      deletedNodeIds: [site2.id],
    }

    const reconstructed = applySceneGraphPatch(graphWithTwoRoots, patchWithoutRoots)
    expect(reconstructed.rootNodeIds).toEqual([site.id])
    expect(reconstructed.nodes[site2.id]).toBeUndefined()

    const applied = applySceneGraphPatchToStore(patchWithoutRoots)
    expect(applied).toBe(true)
    expect(useScene.getState().rootNodeIds).toEqual([site.id])
    expect(useScene.getState().nodes[site2.id]).toBeUndefined()
  })

  test('Adversarial: collection and material nulling removes entries cleanly without residual keys', () => {
    const graphWithData: SceneGraph = {
      ...baseGraph,
      collections: {
        col_alpha: { id: 'col_alpha' as any, name: 'Zone A', nodeIds: [] },
        col_beta: { id: 'col_beta' as any, name: 'Zone B', nodeIds: [] },
      },
      materials: {
        mat_x: { id: 'mat_x' as any, name: 'Concrete', color: '#888888' } as any,
        mat_y: { id: 'mat_y' as any, name: 'Wood', color: '#964B00' } as any,
      },
    }

    useScene.getState().setScene(graphWithData.nodes as any, graphWithData.rootNodeIds as any, {
      collections: graphWithData.collections as any,
      materials: graphWithData.materials as any,
    })

    // Patch deletes col_alpha and mat_x via nulling
    const patchNulling: SceneGraphPatch = {
      collections: { col_alpha: null },
      materials: { mat_x: null },
    }

    const reconstructed = applySceneGraphPatch(graphWithData, patchNulling)
    expect(reconstructed.collections?.col_alpha).toBeUndefined()
    expect(reconstructed.collections?.col_beta).toBeDefined()
    expect(reconstructed.materials?.mat_x).toBeUndefined()
    expect(reconstructed.materials?.mat_y).toBeDefined()

    const applied = applySceneGraphPatchToStore(patchNulling)
    expect(applied).toBe(true)
    expect(useScene.getState().collections?.col_alpha).toBeUndefined()
    expect(useScene.getState().collections?.col_beta).toBeDefined()
    expect(useScene.getState().materials?.mat_x).toBeUndefined()
    expect(useScene.getState().materials?.mat_y).toBeDefined()
  })

  test('Adversarial: applySceneGraphPatch & store sanitize collection.nodeIds when nodes are deleted', () => {
    const graphWithCollections: SceneGraph = {
      ...baseGraph,
      collections: {
        col_1: { id: 'col_1' as any, name: 'Walls Group', nodeIds: ['wall_1' as any, 'wall_2' as any] },
      },
    }

    useScene.getState().setScene(graphWithCollections.nodes as any, graphWithCollections.rootNodeIds as any, {
      collections: graphWithCollections.collections as any,
    })
    expect(useScene.getState().collections?.col_1?.nodeIds).toEqual(['wall_1' as any, 'wall_2' as any])

    // Patch deletes wall_2 without explicitly sending collections
    const patchDeleteNode: SceneGraphPatch = {
      deletedNodeIds: ['wall_2'],
    }

    const reconstructed = applySceneGraphPatch(graphWithCollections, patchDeleteNode)
    expect(reconstructed.collections?.col_1?.nodeIds).toEqual(['wall_1' as any])
    expect(reconstructed.nodes['wall_2']).toBeUndefined()

    const applied = applySceneGraphPatchToStore(patchDeleteNode)
    expect(applied).toBe(true)
    expect(useScene.getState().collections?.col_1?.nodeIds).toEqual(['wall_1' as any])
    expect(useScene.getState().nodes['wall_2']).toBeUndefined()
  })

  test('Adversarial: created root nodes are auto-added to rootNodeIds when patch.rootNodeIds is omitted', () => {
    const siteNew = SiteNode.parse({ id: 'site_new' })
    const patchCreateRoot: SceneGraphPatch = {
      createdNodes: {
        [siteNew.id]: siteNew,
      },
    }

    useScene.getState().setScene(baseGraph.nodes as any, baseGraph.rootNodeIds as any)
    expect(useScene.getState().rootNodeIds).toEqual([site.id])

    const reconstructed = applySceneGraphPatch(baseGraph, patchCreateRoot)
    expect(reconstructed.rootNodeIds).toContain(site.id)
    expect(reconstructed.rootNodeIds).toContain(siteNew.id)
    expect(reconstructed.nodes[siteNew.id]).toBeDefined()

    const applied = applySceneGraphPatchToStore(patchCreateRoot)
    expect(applied).toBe(true)
    expect(useScene.getState().rootNodeIds).toContain(site.id)
    expect(useScene.getState().rootNodeIds).toContain(siteNew.id)
    expect(useScene.getState().nodes[siteNew.id]).toBeDefined()
  })

  test('Adversarial: explicit patch.rootNodeIds is sanitized against patch.deletedNodeIds', () => {
    const site2 = SiteNode.parse({ id: 'site_2' })
    const graphWithTwoRoots: SceneGraph = {
      ...baseGraph,
      nodes: {
        ...baseGraph.nodes,
        [site2.id]: site2,
      },
      rootNodeIds: [site.id, site2.id],
    }
    const patchConflicting: SceneGraphPatch = {
      rootNodeIds: [site.id, site2.id],
      deletedNodeIds: [site2.id],
    }

    useScene.getState().setScene(graphWithTwoRoots.nodes as any, graphWithTwoRoots.rootNodeIds as any)

    const reconstructed = applySceneGraphPatch(graphWithTwoRoots, patchConflicting)
    expect(reconstructed.rootNodeIds).toEqual([site.id])
    expect(reconstructed.nodes[site2.id]).toBeUndefined()

    const applied = applySceneGraphPatchToStore(patchConflicting)
    expect(applied).toBe(true)
    expect(useScene.getState().rootNodeIds).toEqual([site.id])
  })
})
