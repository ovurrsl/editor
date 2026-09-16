import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SessionUser } from './session'

export interface ViewerTokenPayload {
  userId: string
  email: string
  name?: string
  role: 'admin' | 'editor' | 'viewer'
  exp: number
  nonce: string
  siteId?: string
  sceneId?: string
  allowedSites?: Array<{ id: string; name: string; sceneId?: string | null }>
}

function getSecret(): string {
  return (
    process.env.DIGITALTWIN_SESSION_SECRET ||
    process.env.SECRET_ENCRYPTION_KEY ||
    process.env.SESSION_SECRET ||
    'digitaltwin_viewer_default_launch_secret_key'
  )
}

/**
 * Mints a cryptographically signed HMAC-SHA256 launch token.
 * Default validity: 60 seconds (prevents replay / URL leak vulnerabilities).
 */
export function createViewerLaunchToken(
  user: { id: string; email: string; name?: string; role: 'admin' | 'editor' | 'viewer' },
  options: {
    ttlSeconds?: number
    siteId?: string
    sceneId?: string
    allowedSites?: Array<{ id: string; name: string; sceneId?: string | null }>
  } = {},
): string {
  const secret = getSecret()
  const exp = Date.now() + (options.ttlSeconds ?? 60) * 1000
  const nonce = randomBytes(12).toString('hex')

  const payload: ViewerTokenPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    exp,
    nonce,
    siteId: options.siteId,
    sceneId: options.sceneId,
    allowedSites: options.allowedSites,
  }

  const encodedData = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', secret).update(encodedData).digest('base64url')

  return `${encodedData}.${signature}`
}

/**
 * Validates a signed launch token, returning the payload if signature and expiry check out.
 */
export function verifyViewerLaunchToken(token: string): ViewerTokenPayload | null {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encodedData, signature] = parts
  const secret = getSecret()
  const expectedSignature = createHmac('sha256', secret).update(encodedData).digest('base64url')

  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expectedSignature)
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null
  }

  try {
    const raw = Buffer.from(encodedData, 'base64url').toString('utf8')
    const payload = JSON.parse(raw) as ViewerTokenPayload
    if (!payload.exp || Date.now() > payload.exp) {
      return null // Expired
    }
    return payload
  } catch {
    return null
  }
}
