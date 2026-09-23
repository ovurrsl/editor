import { type NextRequest, NextResponse } from 'next/server'
import { query, type RowDataPacket } from '@panel/lib/db'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

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
      response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    }
  }
  return response
}

export function OPTIONS(request: NextRequest) {
  const res = new NextResponse(null, { status: 204 })
  return withViewerCors(request, res)
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params

  const hostHeader = request.headers.get('x-forwarded-host') || request.headers.get('host')
  const protoHeader = request.headers.get('x-forwarded-proto') || 'http'
  const origin = hostHeader
    ? `${protoHeader}://${hostHeader}`
    : (request.nextUrl?.origin || new URL(request.url).origin)

  // Bursa Default Manifest
  const BURSA_MANIFEST = {
    version: '1.0',
    site: {
      id: 'site_bursa',
      name: 'Nestlé & Netlog Bursa Başköy',
      description: '24.500 m² kapalı alan, 12,50 m serbest yükseklik, 36 hidrolik rampa ve 32.000 palet kapasiteli A Sınıfı Lojistik Depo 3D Dijital İkizi.',
      city: 'Bursa',
      country: 'TR',
    },
    assets: {
      modelUrl: `${origin}/api/scenes/${id}/model`,
      layoutUrl: `${origin}/api/scenes/${id}/layout`,
      planCadUrl: `${origin}/assets/data/plan_cad.json`,
    },
    building: {
      id: 'building_jrk57b7iof7fyzxt',
      bounds: {
        min: [-146.67, 0, -92.14],
        max: [145.31, 17.65, 82.23],
      },
    },
    zones: [
      {
        id: 'zone_2yqil26axagy7yxn',
        key: 'climate',
        name: 'TCA1',
        labelTr: '4. İklimlendirmeli Depo (+15°C / +22°C)',
        labelEn: '4. Climate-Controlled Storage (+15°C / +22°C)',
        areaM2: 2874.1,
        palletCapacity: 7086,
        color: '#06b6d4',
      },
      {
        id: 'zone_zm80l2t21bzxx8t0',
        key: 'climate2',
        name: 'TCA2 (New)',
        labelTr: 'İklimlendirmeli Depo 2 (+15°C / +22°C)',
        labelEn: 'Climate Storage 2 (+15°C / +22°C)',
        areaM2: 1398.0,
        palletCapacity: 4608,
        color: '#a855f7',
      },
      {
        id: 'zone_849h6lrnoe2biitp',
        key: 'dry',
        name: 'Ambient',
        labelTr: '1. Kuru Yük Depolama Alanı (Ambient)',
        labelEn: '1. Dry Storage Area (Ambient)',
        areaM2: 9157.4,
        palletCapacity: 25488,
        color: '#3b82f6',
      },
      {
        id: 'zone_07ewdx8rjcf77xr8',
        key: 'newDry',
        name: 'Ambient Ext',
        labelTr: '2. Kuru Yük İlave Depolama (Ambient Ext)',
        labelEn: '2. Extended Dry Storage (Ambient Ext)',
        areaM2: 6842.6,
        palletCapacity: 19752,
        color: '#84cc16',
      },
      {
        id: 'zone_i6jzu76namlmrd31',
        key: 'assembly',
        name: 'Assembly Point',
        labelTr: '5. Acil Durum Toplanma Alanı',
        labelEn: '5. Emergency Assembly Point',
        areaM2: 450.0,
        palletCapacity: 0,
        color: '#f59e0b',
      },
    ],
    metrics: {
      totalRacks: 2321,
      totalPalletSlots: 56937,
      totalAreaM2: 24500,
      clearHeightM: 12.50,
      docksCount: 36,
    },
  }

  // If Bursa or default requested, return Bursa manifest
  const isBursa =
    id === 'bursa' ||
    id === 'site_bursa' ||
    id === 'bursa_baskoy' ||
    id === '01JM1SITE00000000000000002' ||
    id === '0312b44c083a' ||
    id === 'default'
  if (isBursa) {
    const res = NextResponse.json(BURSA_MANIFEST)
    return withViewerCors(request, res)
  }

  // Otherwise, load from scene store or resolve through sites table
  try {
    const operations = await getSceneOperations()
    let stored = await operations.loadStoredScene(id)
    let siteName = ''

    if (!stored) {
      try {
        const siteRows = await query<RowDataPacket & { scene_id: string | null; name: string }>(
          'SELECT scene_id, name FROM sites WHERE public_id = ? OR name = ? LIMIT 1',
          [id, id],
        )
        const firstSite = siteRows[0]
        if (firstSite) {
          siteName = firstSite.name
          if (firstSite.scene_id) {
            stored = await operations.loadStoredScene(firstSite.scene_id)
          }
        }
      } catch {
        // Fall back gracefully if sites table query fails
      }
    }

    if (!stored && !siteName) {
      const res = NextResponse.json(BURSA_MANIFEST) // Graceful fallback
      return withViewerCors(request, res)
    }

    // Extract dynamic zones, metrics, and bounds from stored scene graph if available
    let dynamicZones = BURSA_MANIFEST.zones
    let dynamicMetrics = BURSA_MANIFEST.metrics
    let dynamicBounds = BURSA_MANIFEST.building.bounds

    if (stored?.graph?.nodes) {
      const allNodes = Object.values(stored.graph.nodes) as any[]
      const zoneNodes = allNodes.filter((n) => (n.type === 'zone' || n.kind === 'zone') && Array.isArray(n.polygon) && n.polygon.length >= 3)
      if (zoneNodes.length > 0) {
        dynamicZones = zoneNodes.map((z, idx) => ({
          id: z.id || `zone_${idx}`,
          key: z.name?.toLowerCase() || `zone_${idx}`,
          name: z.name || `Bölge ${idx + 1}`,
          labelTr: z.name || `Bölge ${idx + 1}`,
          labelEn: z.name || `Zone ${idx + 1}`,
          areaM2: z.metadata?.area || 0,
          palletCapacity: z.metadata?.palletSlots || 0,
          color: z.color || '#3b82f6',
          polygon: z.polygon,
        }))
      }

      // Compute rough bounds and node metrics
      let minX = Infinity, minY = Infinity, minZ = Infinity
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
      let rackCount = 0
      let palletSlots = 0

      for (const n of allNodes) {
        if (n.position && Array.isArray(n.position)) {
          const [x, y, z] = n.position
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (z < minZ) minZ = z
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
          if (z > maxZ) maxZ = z
        }
        const nameLower = (n.name || '').toLowerCase()
        const kindLower = (n.kind || n.type || '').toLowerCase()
        if (kindLower.includes('rack') || nameLower.includes('rack')) {
          rackCount++
          palletSlots += 24 // average slots per bay
        }
      }

      if (Number.isFinite(minX) && Number.isFinite(maxX)) {
        dynamicBounds = {
          min: [Math.floor(minX - 5), 0, Math.floor(minZ - 5)],
          max: [Math.ceil(maxX + 5), Math.max(12, Math.ceil(maxY + 2)), Math.ceil(maxZ + 5)],
        }
      }

      if (rackCount > 0) {
        dynamicMetrics = {
          totalRacks: rackCount,
          totalPalletSlots: palletSlots,
          totalAreaM2: Math.max(2500, Math.round((maxX - minX) * (maxZ - minZ))),
          clearHeightM: 12.50,
          docksCount: Math.max(4, Math.min(40, Math.floor(allNodes.length / 40))),
        }
      }
    }

    const manifest = {
      version: '1.0',
      site: {
        id,
        name: siteName || stored?.name || 'Lojistik Depo',
        city: 'Türkiye',
      },
      assets: {
        modelUrl: `${origin}/api/scenes/${id}/model`,
        layoutUrl: `${origin}/api/scenes/${id}/layout`,
      },
      building: {
        id: `building_${id}`,
        bounds: dynamicBounds,
      },
      zones: dynamicZones,
      metrics: dynamicMetrics,
    }

    const res = NextResponse.json(manifest)
    return withViewerCors(request, res)
  } catch {
    const res = NextResponse.json(BURSA_MANIFEST)
    return withViewerCors(request, res)
  }
}
