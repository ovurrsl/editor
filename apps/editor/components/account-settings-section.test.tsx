import { describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { renderToString } from 'react-dom/server'

// Mock next/navigation
let pushedRoute: string | null = null
mock.module('next/navigation', () => ({
  useRouter: () => ({
    push: (route: string) => {
      pushedRoute = route
    },
  }),
}))

let currentSession: {
  user: { id: string; email: string; role: 'admin' | 'editor' | 'viewer' } | null
  loading: boolean
  signOut: () => Promise<void>
} = {
  user: null,
  loading: false,
  signOut: async () => {},
}

mock.module('@/components/auth/session-provider', () => ({
  useSession: () => currentSession,
  resolveSessionUser: () => currentSession.user,
}))

describe('AccountSettingsSection & Role Enforcement', () => {
  test('Renders Administrator with Open admin console and Sign out for admin user', async () => {
    currentSession = {
      user: { id: 'admin-1', email: 'ovur.rsl@icloud.com', role: 'admin' },
      loading: false,
      signOut: async () => {},
    }

    const { AccountSettingsSection } = await import('./account-settings-section')
    const html = renderToString(React.createElement(AccountSettingsSection))

    expect(html).toContain('ovur.rsl@icloud.com')
    expect(html).toContain('Administrator')
    expect(html).toContain('Open admin console')
    expect(html).toContain('Sign out')
  })

  test('Renders Cengiz Tuna with Editor role, Sign out button, and NO admin console button', async () => {
    currentSession = {
      user: { id: 'user-cengiz', email: 'cengiz.tuna@netlog.com.tr', role: 'editor' },
      loading: false,
      signOut: async () => {},
    }

    const { AccountSettingsSection } = await import('./account-settings-section')
    const html = renderToString(React.createElement(AccountSettingsSection))

    expect(html).toContain('cengiz.tuna@netlog.com.tr')
    expect(html).toContain('Editor')
    expect(html).toContain('Sign out')
    expect(html).not.toContain('Open admin console')
  })

  test('Renders Viewer role with Sign out button and NO admin console button', async () => {
    currentSession = {
      user: { id: 'user-viewer', email: 'viewer@netlog.com.tr', role: 'viewer' },
      loading: false,
      signOut: async () => {},
    }

    const { AccountSettingsSection } = await import('./account-settings-section')
    const html = renderToString(React.createElement(AccountSettingsSection))

    expect(html).toContain('viewer@netlog.com.tr')
    expect(html).toContain('Viewer (read-only)')
    expect(html).toContain('Sign out')
    expect(html).not.toContain('Open admin console')
  })

  test('Renders loading skeleton when session is loading', async () => {
    currentSession = {
      user: null,
      loading: true,
      signOut: async () => {},
    }

    const { AccountSettingsSection } = await import('./account-settings-section')
    const html = renderToString(React.createElement(AccountSettingsSection))

    expect(html).toContain('animate-pulse')
    expect(html).not.toContain('Sign out')
  })

  test('Renders Sign in fallback button when user is unauthenticated', async () => {
    currentSession = {
      user: null,
      loading: false,
      signOut: async () => {},
    }

    const { AccountSettingsSection } = await import('./account-settings-section')
    const html = renderToString(React.createElement(AccountSettingsSection))

    expect(html).toContain('Sign in')
    expect(html).not.toContain('Sign out')
    expect(html).not.toContain('Open admin console')
  })
})
