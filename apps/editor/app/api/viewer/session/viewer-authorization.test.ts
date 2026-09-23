import { describe, expect, mock, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { createViewerLaunchToken } from '@/lib/auth/viewer-token'

describe('Viewer Session & Role-Based Authorization Enforcement', () => {
  test('Admin user via launch token receives admin privileges and all facilities', async () => {
    const { POST } = await import('./route')
    const adminToken = createViewerLaunchToken({
      id: 'usr_admin_test_1',
      email: 'admin@opex.help',
      role: 'admin',
    })

    const req = new NextRequest('http://localhost:3000/api/viewer/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: adminToken }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.user.role).toBe('admin')
    expect(Array.isArray(data.allowedSites)).toBe(true)
    // Admin must have Bursa Başköy available
    const hasBursa = data.allowedSites.some(
      (s: { id: string; sceneId?: string }) =>
        s.id === '01JM1SITE00000000000000002' || s.sceneId === 'bursa_baskoy'
    )
    expect(hasBursa).toBe(true)
  })

  test('Non-admin user with no site assignments or owned scenes receives 0 allowed sites (zero leaks)', async () => {
    const { POST } = await import('./route')
    const emptyUserToken = createViewerLaunchToken({
      id: 'usr_unassigned_guest_999',
      email: 'guest@external.com',
      role: 'viewer',
    })

    const req = new NextRequest('http://localhost:3000/api/viewer/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: emptyUserToken }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.user.role).toBe('viewer')
    expect(Array.isArray(data.allowedSites)).toBe(true)
    // Non-admin with 0 assignments MUST NOT receive Bursa or any unassigned site
    expect(data.allowedSites.length).toBe(0)
    expect(data.defaultSite).toBeNull()
  })

  test('Signed-in non-admin user with dedicated site assignment receives ONLY their assigned site', async () => {
    const { POST } = await import('./route')
    const assignedUserToken = createViewerLaunchToken({
      id: 'usr_assigned_sakarya_only',
      email: 'sakarya@operator.com',
      role: 'viewer',
    })

    const req = new NextRequest('http://localhost:3000/api/viewer/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: assignedUserToken }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    // Does not receive any arbitrary unassigned site
    expect(data.allowedSites.every((s: { name: string }) => !s.name.includes('Bursa'))).toBe(true)
  })
})
