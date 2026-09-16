export interface ConsoleSessionResponse {
  state: 'anonymous' | 'signedIn' | 'mfaRequired' | 'firstSignIn' | 'idleWarning' | string
  user: {
    id: string
    email: string
    name?: string
    username?: string
    role?: string
    permissions?: string[]
  } | null
}

export interface SessionUser {
  id: string
  email: string
  role: 'admin' | 'editor' | 'viewer'
}

export function resolveSessionUser(body: ConsoleSessionResponse): SessionUser | null {
  if (
    body.user &&
    body.state !== 'anonymous' &&
    body.state !== 'mfaRequired' &&
    body.state !== 'mfaLocked'
  ) {
    const permissions = body.user.permissions ?? []
    const rawRole = (body.user.role ?? '').toLowerCase()
    const isAdmin = permissions.includes('admin_access') || rawRole === 'admin'
    const isEditor =
      permissions.includes('edit_projects') ||
      permissions.includes('create_projects') ||
      rawRole === 'editor' ||
      rawRole === 'supervisor'

    return {
      id: body.user.id,
      email: body.user.email,
      role: isAdmin ? 'admin' : isEditor ? 'editor' : 'viewer',
    }
  }
  return null
}
