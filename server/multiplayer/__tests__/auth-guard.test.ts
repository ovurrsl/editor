import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import type { IncomingMessage } from 'node:http'
import {
  mapRole,
  createCollabToken,
  verifyCollabToken,
  authenticateCollabConnection,
  getCollabJwtSecret,
  type CollabTokenPayload,
} from '../auth-guard'

describe('WebSocket Auth Guard & Role Normalization Unit Tests', () => {
  const secret = 'test-collab-jwt-secret-xyz123'
  const originalEnvSecret = process.env.COLLAB_JWT_SECRET
  const originalEnvNodeEnv = process.env.NODE_ENV
  const originalEnvAllowAnon = process.env.ALLOW_ANON_COLLAB

  beforeEach(() => {
    process.env.COLLAB_JWT_SECRET = secret
    process.env.NODE_ENV = 'test'
    delete process.env.ALLOW_ANON_COLLAB
  })

  afterEach(() => {
    if (originalEnvSecret !== undefined) {
      process.env.COLLAB_JWT_SECRET = originalEnvSecret
    } else {
      delete process.env.COLLAB_JWT_SECRET
    }
    process.env.NODE_ENV = originalEnvNodeEnv
    if (originalEnvAllowAnon !== undefined) {
      process.env.ALLOW_ANON_COLLAB = originalEnvAllowAnon
    } else {
      delete process.env.ALLOW_ANON_COLLAB
    }
  })

  // =========================================================================
  // 1. Role Normalization (Case-Insensitive)
  // =========================================================================
  describe('Role Normalization (mapRole)', () => {
    test('normalizes editor/admin write roles case-insensitively', () => {
      expect(mapRole('Admin')).toBe('editor')
      expect(mapRole('admin')).toBe('editor')
      expect(mapRole('ADMIN')).toBe('editor')
      expect(mapRole('Supervisor')).toBe('editor')
      expect(mapRole('supervisor')).toBe('editor')
      expect(mapRole('Editor')).toBe('editor')
      expect(mapRole('editor')).toBe('editor')
      expect(mapRole('EDITOR')).toBe('editor')
      expect(mapRole('Owner')).toBe('editor')
      expect(mapRole('owner')).toBe('editor')
      expect(mapRole('Lead')).toBe('editor')
      expect(mapRole('Manager')).toBe('editor')
      expect(mapRole('  Editor  ')).toBe('editor')
    })

    test('normalizes viewer and unprivileged roles to viewer', () => {
      expect(mapRole('Viewer')).toBe('viewer')
      expect(mapRole('viewer')).toBe('viewer')
      expect(mapRole('VIEWER')).toBe('viewer')
      expect(mapRole('Guest')).toBe('viewer')
      expect(mapRole('guest')).toBe('viewer')
      expect(mapRole('Reader')).toBe('viewer')
      expect(mapRole('attacker')).toBe('viewer')
      expect(mapRole('')).toBe('viewer')
      expect(mapRole(null)).toBe('viewer')
      expect(mapRole(undefined)).toBe('viewer')
    })
  })

  // =========================================================================
  // 2. Cryptographic JWT Verification (HMAC-SHA256)
  // =========================================================================
  describe('Cryptographic Token Creation & Verification', () => {
    test('creates and verifies a valid HMAC-SHA256 JWT token', () => {
      const payload: CollabTokenPayload = {
        userId: 'user-42',
        name: 'Alice Developer',
        role: 'Admin',
        sceneId: 'scene-alpha',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }

      const token = createCollabToken(payload, secret)
      expect(typeof token).toBe('string')
      expect(token.split('.').length).toBe(3)

      const verified = verifyCollabToken(token, secret)
      expect(verified).not.toBeNull()
      expect(verified?.userId).toBe('user-42')
      expect(verified?.name).toBe('Alice Developer')
      expect(verified?.role).toBe('Admin')
      expect(verified?.sceneId).toBe('scene-alpha')
    })

    test('rejects token signed with a different secret', () => {
      const token = createCollabToken({ userId: 'u1', role: 'Editor' }, 'wrong-secret-key')
      const verified = verifyCollabToken(token, secret)
      expect(verified).toBeNull()
    })

    test('rejects tampered token payload', () => {
      const token = createCollabToken({ userId: 'u1', role: 'Viewer' }, secret)
      const [h, p, s] = token.split('.')

      // Tamper payload to elevate role
      const tamperedPayload = Buffer.from(
        JSON.stringify({ userId: 'u1', role: 'Admin' }),
      ).toString('base64url')
      const tamperedToken = `${h}.${tamperedPayload}.${s}`

      const verified = verifyCollabToken(tamperedToken, secret)
      expect(verified).toBeNull()
    })

    test('rejects tampered signature', () => {
      const token = createCollabToken({ userId: 'u1', role: 'Admin' }, secret)
      const [h, p, s] = token.split('.')
      const tamperedSig = s.slice(0, -4) + 'AAAA'
      const tamperedToken = `${h}.${p}.${tamperedSig}`

      const verified = verifyCollabToken(tamperedToken, secret)
      expect(verified).toBeNull()
    })

    test('rejects expired token', () => {
      const expiredPayload: CollabTokenPayload = {
        userId: 'u1',
        role: 'Editor',
        exp: Math.floor(Date.now() / 1000) - 60, // Expired 1 minute ago
      }
      const token = createCollabToken(expiredPayload, secret)
      const verified = verifyCollabToken(token, secret)
      expect(verified).toBeNull()
    })

    test('rejects token before its nbf (not-before) timestamp', () => {
      const futurePayload: CollabTokenPayload = {
        userId: 'u1',
        role: 'Editor',
        nbf: Math.floor(Date.now() / 1000) + 3600, // Valid in 1 hour
      }
      const token = createCollabToken(futurePayload, secret)
      const verified = verifyCollabToken(token, secret)
      expect(verified).toBeNull()
    })

    test('handles malformed token strings safely', () => {
      expect(verifyCollabToken('', secret)).toBeNull()
      expect(verifyCollabToken('not-a-token', secret)).toBeNull()
      expect(verifyCollabToken('a.b', secret)).toBeNull()
      expect(verifyCollabToken('a.b.c.d', secret)).toBeNull()
      expect(verifyCollabToken('invalid_base64.invalid_base64.invalid_base64', secret)).toBeNull()
    })
  })

  // =========================================================================
  // 3. HTTP Upgrade Authentication Handshake
  // =========================================================================
  describe('authenticateCollabConnection Handshake', () => {
    function createMockRequest(options?: {
      url?: string
      authorization?: string
      cookie?: string
    }): IncomingMessage {
      return {
        url: options?.url ?? '/',
        headers: {
          host: '127.0.0.1:3002',
          ...(options?.authorization ? { authorization: options.authorization } : {}),
          ...(options?.cookie ? { cookie: options.cookie } : {}),
        },
      } as unknown as IncomingMessage
    }

    test('authenticates valid editor token from URL query ?token=', async () => {
      const token = createCollabToken(
        { userId: 'ed-1', name: 'Bob Builder', role: 'Editor', sceneId: 'scene-101' },
        secret,
      )
      const req = createMockRequest({ url: `/collab/v1/scene:scene-101?token=${token}` })

      const auth = await authenticateCollabConnection(req, 'scene-101')
      expect(auth).not.toBeNull()
      expect(auth?.userId).toBe('ed-1')
      expect(auth?.name).toBe('Bob Builder')
      expect(auth?.role).toBe('editor')
      expect(auth?.readOnly).toBe(false)
      expect(auth?.sceneId).toBe('scene-101')
    })

    test('authenticates valid token from Authorization: Bearer header', async () => {
      const token = createCollabToken(
        { userId: 'sup-1', name: 'Super Visor', role: 'Supervisor' },
        secret,
      )
      const req = createMockRequest({
        url: '/collab/v1/scene:scene-202',
        authorization: `Bearer ${token}`,
      })

      const auth = await authenticateCollabConnection(req, 'scene-202')
      expect(auth).not.toBeNull()
      expect(auth?.userId).toBe('sup-1')
      expect(auth?.role).toBe('editor')
      expect(auth?.readOnly).toBe(false)
    })

    test('authenticates valid token from dt_session Cookie', async () => {
      const token = createCollabToken(
        { userId: 'adm-1', name: 'Admin Boss', role: 'Admin' },
        secret,
      )
      const req = createMockRequest({
        url: '/collab/v1/scene:scene-303',
        cookie: `dt_session=${token}; other=value`,
      })

      const auth = await authenticateCollabConnection(req, 'scene-303')
      expect(auth).not.toBeNull()
      expect(auth?.userId).toBe('adm-1')
      expect(auth?.role).toBe('editor')
      expect(auth?.readOnly).toBe(false)
    })

    test('enforces viewer readOnly for Viewer role in token', async () => {
      const token = createCollabToken(
        { userId: 'vw-1', name: 'Vic Viewer', role: 'Viewer' },
        secret,
      )
      const req = createMockRequest({ url: `/collab/v1/scene:scene-101?token=${token}` })

      const auth = await authenticateCollabConnection(req, 'scene-101')
      expect(auth).not.toBeNull()
      expect(auth?.userId).toBe('vw-1')
      expect(auth?.role).toBe('viewer')
      expect(auth?.readOnly).toBe(true)
    })

    test('rejects connection when token sceneId does not match requested sceneId', async () => {
      const token = createCollabToken(
        { userId: 'ed-1', role: 'Editor', sceneId: 'scene-999' },
        secret,
      )
      const req = createMockRequest({ url: `/collab/v1/scene:scene-101?token=${token}` })

      const auth = await authenticateCollabConnection(req, 'scene-101')
      expect(auth).toBeNull()
    })

    test('accepts wildcard token sceneId for any scene', async () => {
      const token = createCollabToken(
        { userId: 'ed-1', role: 'Editor', sceneId: '*' },
        secret,
      )
      const req = createMockRequest({ url: `/collab/v1/scene:scene-101?token=${token}` })

      const auth = await authenticateCollabConnection(req, 'scene-101')
      expect(auth).not.toBeNull()
      expect(auth?.role).toBe('editor')
      expect(auth?.readOnly).toBe(false)
    })

    test('rejects connection when invalid token is provided', async () => {
      const req = createMockRequest({ url: '/collab/v1/scene:scene-101?token=invalid.jwt.token' })
      const auth = await authenticateCollabConnection(req, 'scene-101')
      expect(auth).toBeNull()
    })

    test('rejects connection when expired token is provided', async () => {
      const token = createCollabToken(
        { userId: 'ed-1', role: 'Editor', exp: Math.floor(Date.now() / 1000) - 100 },
        secret,
      )
      const req = createMockRequest({ url: `/collab/v1/scene:scene-101?token=${token}` })
      const auth = await authenticateCollabConnection(req, 'scene-101')
      expect(auth).toBeNull()
    })

    test('dev fallback strictly enforces readOnly: true and ignores query ?role=editor', async () => {
      process.env.NODE_ENV = 'development'
      // Attacker passes ?role=editor in query parameters without a signed token
      const req = createMockRequest({
        url: '/collab/v1/scene:scene-101?role=editor&userId=attacker&name=EvilHacker',
      })

      const auth = await authenticateCollabConnection(req, 'scene-101')
      expect(auth).not.toBeNull()
      expect(auth?.userId).toBe('attacker')
      expect(auth?.name).toBe('EvilHacker')
      // Must be forced to viewer and readOnly!
      expect(auth?.role).toBe('viewer')
      expect(auth?.readOnly).toBe(true)
    })

    test('production mode rejects unauthenticated connections without token', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.ALLOW_ANON_COLLAB

      const req = createMockRequest({ url: '/collab/v1/scene:scene-101' })
      const auth = await authenticateCollabConnection(req, 'scene-101')
      expect(auth).toBeNull()
    })

    test('production mode allows anonymous viewer if ALLOW_ANON_COLLAB=true', async () => {
      process.env.NODE_ENV = 'production'
      process.env.ALLOW_ANON_COLLAB = 'true'

      const req = createMockRequest({ url: '/collab/v1/scene:scene-101' })
      const auth = await authenticateCollabConnection(req, 'scene-101')
      expect(auth).not.toBeNull()
      expect(auth?.role).toBe('viewer')
      expect(auth?.readOnly).toBe(true)
    })
  })
})
