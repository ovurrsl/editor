import { type NextRequest, NextResponse } from 'next/server'
import { authAvailable } from '@/lib/auth/db'
import { getSessionUser } from '@/lib/auth/session'
import { verifyViewerLaunchToken } from '@/lib/auth/viewer-token'
import { query, type RowDataPacket } from '@panel/lib/db'

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

const BURSA_DEFAULT_SITE = {
  id: 'site_bursa',
  name: 'Nestlé & Netlog Bursa Başköy',
  location: 'Bursa, Nilüfer',
  areaM2: 24500,
  palletSlots: 56937,
  docks: 36,
  featured: true,
  badge: 'Canlı Vitrin',
  sceneId: 'bursa',
}

interface SiteAssignmentRow extends RowDataPacket {
  id: number
  public_id: string
  name: string
  scene_id: string | null
  storage_slots: number | null
  footprint_m2: number | null
}

async function resolveUserAllowedSites(userId: string): Promise<typeof BURSA_DEFAULT_SITE[]> {
  try {
    if (!authAvailable()) return [BURSA_DEFAULT_SITE]

    const rows = await query<SiteAssignmentRow>(
      `SELECT s.id, s.public_id, s.name, s.scene_id, s.storage_slots, s.footprint_m2
         FROM assignments a
         JOIN sites s ON s.id = a.site_id
         JOIN users u ON u.id = a.user_id
        WHERE u.public_id = ?
          AND s.status <> 'archived'`,
      [userId],
    )

    if (rows.length === 0) return [BURSA_DEFAULT_SITE]

    return rows.map((r) => ({
      id: r.public_id,
      name: r.name,
      location: r.name.includes('Bursa') ? 'Bursa, Nilüfer' : 'Türkiye',
      areaM2: r.footprint_m2 ?? 24500,
      palletSlots: r.storage_slots ?? 56937,
      docks: 36,
      featured: r.name.includes('Bursa'),
      badge: 'Aktif Tesis',
      sceneId: r.scene_id || 'bursa',
    }))
  } catch {
    return [BURSA_DEFAULT_SITE]
  }
}

export async function POST(request: NextRequest) {
  let token: string | undefined
  try {
    const body = (await request.json().catch(() => ({}))) as { token?: string }
    token = body.token
  } catch {
    // Body optional if session cookie is sent
  }

  let user: { id: string; email: string; name?: string; role: 'admin' | 'editor' | 'viewer' } | null = null

  // 1. Verify via signed launch token
  if (token) {
    const payload = verifyViewerLaunchToken(token)
    if (payload) {
      user = {
        id: payload.userId,
        email: payload.email,
        name: payload.name || payload.email.split('@')[0],
        role: payload.role,
      }
    }
  }

  // 2. Fallback to session cookie
  if (!user && authAvailable()) {
    const sessionUser = await getSessionUser()
    if (sessionUser) {
      user = {
        id: sessionUser.id,
        email: sessionUser.email,
        name: sessionUser.email.split('@')[0],
        role: sessionUser.role,
      }
    }
  }

  if (!user) {
    const res = NextResponse.json(
      { ok: false, error: 'unauthorized', message: 'Geçersiz veya süresi dolmuş oturum.' },
      { status: 401 },
    )
    return withViewerCors(request, res)
  }

  const allowedSites = await resolveUserAllowedSites(user.id)
  const defaultSite = allowedSites[0]?.id || 'site_bursa'

  const res = NextResponse.json({
    ok: true,
    user,
    allowedSites,
    defaultSite,
  })

  return withViewerCors(request, res)
}
