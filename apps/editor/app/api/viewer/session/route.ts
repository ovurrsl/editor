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
  id: '01JM1SITE00000000000000002',
  name: 'Nestlé & Netlog Bursa Başköy',
  location: 'Bursa, Nilüfer',
  areaM2: 24500,
  palletSlots: 56937,
  docks: 36,
  featured: true,
  badge: 'Canlı Vitrin',
  sceneId: 'bursa_baskoy',
}

interface SiteAssignmentRow extends RowDataPacket {
  id: number
  public_id: string
  name: string
  scene_id: string | null
  storage_slots: number | null
  footprint_m2: number | null
}

async function resolveUserAllowedSites(
  userId: string,
  role?: string,
): Promise<Array<typeof BURSA_DEFAULT_SITE>> {
  try {
    if (!authAvailable()) return [BURSA_DEFAULT_SITE]

    let rows: SiteAssignmentRow[] = []

    if (role === 'admin') {
      rows = await query<SiteAssignmentRow>(
        `SELECT s.id, s.public_id, s.name, s.scene_id, s.storage_slots, s.footprint_m2
           FROM sites s
          WHERE s.status <> 'archived'
          ORDER BY s.name ASC`,
      )
    } else {
      rows = await query<SiteAssignmentRow>(
        `SELECT s.id, s.public_id, s.name, s.scene_id, s.storage_slots, s.footprint_m2
           FROM assignments a
           JOIN sites s ON s.id = a.site_id
           JOIN users u ON u.id = a.user_id
          WHERE u.public_id = ?
            AND s.status <> 'archived'
          ORDER BY s.name ASC`,
        [userId],
      )
    }

    const sites: Array<typeof BURSA_DEFAULT_SITE> = rows.map((r) => ({
      id: r.public_id,
      name: r.name,
      location: r.name.toLowerCase().includes('bursa')
        ? 'Bursa, Nilüfer'
        : r.name.toLowerCase().includes('sakarya')
          ? 'Sakarya, Arifiye'
          : 'Türkiye',
      areaM2: r.footprint_m2 ?? 24500,
      palletSlots: r.storage_slots ?? 56937,
      docks: 36,
      featured: r.name.toLowerCase().includes('bursa'),
      badge: 'Aktif Tesis',
      sceneId: r.scene_id || r.public_id,
    }))

    // Also include scenes shared with this user in scene_shares
    try {
      const sharedScenes = await query<RowDataPacket & { id: string; name: string }>(
        `SELECT s.id, s.name
           FROM scene_shares ss
           JOIN scenes s ON s.id = ss.scene_id
          WHERE ss.user_id = ?`,
        [userId],
      )
      for (const sc of sharedScenes) {
        if (!sites.some((st) => st.sceneId === sc.id || st.id === sc.id)) {
          sites.push({
            id: sc.id,
            name: sc.name || 'Paylaşılan 3D Sahne',
            location: 'Dijital İkiz',
            areaM2: 20000,
            palletSlots: 30000,
            docks: 20,
            featured: false,
            badge: 'Paylaşılan Sahne',
            sceneId: sc.id,
          })
        }
      }
    } catch {
      // scene_shares or scenes table may not exist in all deployments, safe to skip
    }

    // Ensure Bursa Başköy is always available for valid viewers/users
    if (sites.length === 0 || !sites.some((s) => s.id === '01JM1SITE00000000000000002' || s.name.toLowerCase().includes('bursa'))) {
      sites.unshift(BURSA_DEFAULT_SITE)
    }

    return sites
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

  const allowedSites = await resolveUserAllowedSites(user.id, user.role)
  const defaultSite = allowedSites[0]?.id || null

  const res = NextResponse.json({
    ok: true,
    user,
    allowedSites,
    defaultSite,
  })

  return withViewerCors(request, res)
}
