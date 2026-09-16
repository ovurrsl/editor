'use client'

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'

import {
  type ConsoleSessionResponse,
  resolveSessionUser,
  type SessionUser,
} from './session-utils'

export type { SessionUser }

interface SessionValue {
  user: SessionUser | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  /** Sends the visitor to the console's sign-in; used by gated actions on 401. */
  openAuth: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

/**
 * Sign-in itself lives in the console (/signin): it owns passwords, 2FA
 * and lockout. When a user has an active session (including firstSignIn or
 * idleWarning), user details and sign-out capability must be accessible to the
 * editor so the Account section and user-gated controls behave correctly.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' })
      const body = (await res.json()) as ConsoleSessionResponse
      setUser(resolveSessionUser(body))
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    // A bodyless POST fails JSON parsing server-side before the session is
    // ever looked up, so the cookie and session row both survive — the UI
    // would redirect to /signin while the account stayed signed in underneath.
    await fetch('/api/auth/signout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allDevices: false }),
    }).catch(() => {})
    setUser(null)
  }, [])

  const openAuth = useCallback(() => {
    window.location.href = '/signin'
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <SessionContext.Provider value={{ user, loading, refresh, signOut, openAuth }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    // Rendered outside the provider (shouldn't happen); degrade to signed-out.
    return {
      user: null,
      loading: false,
      refresh: async () => {},
      signOut: async () => {},
      openAuth: () => {},
    }
  }
  return ctx
}
