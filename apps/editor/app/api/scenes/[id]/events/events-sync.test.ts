import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WallNode } from '@pascal-app/core/schema'
import { NextRequest } from 'next/server'

const tempDir = mkdtempSync(join(tmpdir(), 'scenes-events-sync-test-'))
const SCENE_ID = 'events-sync-scene'

const wallA = WallNode.parse({ start: [0, 0], end: [4, 0] })
const wallB = WallNode.parse({ start: [4, 0], end: [4, 4] })
const INITIAL_GRAPH = {
  nodes: {
    [wallA.id]: wallA,
  },
  rootNodeIds: [wallA.id],
}
const UPDATED_GRAPH = {
  nodes: {
    [wallA.id]: wallA,
    [wallB.id]: wallB,
  },
  rootNodeIds: [wallA.id, wallB.id],
}

let PUT_SCENE: typeof import('../route')['PUT']
let POST_RESTORE: typeof import('../revisions/restore/route')['POST']
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
    name: 'Events Sync Test Fixture',
    ownerId: null,
    projectId: null,
    graph: INITIAL_GRAPH as never,
  })

  const sceneRoute = await import('../route')
  PUT_SCENE = sceneRoute.PUT

  const restoreRoute = await import('../revisions/restore/route')
  POST_RESTORE = restoreRoute.POST

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

function restoreRequest(sceneId: string, version: number): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/scenes/${sceneId}/revisions/restore`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      host: '127.0.0.1:3000',
    },
    body: JSON.stringify({ version }),
  })
}

function eventsRequest(sceneId: string): NextRequest {
  return new NextRequest(`http://127.0.0.1:3000/api/scenes/${sceneId}/events`, {
    method: 'GET',
    headers: {
      host: '127.0.0.1:3000',
    },
  })
}

function paramsFor(sceneId: string) {
  return { params: Promise.resolve({ id: sceneId }) }
}

describe('R1: Live Synchronization Backend & SSE Events', () => {
  beforeEach(async () => {
    mockAuthAvailable = false
    currentSessionUser = null
  })

  test('PUT /api/scenes/[id] appends a save_scene event to scene_events table', async () => {
    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()

    // Get current version
    const beforeScene = await operations.loadStoredScene(SCENE_ID)
    const initialVersion = beforeScene?.version ?? 1

    const res = await PUT_SCENE(
      putSceneRequest(SCENE_ID, { graph: UPDATED_GRAPH }, initialVersion),
      paramsFor(SCENE_ID),
    )
    expect(res.status).toBe(200)

    const meta = (await res.json()) as { version: number; nodeCount: number }
    expect(meta.version).toBe(initialVersion + 1)
    expect(meta.nodeCount).toBe(2)

    // Verify scene event was written to scene_events table
    const events = await operations.listSceneEvents(SCENE_ID, { afterEventId: 0, limit: 50 })
    expect(events.length).toBeGreaterThanOrEqual(1)

    const latestEvent = events[events.length - 1]
    expect(latestEvent.sceneId).toBe(SCENE_ID)
    expect(latestEvent.version).toBe(meta.version)
    expect(latestEvent.kind).toBe('save_scene')
    expect(Object.keys(latestEvent.graph.nodes)).toContain(wallB.id)
  })

  test('POST /api/scenes/[id]/revisions/restore appends a restore_revision event', async () => {
    const storeServer = await import('@/lib/scene-store-server')
    const operations = await storeServer.getSceneOperations()

    // Version 1 had 1 node (wallA)
    const restoreRes = await POST_RESTORE(
      restoreRequest(SCENE_ID, 1),
      paramsFor(SCENE_ID),
    )
    expect(restoreRes.status).toBe(200)
    const restoreData = (await restoreRes.json()) as { ok: boolean; version: number }
    expect(restoreData.ok).toBe(true)

    // Check latest event
    const events = await operations.listSceneEvents(SCENE_ID, { afterEventId: 0, limit: 50 })
    const latestEvent = events[events.length - 1]
    expect(latestEvent.sceneId).toBe(SCENE_ID)
    expect(latestEvent.version).toBe(restoreData.version)
    expect(latestEvent.kind).toBe('restore_revision')
  })

  test('GET /api/scenes/[id]/events establishes an SSE stream with proper headers', async () => {
    const res = await GET_EVENTS(eventsRequest(SCENE_ID), paramsFor(SCENE_ID))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    expect(res.headers.get('Cache-Control')).toContain('no-cache')
    expect(res.body).toBeDefined()
  })
})
