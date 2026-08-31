import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WallNode, SiteNode, BuildingNode, LevelNode } from '@pascal-app/core/schema'
import {
  computeSceneGraphDiff,
  applySceneGraphPatch,
  applySceneGraphPatchToStore,
  type SceneGraph,
  type SceneGraphPatch,
} from '@pascal-app/core'
import { NextRequest } from 'next/server'
import useScene from '@pascal-app/core/store'

const tempDir = mkdtempSync(join(tmpdir(), 'diff-sync-benchmark-test-'))
const SCENE_ID = 'diff-sync-scene'

const site = SiteNode.parse({ id: 'site_test' })
const building = BuildingNode.parse({ id: 'building_test', parentId: 'site_test' })
const level = LevelNode.parse({ id: 'level_test', parentId: 'building_test' })
const wallA = WallNode.parse({ id: 'wall_a', parentId: 'level_test', start: [0, 0], end: [5, 0] })
const wallB = WallNode.parse({ id: 'wall_b', parentId: 'level_test', start: [5, 0], end: [5, 5] })

// Build initial populated scene graph with 50 walls
const INITIAL_GRAPH: SceneGraph = {
  nodes: {
    [site.id]: site,
    [building.id]: building,
    [level.id]: level,
    [wallA.id]: wallA,
    [wallB.id]: wallB,
  },
  rootNodeIds: [site.id],
  collections: {},
  materials: {},
  installedPlugins: ['trees'],
}

for (let i = 0; i < 48; i++) {
  const w = WallNode.parse({
    id: `wall_extra_${i}`,
    parentId: 'level_test',
    start: [i * 2, 10],
    end: [i * 2 + 2, 10],
  })
  INITIAL_GRAPH.nodes[w.id] = w
}


let PUT_SCENE: typeof import('../route')['PUT']
let PATCH_SCENE: typeof import('../route')['PATCH']
let GET_EVENTS: typeof import('./route')['GET']
let restoreEnv: () => void

let currentSessionUser: { id: string; email: string; role: 'admin' | 'editor' | 'viewer' } | null = null
let mockAuthAvailable = false

beforeAll(async () => {
  const saved = {
    PASCAL_DB_PATH: process.env.PASCAL_DB_PATH,
    PASCAL_SCENE_API_TOKEN: process.env.PASCAL_SCENE_API_TOKEN,
  }
  restoreEnv = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  process.env.PASCAL_DB_PATH = join(tempDir, 'pascal.db')
  delete process.env.PASCAL_SCENE_API_TOKEN

  mock.module('@/lib/auth/db', () => ({
    authAvailable: () => mockAuthAvailable,
  }))

  mock.module('@/lib/auth/session', () => ({
    getSessionUser: async () => currentSessionUser,
    canEdit: (user: { role: string }) => user.role !== 'viewer',
  }))

  mock.module('@/lib/auth/site-scenes', () => ({
    publishedSceneIds: async () => new Set<string>(),
  }))

  const storeServer = await import('@/lib/scene-store-server')
  storeServer.__resetSceneStoreForTests()

  const { SqliteSceneStore } = await import(
    '../../../../../../../packages/mcp/src/storage/sqlite-scene-store'
  )
  const { createSceneOperations } = await import(
    '../../../../../../../packages/mcp/src/operations/scene-operations'
  )
  const store = new SqliteSceneStore({ env: process.env })
  const operations = createSceneOperations({ store })
  storeServer.__setSceneStoreForTests(store, operations)

  await store.save({
    id: SCENE_ID,
    name: 'Diff Sync Benchmark Fixture',
    ownerId: null,
    projectId: null,
    graph: INITIAL_GRAPH as never,
  })

  const sceneRoute = await import('../route')
  PUT_SCENE = sceneRoute.PUT
  PATCH_SCENE = sceneRoute.PATCH

  const eventsRoute = await import('./route')
  GET_EVENTS = eventsRoute.GET
})

afterAll(async () => {
  const storeServer = await import('@/lib/scene-store-server')
  const store = await storeServer.getSceneStore()
  ;(store as unknown as { close?: () => void }).close?.()
  storeServer.__resetSceneStoreForTests()
  restoreEnv()
  rmSync(tempDir, { recursive: true, force: true })
})

function putSceneRequest(sceneId: string, body: unknown, version?: number): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/scenes/${sceneId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      host: '127.0.0.1:3000',
      ...(version !== undefined ? { 'If-Match': String(version) } : {}),
    },
    body: JSON.stringify(body),
  })
}

function patchSceneRequest(sceneId: string, body: unknown, version?: number): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/scenes/${sceneId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      host: '127.0.0.1:3000',
      ...(version !== undefined ? { 'If-Match': String(version) } : {}),
    },
    body: JSON.stringify(body),
  })
}

function eventsRequest(sceneId: string, query = ''): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/scenes/${sceneId}/events${query}`, {
    method: 'GET',
    headers: {
      host: '127.0.0.1:3000',
    },
  })
}

function paramsFor(sceneId: string) {
  return { params: Promise.resolve({ id: sceneId }) }
}

describe('R1 & R2: Differential REST/SSE Synchronization & Performance Benchmark Suite', () => {
  beforeEach(async () => {
    mockAuthAvailable = false
    currentSessionUser = null
  })

  test('PATCH /api/scenes/[id] accepts granular patch and appends diff-based event', async () => {
    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()

    const beforeScene = await operations.loadStoredScene(SCENE_ID)
    const initialVersion = beforeScene?.version ?? 1

    // Move single wallA
    const movedWallA = { ...wallA, start: [10, 20], end: [15, 20] }
    const patchPayload: SceneGraphPatch = {
      baseVersion: initialVersion,
      updatedNodes: {
        [wallA.id]: movedWallA,
      },
    }

    const res = await PATCH_SCENE(
      patchSceneRequest(SCENE_ID, { patch: patchPayload, baseVersion: initialVersion }),
      paramsFor(SCENE_ID),
    )
    expect(res.status).toBe(200)

    const meta = (await res.json()) as { version: number; nodeCount: number }
    expect(meta.version).toBe(initialVersion + 1)
    expect(meta.nodeCount).toBe(Object.keys(INITIAL_GRAPH.nodes).length)

    // Verify stored scene in DB reflects the patch
    const updatedScene = await operations.loadStoredScene(SCENE_ID)
    expect(updatedScene?.version).toBe(meta.version)
    expect(updatedScene?.graph.nodes[wallA.id].start).toEqual([10, 20])
    expect(updatedScene?.graph.nodes[wallB.id]).toBeDefined()

    // Verify scene event carries the patch
    const events = await operations.listSceneEvents(SCENE_ID, { afterEventId: 0, limit: 50 })
    const latestEvent = events[events.length - 1]
    expect(latestEvent.version).toBe(meta.version)
    expect(latestEvent.patch).toBeDefined()
    expect(latestEvent.patch?.updatedNodes?.[wallA.id]).toBeDefined()
    expect(latestEvent.patch?.updatedNodes?.[wallA.id].start).toEqual([10, 20])
  })

  test('Benchmark: single node movement produces network payload significantly smaller than full graph', async () => {
    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()

    const currentScene = await operations.loadStoredScene(SCENE_ID)
    const version = currentScene?.version ?? 2
    const currentGraph = currentScene!.graph

    // Single node movement
    const movedWallB = { ...wallB, start: [100, 100], end: [105, 100] }
    const targetGraph: SceneGraph = {
      ...currentGraph,
      nodes: {
        ...currentGraph.nodes,
        [wallB.id]: movedWallB,
      },
    }

    const diff = computeSceneGraphDiff(currentGraph, targetGraph, version)
    expect(diff).not.toBeNull()

    const fullGraphPayloadJson = JSON.stringify({ name: 'Benchmark Scene', graph: targetGraph })
    const patchPayloadJson = JSON.stringify({ name: 'Benchmark Scene', patch: diff, baseVersion: version })

    const fullGraphSizeBytes = Buffer.byteLength(fullGraphPayloadJson, 'utf8')
    const patchSizeBytes = Buffer.byteLength(patchPayloadJson, 'utf8')

    // Expect patch to be < 5% of full graph size
    expect(patchSizeBytes).toBeLessThan(fullGraphSizeBytes * 0.05)
    expect(patchSizeBytes).toBeLessThan(400) // Less than 400 bytes
    expect(fullGraphSizeBytes).toBeGreaterThan(8000) // Full graph is > 8KB

    // Execute the save with patch
    const res = await PATCH_SCENE(
      patchSceneRequest(SCENE_ID, { patch: diff, baseVersion: version }, version),
      paramsFor(SCENE_ID),
    )
    expect(res.status).toBe(200)

    // Check SSE stream response payload
    const eventsRes = await GET_EVENTS(eventsRequest(SCENE_ID), paramsFor(SCENE_ID))
    expect(eventsRes.status).toBe(200)
    expect(eventsRes.headers.get('Content-Type')).toContain('text/event-stream')
  })

  test('Two editor instances sync structural changes without freezing main thread', async () => {
    // Instance 1 & Instance 2 simulation
    // Instance 1 loads initial scene into store
    useScene.getState().setScene(INITIAL_GRAPH.nodes as any, INITIAL_GRAPH.rootNodeIds as any)
    expect(useScene.getState().nodes[wallA.id]).toBeDefined()

    // Remote instance creates a new wall and modifies an existing wall
    const newWall = WallNode.parse({
      id: 'wall_remote_1',
      parentId: 'level_test',
      start: [50, 50],
      end: [55, 50],
    })
    const modifiedWallA = { ...wallA, start: [99, 99], end: [104, 99] }

    const remotePatch: SceneGraphPatch = {
      baseVersion: 3,
      createdNodes: {
        [newWall.id]: newWall,
      },
      updatedNodes: {
        [wallA.id]: modifiedWallA,
      },
    }

    // Measure time to apply patch to store
    const start = performance.now()
    const applied = applySceneGraphPatchToStore(remotePatch)
    const durationMs = performance.now() - start

    expect(applied).toBe(true)
    // Execution must be fast (<5ms) to guarantee zero UI thread blocking
    expect(durationMs).toBeLessThan(5)

    const state = useScene.getState()
    expect(state.nodes['wall_remote_1']).toBeDefined()
    expect(state.nodes[wallA.id].start).toEqual([99, 99])
    expect(state.dirtyNodes.has('wall_remote_1' as any)).toBe(true)
    expect(state.dirtyNodes.has(wallA.id as any)).toBe(true)
  })

  test('Version conflict handling: rejects stale patch with 409 and does not corrupt graph', async () => {
    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()
    const scene = await operations.loadStoredScene(SCENE_ID)
    const currentVersion = scene!.version

    // Submit patch with stale baseVersion = 0
    const stalePatch: SceneGraphPatch = {
      baseVersion: 0,
      updatedNodes: {
        [wallA.id]: { ...wallA, start: [-999, -999], end: [-990, -999] },
      },
    }

    const res = await PATCH_SCENE(
      patchSceneRequest(SCENE_ID, { patch: stalePatch, baseVersion: 0 }),
      paramsFor(SCENE_ID),
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; currentVersion: number }
    expect(body.error).toBe('version_conflict')
    expect(body.currentVersion).toBe(currentVersion)
  })

  test('Adversarial: Wipe guard defends against destructive patch that deletes all nodes', async () => {
    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()
    const scene = await operations.loadStoredScene(SCENE_ID)
    const currentVersion = scene!.version
    const allNodeIds = Object.keys(scene!.graph.nodes)

    // Destructive patch attempting to delete all nodes without force: true
    const destructivePatch: SceneGraphPatch = {
      baseVersion: currentVersion,
      deletedNodeIds: allNodeIds,
    }

    const res = await PATCH_SCENE(
      patchSceneRequest(SCENE_ID, { patch: destructivePatch, baseVersion: currentVersion }),
      paramsFor(SCENE_ID),
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string; currentNodeCount: number }
    expect(body.error).toBe('empty_graph_rejected')
    expect(body.currentNodeCount).toBe(allNodeIds.length)

    // Verify DB still contains all nodes intact
    const sceneAfter = await operations.loadStoredScene(SCENE_ID)
    expect(sceneAfter?.version).toBe(currentVersion)
    expect(Object.keys(sceneAfter?.graph.nodes ?? {}).length).toBe(allNodeIds.length)
  })

  test('Adversarial Concurrency: Two simultaneous editor patches resolve cleanly without data loss', async () => {
    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()
    const scene = await operations.loadStoredScene(SCENE_ID)
    const baseVersion = scene!.version

    // Editor 1 moves wallA
    const patch1: SceneGraphPatch = {
      baseVersion,
      updatedNodes: {
        [wallA.id]: { ...wallA, start: [500, 500], end: [505, 500] },
      },
    }

    // Editor 2 moves wallB
    const patch2: SceneGraphPatch = {
      baseVersion,
      updatedNodes: {
        [wallB.id]: { ...wallB, start: [600, 600], end: [605, 600] },
      },
    }

    // Editor 1 saves first
    const res1 = await PATCH_SCENE(
      patchSceneRequest(SCENE_ID, { patch: patch1, baseVersion }),
      paramsFor(SCENE_ID),
    )
    expect(res1.status).toBe(200)
    const meta1 = (await res1.json()) as { version: number }
    expect(meta1.version).toBe(baseVersion + 1)

    // Editor 2 attempts to save with stale baseVersion -> gets 409
    const res2 = await PATCH_SCENE(
      patchSceneRequest(SCENE_ID, { patch: patch2, baseVersion }),
      paramsFor(SCENE_ID),
    )
    expect(res2.status).toBe(409)
    const conflictBody = (await res2.json()) as { error: string; currentVersion: number }
    expect(conflictBody.error).toBe('version_conflict')
    expect(conflictBody.currentVersion).toBe(meta1.version)

    // Editor 2 pulls latest scene, applies its patch against new version, and re-saves
    const updatedScene = await operations.loadStoredScene(SCENE_ID)
    expect(updatedScene?.version).toBe(meta1.version)
    expect(updatedScene?.graph.nodes[wallA.id].start).toEqual([500, 500])

    const rebasedPatch2: SceneGraphPatch = {
      baseVersion: meta1.version,
      updatedNodes: patch2.updatedNodes,
    }

    const rebasedRes2 = await PATCH_SCENE(
      patchSceneRequest(SCENE_ID, { patch: rebasedPatch2, baseVersion: meta1.version }),
      paramsFor(SCENE_ID),
    )
    expect(rebasedRes2.status).toBe(200)
    const meta2 = (await rebasedRes2.json()) as { version: number }
    expect(meta2.version).toBe(meta1.version + 1)

    // Final graph has BOTH Editor 1's wallA change AND Editor 2's wallB change!
    const finalScene = await operations.loadStoredScene(SCENE_ID)
    expect(finalScene?.graph.nodes[wallA.id].start).toEqual([500, 500])
    expect(finalScene?.graph.nodes[wallB.id].start).toEqual([600, 600])
  })

  test('Adversarial: Material and Collection differential patches sync correctly and update metadata', async () => {
    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()
    const scene = await operations.loadStoredScene(SCENE_ID)
    const baseVersion = scene!.version

    const patch: SceneGraphPatch = {
      baseVersion,
      materials: {
        mat_granite: { id: 'mat_granite' as any, name: 'Granite Tile', color: '#333333' } as any,
      },
      collections: {
        col_zone_1: { id: 'col_zone_1' as any, name: 'Living Area', nodeIds: [wallA.id as any] },
      },
      installedPlugins: ['trees', 'warehouse'],
    }

    const res = await PATCH_SCENE(
      patchSceneRequest(SCENE_ID, { patch, baseVersion }),
      paramsFor(SCENE_ID),
    )
    expect(res.status).toBe(200)

    const updatedScene = await operations.loadStoredScene(SCENE_ID)
    expect(updatedScene?.graph.materials?.mat_granite?.name).toBe('Granite Tile')
    expect(updatedScene?.graph.collections?.col_zone_1?.name).toBe('Living Area')
    expect(updatedScene?.graph.installedPlugins).toEqual(['trees', 'warehouse'])

    const events = await operations.listSceneEvents(SCENE_ID, { afterEventId: 0, limit: 50 })
    const latestEvent = events[events.length - 1]
    expect(latestEvent.patch?.materials?.mat_granite).toBeDefined()
    expect(latestEvent.patch?.collections?.col_zone_1).toBeDefined()
    expect(latestEvent.patch?.installedPlugins).toEqual(['trees', 'warehouse'])
  })

  test('Adversarial: Atomic batch creation and deletion in single patch maintains graph integrity', async () => {
    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()
    const scene = await operations.loadStoredScene(SCENE_ID)
    const baseVersion = scene!.version

    const newWallX = WallNode.parse({
      id: 'wall_x_created',
      parentId: 'level_test',
      start: [1000, 1000],
      end: [1005, 1000],
    })

    const comboPatch: SceneGraphPatch = {
      baseVersion,
      createdNodes: {
        [newWallX.id]: newWallX,
      },
      deletedNodeIds: [wallB.id], // Delete wallB
    }

    const res = await PATCH_SCENE(
      patchSceneRequest(SCENE_ID, { patch: comboPatch, baseVersion }),
      paramsFor(SCENE_ID),
    )
    expect(res.status).toBe(200)

    const updatedScene = await operations.loadStoredScene(SCENE_ID)
    expect(updatedScene?.graph.nodes['wall_x_created']).toBeDefined()
    expect(updatedScene?.graph.nodes[wallB.id]).toBeUndefined()
  })

  test('Adversarial: Key-ID mismatch in createdNodes or updatedNodes is rejected with 400', async () => {
    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()
    const scene = await operations.loadStoredScene(SCENE_ID)
    const baseVersion = scene!.version

    const badPatch: SceneGraphPatch = {
      baseVersion,
      createdNodes: {
        wall_key_mismatch: WallNode.parse({
          id: 'wall_real_id',
          parentId: 'level_test',
          start: [0, 0],
          end: [1, 0],
        }) as any,
      },
    }

    const res = await PATCH_SCENE(
      patchSceneRequest(SCENE_ID, { patch: badPatch, baseVersion }),
      paramsFor(SCENE_ID),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; details: Array<{ message: string }> }
    expect(body.error).toBe('invalid_request')
    expect(body.details.some((d) => d.message.includes('does not match node id'))).toBe(true)
  })

  test('Adversarial: Collection node references are cleaned up on node deletion via PATCH', async () => {
    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()
    const scene = await operations.loadStoredScene(SCENE_ID)
    const baseVersion = scene!.version

    // First ensure collection exists containing wallA and wall_extra_0
    const colPatch: SceneGraphPatch = {
      baseVersion,
      collections: {
        col_group: {
          id: 'col_group' as any,
          name: 'Group 1',
          nodeIds: [wallA.id as any, 'wall_extra_0' as any],
        },
      },
    }
    const res1 = await PATCH_SCENE(
      patchSceneRequest(SCENE_ID, { patch: colPatch, baseVersion }),
      paramsFor(SCENE_ID),
    )
    expect(res1.status).toBe(200)
    const meta1 = (await res1.json()) as { version: number }

    // Now delete wall_extra_0
    const delPatch: SceneGraphPatch = {
      baseVersion: meta1.version,
      deletedNodeIds: ['wall_extra_0'],
    }
    const res2 = await PATCH_SCENE(
      patchSceneRequest(SCENE_ID, { patch: delPatch, baseVersion: meta1.version }),
      paramsFor(SCENE_ID),
    )
    expect(res2.status).toBe(200)

    const finalScene = await operations.loadStoredScene(SCENE_ID)
    expect(finalScene?.graph.collections?.col_group?.nodeIds).toEqual([wallA.id as any])
    expect(finalScene?.graph.nodes['wall_extra_0']).toBeUndefined()
  })
})
