import { type NextRequest, NextResponse } from 'next/server'

/**
 * Keep page visits on the one host Better Auth is configured for.
 *
 * Google sends the OAuth callback to AUTH_BASE_URL (the stable branch URL on
 * previews, the production URL in production). A sign-in started on a
 * per-deploy URL (`project-<hash>-team.vercel.app`) sets its state cookie on
 * that host, so the callback on the canonical host fails with
 * `state_security_mismatch`. Redirecting page loads to the canonical host
 * makes the whole flow happen on one origin.
 */
function canonicalHost(): string | null {
  if (process.env.VERCEL_ENV === 'preview') {
    return process.env.VERCEL_BRANCH_URL ?? null
  }
  if (process.env.VERCEL_ENV === 'production') {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (appUrl) return new URL(appUrl).host
    return process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null
  }
  return null
}

export function proxy(request: NextRequest) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return NextResponse.next()

  const host = canonicalHost()
  const requestHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!(host && requestHost) || requestHost === host) return NextResponse.next()

  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${host}`)
  return NextResponse.redirect(target, 307)
}

export const config = {
  // Page routes only: API routes, Next assets and public files are left alone.
  matcher: ['/((?!api/|_next/|.*\\.[a-zA-Z0-9]+$).*)'],
}
