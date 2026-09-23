import { type NextRequest, NextResponse } from 'next/server'
import { authAvailable } from '@/lib/auth/db'
import { getSessionUser } from '@/lib/auth/session'
import { verifyViewerLaunchToken } from '@/lib/auth/viewer-token'
import { query, type RowDataPacket } from '@panel/lib/db'
import { getSceneOperations } from '@/lib/scene-store-server'

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
  badge: 'Canlı Viewer',
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
  const sites: Array<typeof BURSA_DEFAULT_SITE> = []
  const isAdmin = role === 'admin'

  try {
    // 1. Fetch user scenes from store
    try {
      const operations = await getSceneOperations()
      // Admin sees all scenes; non-admin sees only scenes owned or shared
      const scenes = await operations.listScenes(isAdmin ? {} : { viewerId: userId })
      for (const sc of scenes) {
        if (!sc.nodeCount || sc.nodeCount === 0) continue
        const isBursa = sc.name.toLowerCase().includes('bursa') || sc.id.toLowerCase().includes('bursa')
        const isSakarya = sc.name.toLowerCase().includes('sakarya') || sc.id.toLowerCase().includes('sakarya')
        sites.push({
          id: sc.id,
          name: sc.name,
          location: isBursa
            ? 'Bursa, Nilüfer'
            : isSakarya
              ? 'Sakarya, Arifiye'
              : 'Türkiye',
          areaM2: Math.max(5000, sc.nodeCount * 35),
          palletSlots: Math.max(1200, sc.nodeCount * 25),
          docks: Math.max(8, Math.min(40, Math.floor(sc.nodeCount / 20))),
          featured: isBursa || isSakarya,
          badge: 'Aktif Tesis',
          sceneId: sc.id,
        })
      }
    } catch {}

    // 2. If MySQL auth is available, merge assigned sites from database
    if (authAvailable()) {
      try {
        let rows: SiteAssignmentRow[] = []
        if (isAdmin) {
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

        for (const r of rows) {
          const targetScene = r.scene_id || r.public_id
          if (!sites.some((s) => s.id === r.public_id || s.sceneId === targetScene)) {
            sites.push({
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
              sceneId: targetScene,
            })
          }
        }
      } catch {}
    }

    // Only ensure Bursa default site for admins if not already present
    if (isAdmin && !sites.some((s) => s.id === BURSA_DEFAULT_SITE.id || s.name.toLowerCase().includes('bursa'))) {
      sites.unshift(BURSA_DEFAULT_SITE)
    }

    return sites
  } catch {
    return isAdmin ? [BURSA_DEFAULT_SITE] : []
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
