import { describe, expect, test } from 'bun:test'
import { resolveSessionUser } from './session-utils'

describe('SessionProvider resolveSessionUser Logic', () => {
  test('Correctly processes firstSignIn state for Cengiz Tuna with Supervisor role', () => {
    const response = {
      state: 'firstSignIn',
      user: {
        id: 'user-cengiz',
        email: 'cengiz.tuna@netlog.com.tr',
        role: 'Supervisor',
        permissions: ['edit_projects', 'create_projects'],
      },
    }

    const resolved = resolveSessionUser(response)
    expect(resolved).not.toBeNull()
    expect(resolved?.email).toBe('cengiz.tuna@netlog.com.tr')
    expect(resolved?.role).toBe('editor')
  })

  test('Correctly resolves Supervisor role even if permissions array is empty', () => {
    const response = {
      state: 'signedIn',
      user: {
        id: 'user-cengiz',
        email: 'cengiz.tuna@netlog.com.tr',
        role: 'Supervisor',
        permissions: [],
      },
    }

    const resolved = resolveSessionUser(response)
    expect(resolved).not.toBeNull()
    expect(resolved?.email).toBe('cengiz.tuna@netlog.com.tr')
    expect(resolved?.role).toBe('editor')
  })

  test('Correctly processes Admin user with admin_access', () => {
    const response = {
      state: 'signedIn',
      user: {
        id: 'admin-1',
        email: 'ovur.rsl@icloud.com',
        role: 'Admin',
        permissions: ['admin_access', 'edit_projects'],
      },
    }

    const resolved = resolveSessionUser(response)
    expect(resolved?.email).toBe('ovur.rsl@icloud.com')
    expect(resolved?.role).toBe('admin')
  })

  test('Correctly resolves Viewer role', () => {
    const response = {
      state: 'signedIn',
      user: {
        id: 'viewer-1',
        email: 'viewer@netlog.com.tr',
        role: 'Viewer',
        permissions: ['view_projects'],
      },
    }

    const resolved = resolveSessionUser(response)
    expect(resolved?.email).toBe('viewer@netlog.com.tr')
    expect(resolved?.role).toBe('viewer')
  })

  test('Correctly resolves idleWarning state', () => {
    const response = {
      state: 'idleWarning',
      user: {
        id: 'user-cengiz',
        email: 'cengiz.tuna@netlog.com.tr',
        role: 'Supervisor',
      },
    }

    const resolved = resolveSessionUser(response)
    expect(resolved?.email).toBe('cengiz.tuna@netlog.com.tr')
    expect(resolved?.role).toBe('editor')
  })

  test('Returns null on anonymous state', () => {
    const response = {
      state: 'anonymous',
      user: null,
    }

    expect(resolveSessionUser(response)).toBeNull()
  })

  test('Returns null on mfaRequired or mfaLocked state', () => {
    const response = {
      state: 'mfaRequired',
      user: {
        id: 'user-1',
        email: 'mfa@example.com',
      },
    }

    expect(resolveSessionUser(response)).toBeNull()
  })
})
