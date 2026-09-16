import { describe, expect, test } from 'bun:test'
import { createViewerLaunchToken, verifyViewerLaunchToken } from './viewer-token'

describe('viewer launch token', () => {
  test('mints a valid token and verifies it correctly', () => {
    const user = {
      id: 'usr_123',
      email: 'cengiz.tuna@netlog.com.tr',
      name: 'Cengiz Tuna',
      role: 'viewer' as const,
    }

    const token = createViewerLaunchToken(user, { siteId: 'site_bursa' })
    expect(typeof token).toBe('string')
    expect(token.includes('.')).toBe(true)

    const payload = verifyViewerLaunchToken(token)
    expect(payload).not.toBeNull()
    expect(payload?.userId).toBe('usr_123')
    expect(payload?.email).toBe('cengiz.tuna@netlog.com.tr')
    expect(payload?.role).toBe('viewer')
    expect(payload?.siteId).toBe('site_bursa')
  })

  test('rejects tampered tokens', () => {
    const user = {
      id: 'usr_456',
      email: 'test@netlog.com.tr',
      role: 'viewer' as const,
    }

    const token = createViewerLaunchToken(user)
    const [data, sig] = token.split('.')

    // Tamper with data
    const tampered = `${data}x.${sig}`
    expect(verifyViewerLaunchToken(tampered)).toBeNull()

    // Tamper with sig
    const badSig = `${data}.${sig.slice(0, -2)}aa`
    expect(verifyViewerLaunchToken(badSig)).toBeNull()
  })

  test('rejects expired tokens', async () => {
    const user = {
      id: 'usr_789',
      email: 'expired@netlog.com.tr',
      role: 'viewer' as const,
    }

    // TTL of 0 seconds (instantly expired)
    const token = createViewerLaunchToken(user, { ttlSeconds: -1 })
    expect(verifyViewerLaunchToken(token)).toBeNull()
  })
})
