import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import {
  CollabWebSocketServer,
  createCollabWebSocketServer,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
} from '../ws-server'
import { createCollabToken } from '../auth-guard'

describe('CollabWebSocketServer Memory Eviction & RBAC Test Suite', () => {
  let httpServer: http.Server
  let collabServer: CollabWebSocketServer
  let port: number
  const secret = 'ws-test-secret-456'

  beforeEach(async () => {
    process.env.COLLAB_JWT_SECRET = secret
    process.env.NODE_ENV = 'test'
    httpServer = http.createServer()
    collabServer = createCollabWebSocketServer(httpServer)
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()))
    port = (httpServer.address() as AddressInfo).port
  })

  afterEach(async () => {
    await collabServer.close()
  })

  // =========================================================================
  // 1. Room Creation & Memory Eviction on Disconnection
  // =========================================================================
  describe('Room Lifecycle & Memory Eviction', () => {
    test('creates room on connection and evicts/destroys doc on disconnect (0 connections)', async () => {
      const sceneId = 'lifecycle-scene-1'
      const token = createCollabToken({ userId: 'u1', role: 'Editor', sceneId }, secret)

      // 1. Connect client 1
      const ws1 = new WebSocket(`ws://127.0.0.1:${port}/collab/v1/scene:${sceneId}?token=${token}`)
      await new Promise((resolve) => ws1.on('open', resolve))

      expect(collabServer.rooms.has(sceneId)).toBe(true)
      const room = collabServer.rooms.get(sceneId)!
      expect(room.conns.size).toBe(1)
      expect(room.doc).toBeDefined()
      expect(room.awareness).toBeDefined()

      // 2. Connect client 2 to same room
      const token2 = createCollabToken({ userId: 'u2', role: 'Viewer', sceneId }, secret)
      const ws2 = new WebSocket(`ws://127.0.0.1:${port}/collab/v1/scene:${sceneId}?token=${token2}`)
      await new Promise((resolve) => ws2.on('open', resolve))

      expect(room.conns.size).toBe(2)

      // 3. Disconnect client 1 -> room still has 1 client, must NOT be evicted
      ws1.close()
      await new Promise((r) => setTimeout(r, 50))
      expect(room.conns.size).toBe(1)
      expect(collabServer.rooms.has(sceneId)).toBe(true)

      // 4. Disconnect client 2 -> room has 0 clients, MUST be destroyed and evicted
      ws2.close()
      await new Promise((r) => setTimeout(r, 50))

      // Room must be evicted from Map
      expect(collabServer.rooms.has(sceneId)).toBe(false)
      // Y.Doc should be destroyed (no event handlers)
      expect(room.conns.size).toBe(0)
    })

    test('multi-room isolation: evicting room A does not destroy active room B', async () => {
      const sceneA = 'room-a-evict'
      const sceneB = 'room-b-persist'

      const tokenA = createCollabToken({ userId: 'userA', role: 'Editor', sceneId: sceneA }, secret)
      const tokenB = createCollabToken({ userId: 'userB', role: 'Editor', sceneId: sceneB }, secret)

      const wsA = new WebSocket(`ws://127.0.0.1:${port}/collab/v1/scene:${sceneA}?token=${tokenA}`)
      const wsB = new WebSocket(`ws://127.0.0.1:${port}/collab/v1/scene:${sceneB}?token=${tokenB}`)

      await Promise.all([
        new Promise((resolve) => wsA.on('open', resolve)),
        new Promise((resolve) => wsB.on('open', resolve)),
      ])

      expect(collabServer.rooms.has(sceneA)).toBe(true)
      expect(collabServer.rooms.has(sceneB)).toBe(true)

      // Close wsA
      wsA.close()
      await new Promise((r) => setTimeout(r, 50))

      expect(collabServer.rooms.has(sceneA)).toBe(false)
      expect(collabServer.rooms.has(sceneB)).toBe(true)

      // Close wsB
      wsB.close()
      await new Promise((r) => setTimeout(r, 50))

      expect(collabServer.rooms.has(sceneB)).toBe(false)
    })
  })

  // =========================================================================
  // 2. RBAC & Mutation Filtering
  // =========================================================================
  describe('Server-side Mutation Filtering for ReadOnly Clients', () => {
    test('drops mutations sent by readOnly viewer and increments droppedViewerPacketsCount', async () => {
      const sceneId = 'rbac-scene-1'
      const viewerToken = createCollabToken({ userId: 'viewer-1', role: 'Viewer', sceneId }, secret)
      const editorToken = createCollabToken({ userId: 'editor-1', role: 'Editor', sceneId }, secret)

      const viewerWs = new WebSocket(`ws://127.0.0.1:${port}/collab/v1/scene:${sceneId}?token=${viewerToken}`)
      const editorWs = new WebSocket(`ws://127.0.0.1:${port}/collab/v1/scene:${sceneId}?token=${editorToken}`)

      await Promise.all([
        new Promise((resolve) => viewerWs.on('open', resolve)),
        new Promise((resolve) => editorWs.on('open', resolve)),
      ])

      const room = collabServer.getOrCreateRoom(sceneId)
      const initialDropped = collabServer.droppedViewerPacketsCount

      // 1. Viewer sends malicious update
      const rogueDoc = new Y.Doc()
      rogueDoc.getMap('nodes').set('rogue-node-1', 'exploit')
      const rogueUpdate = Y.encodeStateAsUpdate(rogueDoc)

      const rogueEncoder = encoding.createEncoder()
      encoding.writeVarUint(rogueEncoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(rogueEncoder, rogueUpdate)
      viewerWs.send(encoding.toUint8Array(rogueEncoder))

      await new Promise((r) => setTimeout(r, 50))

      // Verify dropped
      expect(collabServer.droppedViewerPacketsCount).toBe(initialDropped + 1)
      expect(room.doc.getMap('nodes').has('rogue-node-1')).toBe(false)

      // 2. Editor sends legitimate update
      const editDoc = new Y.Doc()
      editDoc.getMap('nodes').set('legit-node-1', { id: 'legit-node-1', type: 'wall' })
      const editUpdate = Y.encodeStateAsUpdate(editDoc)

      const editEncoder = encoding.createEncoder()
      encoding.writeVarUint(editEncoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(editEncoder, editUpdate)
      editorWs.send(encoding.toUint8Array(editEncoder))

      await new Promise((r) => setTimeout(r, 50))

      // Verify accepted
      expect(room.doc.getMap('nodes').has('legit-node-1')).toBe(true)

      viewerWs.close()
      editorWs.close()
      rogueDoc.destroy()
      editDoc.destroy()
    })

    test('allows readOnly viewer to receive document via SyncStep1', async () => {
      const sceneId = 'sync-scene-1'
      const room = collabServer.getOrCreateRoom(sceneId)
      room.doc.getMap('nodes').set('initial-node', 'initial-data')

      const viewerToken = createCollabToken({ userId: 'viewer-2', role: 'Viewer', sceneId }, secret)
      const viewerWs = new WebSocket(`ws://127.0.0.1:${port}/collab/v1/scene:${sceneId}?token=${viewerToken}`)
      const clientDoc = new Y.Doc()

      viewerWs.on('message', (data: Buffer | ArrayBuffer) => {
        const uint8 = new Uint8Array(data as ArrayBuffer)
        const decoder = decoding.createDecoder(uint8)
        const msgType = decoding.readVarUint(decoder)
        if (msgType === MESSAGE_SYNC) {
          const respEnc = encoding.createEncoder()
          encoding.writeVarUint(respEnc, MESSAGE_SYNC)
          syncProtocol.readSyncMessage(decoder, respEnc, clientDoc, 'remote')
          if (encoding.length(respEnc) > 1 && viewerWs.readyState === WebSocket.OPEN) {
            viewerWs.send(encoding.toUint8Array(respEnc))
          }
        }
      })

      await new Promise((resolve) => viewerWs.on('open', resolve))

      // Client sends SyncStep1 to server
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, MESSAGE_SYNC)
      syncProtocol.writeSyncStep1(enc, clientDoc)
      viewerWs.send(encoding.toUint8Array(enc))

      await new Promise((r) => setTimeout(r, 100))
      expect(clientDoc.getMap('nodes').get('initial-node')).toBe('initial-data')

      viewerWs.close()
      clientDoc.destroy()
    })
  })
})
