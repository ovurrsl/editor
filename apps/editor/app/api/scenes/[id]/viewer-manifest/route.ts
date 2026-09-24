import { type NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
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
        polygon: [
          [-108.0, -55.0],
          [-135.84, -55.0],
          [-135.8, 64.3],
          [-108.0, 64.3],
        ],
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
        polygon: [
          [-108.0, -55.0],
          [-108.0, 64.3],
          [-94.4664, 64.3],
          [-94.4664, -55.0],
        ],
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
        polygon: [
          [-94.4664, -55.0],
          [-94.4664, 64.3],
          [-47.8, 64.3],
          [-47.8, 41.55],
          [6.0, 41.59],
          [6.05, -55.0],
        ],
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
        polygon: [
          [6.0, -55.0],
          [6.0, 41.59],
          [17.25, 41.6],
          [17.2, 18.9],
          [119.8, 18.9],
          [119.76, -55.0],
        ],
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
        polygon: [
          [-146.1, -83.8],
          [-146.1, -78.7],
          [-141.12, -78.59],
          [-128.5, -91.71],
          [-138.3, -91.6],
        ],
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

function resolveStaticLayoutFile(id: string): string | null {
  const searchBases = [
    process.cwd(),
    path.join(process.cwd(), 'apps/editor'),
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'apps/editor/public'),
  ]

  for (const base of searchBases) {
    const specific = path.join(base, 'public/assets/data', `layout_${id}.json`)
    if (fs.existsSync(specific)) return specific
    const specificAlt = path.join(base, 'assets/data', `layout_${id}.json`)
    if (fs.existsSync(specificAlt)) return specificAlt
  }

  return null
}

function calculatePolygonArea(poly: [number, number][]): number {
  if (!Array.isArray(poly) || poly.length < 3) return 0
  let area = 0
  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i]
    const next = poly[(i + 1) % poly.length]
    if (!curr || !next) continue
    const [x1, y1] = curr
    const [x2, y2] = next
    area += x1 * y2 - x2 * y1
  }
  return Math.round(Math.abs(area) / 2)
}

function isPointInPolygon(pt: [number, number], vs: [number, number][]): boolean {
  const x = pt[0], y = pt[1]
  let inside = false
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const vi = vs[i]
    const vj = vs[j]
    if (!vi || !vj) continue
    const [xi, yi] = vi
    const [xj, yj] = vj
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

  // Otherwise, load from scene store, sites table, or static layout file
  try {
    let stored: any = null
    let siteName = ''

    try {
      const operations = await getSceneOperations()
      stored = await operations.loadStoredScene(id)

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
    } catch (err) {
      console.warn(`Could not load scene ${id} from database store:`, err)
    }

    // Static file fallback if not in database
    if (!stored) {
      const staticFile = resolveStaticLayoutFile(id)
      if (staticFile) {
        try {
          const raw = JSON.parse(fs.readFileSync(staticFile, 'utf-8'))
          stored = {
            id,
            name: raw.name || (id === '6c5728d1aed7' ? 'Güzeller Depo' : `Depo ${id}`),
            graph: {
              nodes: raw.nodes || {},
              rootNodeIds: raw.rootNodeIds || [],
              installedPlugins: raw.installedPlugins || [],
            },
          }
          siteName = stored.name
        } catch (e) {
          console.warn(`Could not parse static layout for manifest ${id}:`, e)
        }
      }
    }

    if (!stored && !siteName) {
      const res = NextResponse.json(BURSA_MANIFEST) // Graceful fallback
      return withViewerCors(request, res)
    }

    // Extract dynamic zones, metrics, and bounds from stored scene graph if available
    let dynamicZones: any[] = []
    let dynamicMetrics = {
      totalRacks: 0,
      totalPalletSlots: 0,
      totalAreaM2: 0,
      clearHeightM: 12.0,
      docksCount: 0,
    }
    let dynamicBounds = {
      min: [-50, 0, -50],
      max: [50, 12, 50],
    }

    if (stored?.graph?.nodes) {
      const allNodes = Object.values(stored.graph.nodes) as any[]
      const zoneNodes = allNodes.filter((n) => (n.type === 'zone' || n.kind === 'zone') && Array.isArray(n.polygon) && n.polygon.length >= 3)
      if (zoneNodes.length > 0) {
        dynamicZones = zoneNodes.map((z, idx) => {
          const poly = z.polygon as [number, number][]
          const computedArea = calculatePolygonArea(poly)
          let zonePallets = z.metadata?.palletSlots || 0
          if (!zonePallets) {
            const racksInZone = allNodes.filter(
              (n) =>
                ((n.kind || n.type || '').toLowerCase().includes('rack') || (n.name || '').toLowerCase().includes('rack')) &&
                Array.isArray(n.position) &&
                isPointInPolygon([n.position[0], n.position[2]], poly)
            ).length
            zonePallets = racksInZone > 0 ? racksInZone * 15 : 0
          }
          return {
            id: z.id || `zone_${idx}`,
            key: z.name?.toLowerCase().replace(/\s+/g, '_') || `zone_${idx}`,
            name: z.name || `Bölge ${idx + 1}`,
            labelTr: z.name || `Bölge ${idx + 1}`,
            labelEn: z.name || `Zone ${idx + 1}`,
            areaM2: z.metadata?.area || computedArea || 0,
            palletCapacity: zonePallets,
            color: z.color || '#3b82f6',
            polygon: z.polygon,
          }
        })
      }

      // Compute rough bounds and node metrics
      let minX = Infinity, minY = Infinity, minZ = Infinity
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
      let rackCount = 0
      let palletSlots = 0
      let doorCount = 0

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
          const levels = Number(n.levels || 5)
          const perLevel = Number(n.palletsPerLevel || 3)
          palletSlots += levels * perLevel
        }
        if (kindLower.includes('door') || nameLower.includes('door')) {
          doorCount++
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
          docksCount: doorCount > 0 ? doorCount : Math.max(4, Math.min(40, Math.floor(allNodes.length / 40))),
        }
      }

      if (dynamicZones.length === 0 && Number.isFinite(minX) && Number.isFinite(maxX)) {
        dynamicZones = [
          {
            id: `zone_${id}_main`,
            key: 'main',
            name: 'Ana Depolama Alanı',
            labelTr: 'Ana Depolama Alanı',
            labelEn: 'Main Storage Area',
            areaM2: dynamicMetrics.totalAreaM2,
            palletCapacity: dynamicMetrics.totalPalletSlots,
            color: '#3b82f6',
            polygon: [
              [Math.floor(minX - 2), Math.floor(minZ - 2)],
              [Math.ceil(maxX + 2), Math.floor(minZ - 2)],
              [Math.ceil(maxX + 2), Math.ceil(maxZ + 2)],
              [Math.floor(minX - 2), Math.ceil(maxZ + 2)],
            ],
          },
        ]
      }
    }

    const resolvedSiteName = siteName || stored?.name || 'Lojistik Depo';
    const isGuzeller = resolvedSiteName.toLowerCase().includes('güzeller') || resolvedSiteName.toLowerCase().includes('guzeller') || id === '6c5728d1aed7';
    const isBursa = resolvedSiteName.toLowerCase().includes('bursa') || id === '01JM1SITE00000000000000002';
    let baseModelUrl = `${origin}/api/scenes/${id}/model`;
    if (isGuzeller && id !== '6c5728d1aed7') {
      baseModelUrl = `${origin}/assets/model/model_6c5728d1aed7.glb`;
    } else if (isBursa && id !== '01JM1SITE00000000000000002') {
      baseModelUrl = `${origin}/assets/model/model_2026-09-22.glb`;
    }
    const manifest = {
      version: '1.0',
      site: {
        id,
        name: resolvedSiteName,
        city: 'Türkiye',
      },
      assets: {
        modelUrl: baseModelUrl,
        racksEmbedded: isBursa,
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
