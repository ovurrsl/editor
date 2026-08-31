import type { IncomingMessage } from 'node:http'
import * as crypto from 'node:crypto'

export type ClientRole = 'editor' | 'viewer'

export interface CollabAuthResult {
  userId: string
  name: string
  role: ClientRole
  readOnly: boolean
  sceneId: string
}

export interface CollabTokenPayload {
  sub?: string
  userId?: string
  id?: string
  name?: string
  username?: string
  role?: string
  userRole?: string
  roles?: string[]
  sceneId?: string
  scene_id?: string
  exp?: number
  nbf?: number
  iat?: number
  [key: string]: unknown
}

const WRITE_ROLES = new Set(['admin', 'supervisor', 'editor', 'owner', 'lead', 'manager', 'writer', 'creator'])

/**
 * Normalizes user role case-insensitively.
 * Maps 'Admin', 'Supervisor', 'Editor', 'editor', etc. to 'editor' (write access).
 * Maps 'Viewer', 'viewer', guest, null, undefined, etc. to 'viewer' (read-only).
 */
export function mapRole(rawRole?: string | null): ClientRole {
  if (!rawRole || typeof rawRole !== 'string') return 'viewer'
  const normalized = rawRole.trim().toLowerCase()
  if (WRITE_ROLES.has(normalized)) {
    return 'editor'
  }
  return 'viewer'
}

/**
 * Helper to get the active collab secret from environment.
 */
export function getCollabJwtSecret(): string {
  return process.env.COLLAB_JWT_SECRET || process.env.JWT_SECRET || 'dev-collab-secret'
}

/**
 * Creates a signed HMAC-SHA256 JWT for WebSocket multiplayer authentication.
 */
export function createCollabToken(
  payload: CollabTokenPayload,
  secret: string = getCollabJwtSecret(),
): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signatureB64 = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url')

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

/**
 * Cryptographically verifies an HMAC-SHA256 JWT token.
 * Returns parsed claims if valid, or null if signature is invalid, expired, or malformed.
 */
export function verifyCollabToken(
  token: string,
  secret: string = getCollabJwtSecret(),
): CollabTokenPayload | null {
  try {
    if (!token || typeof token !== 'string') return null
    const parts = token.trim().split('.')
    if (parts.length !== 3) return null
    const [headerB64, payloadB64, signatureB64] = parts

    if (!headerB64 || !payloadB64 || !signatureB64) return null

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url')

    const sigBuf = Buffer.from(signatureB64)
    const expBuf = Buffer.from(expectedSignature)

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null
    }

    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8')
    const payload = JSON.parse(payloadJson) as CollabTokenPayload

    const nowSeconds = Math.floor(Date.now() / 1000)
    if (typeof payload.exp === 'number' && payload.exp < nowSeconds) {
      return null // Expired
    }
    if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) {
      return null // Not active yet
    }

    return payload
  } catch {
    return null
  }
}

/**
 * Parses cookies from incoming HTTP request Cookie header.
 */
function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!cookieHeader) return cookies
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=')
    if (idx > 0) {
      const key = pair.slice(0, idx).trim()
      const val = pair.slice(idx + 1).trim()
      cookies[key] = decodeURIComponent(val)
    }
  }
  return cookies
}

/**
 * Authenticates a WebSocket upgrade request for a specific scene session.
 * Enforces cryptographic token validation, role normalization, and RBAC (editor vs viewer).
 */
export async function authenticateCollabConnection(
  req: IncomingMessage,
  sceneId: string,
): Promise<CollabAuthResult | null> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    const cookies = parseCookies(req.headers.cookie)

    const token =
      url.searchParams.get('token') ||
      url.searchParams.get('jwt') ||
      url.searchParams.get('access_token') ||
      url.searchParams.get('sessionToken') ||
      url.searchParams.get('session_token') ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7).trim()
        : req.headers.authorization?.trim()) ||
      cookies.dt_session ||
      cookies.collab_token ||
      cookies.token ||
      null

    const secret = getCollabJwtSecret()

    if (token) {
      const claims = verifyCollabToken(token, secret)
      if (!claims) {
        // Invalid or expired token presented -> reject connection
        return null
      }

      // Enforce sceneId scope if token is scoped to a specific scene
      const tokenSceneId = claims.sceneId || claims.scene_id
      if (tokenSceneId && tokenSceneId !== '*' && tokenSceneId !== sceneId) {
        return null // Token not valid for this scene
      }

      // Extract user role from claims
      const rawRole =
        claims.role ||
        claims.userRole ||
        (Array.isArray(claims.roles) ? claims.roles[0] : null)
      const role = mapRole(typeof rawRole === 'string' ? rawRole : null)

      const userId =
        claims.userId ||
        claims.sub ||
        claims.id ||
        `user_${crypto.randomBytes(4).toString('hex')}`
      const name =
        claims.name ||
        claims.username ||
        `User ${userId.slice(0, 4)}`

      return {
        userId,
        name,
        role,
        readOnly: role === 'viewer',
        sceneId,
      }
    }

    // No token provided:
    // In production, reject unauthenticated connections unless explicit anonymous access is enabled
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_ANON_COLLAB) {
      return null
    }

    // Permissive / dev fallback: STRICTLY enforce readOnly viewer.
    // Notice: We do NOT trust client-supplied ?role=editor in query parameters without a signed token!
    const queryUserId = url.searchParams.get('userId')
    const queryName = url.searchParams.get('name')
    const userId = queryUserId || `anon_${crypto.randomBytes(4).toString('hex')}`
    const name = queryName || (queryUserId ? `User ${queryUserId.slice(0, 4)}` : 'Anonymous Viewer')

    return {
      userId,
      name,
      role: 'viewer',
      readOnly: true,
      sceneId,
    }
  } catch (err) {
    console.error('[Collab Auth Guard] Authentication error:', err)
    return null
  }
}
