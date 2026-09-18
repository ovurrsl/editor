import { type NextRequest, NextResponse } from 'next/server'
import { authAvailable } from '@/lib/auth/db'
import { clearSessionCookie, getSession, revokeSession } from '@panel/lib/auth/session'

export const dynamic = 'force-dynamic'

function withViewerCors(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get('origin')
  if (origin) {
    if (
      origin === 'https://viewer.opex.help' ||
      origin.endsWith('.opex.help') ||
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://127.0.0.1')
    ) {
      response.headers.set('Access-Control-Allow-Origin', origin)
      response.headers.set('Access-Control-Allow-Credentials', 'true')
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    }
  }
  return response
}

export function OPTIONS(request: NextRequest) {
  const res = new NextResponse(null, { status: 204 })
  return withViewerCors(request, res)
}

export async function POST(request: NextRequest) {
  if (authAvailable()) {
    try {
      const session = await getSession({ touch: false })
      if (session) {
        await revokeSession(session.id)
      }
    } catch (e) {
      console.warn('Failed to revoke session on viewer signout:', e)
    }
    try {
      await clearSessionCookie()
    } catch (e) {
      console.warn('Failed to clear session cookie:', e)
    }
  }

  const res = NextResponse.json({ ok: true, signedOut: true })
  res.cookies.set('dt_session', '', {
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
  })

  return withViewerCors(request, res)
}
