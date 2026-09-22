import { type NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
      modelUrl: 'assets/model/model_2026-09-11.glb',
      layoutUrl: 'assets/data/layout_2026-09-11.json',
      planCadUrl: 'assets/data/plan_cad.json',
    },
    events: {
      url: '/api/scenes/bursa_baskoy/events',
      sceneId: 'bursa_baskoy',
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

  // Load from scene store, Bursa candidate files, or resolve through sites table
  try {
    const operations = await getSceneOperations()
    let stored = await operations.loadStoredScene(id)
    let siteName = ''

    const decodedId = decodeURIComponent(id).trim().toLowerCase()
    const isExplicitBursa =
      decodedId === 'bursa' ||
      decodedId === 'site_bursa' ||
      decodedId === 'bursa_baskoy' ||
      decodedId === '01jm1site00000000000000002' ||
      decodedId === 'default'

    if (!stored && isExplicitBursa) {
      const candidatePaths = [
        join(process.cwd(), 'apps/editor/public/assets/data/layout_bursa.json'),
        join(process.cwd(), 'public/assets/data/layout_bursa.json'),
        join(process.cwd(), 'public/assets/data/layout_2026-09-11.json'),
        'E:/Digital Twin/editor/apps/editor/public/assets/data/layout_bursa.json',
        'E:/Digital Twin/Viewer/public/assets/data/layout_2026-09-11.json',
      ]
      for (const p of candidatePaths) {
        if (existsSync(p)) {
          try {
            const raw = JSON.parse(readFileSync(p, 'utf8'))
            const nodes = raw.nodes || raw.graph?.nodes || raw
            stored = {
              id: '01JM1SITE00000000000000002',
              name: 'BURSA BAŞKÖY EXT',
              version: 1,
              nodeCount: Object.keys(nodes).length,
              graph: { nodes },
            } as any
            siteName = 'BURSA BAŞKÖY EXT'
            break
          } catch {}
        }
      }
    }

    if (!stored) {
      try {
        const all = await operations.listScenes({ limit: 100 })
        const match = all.find(
          (s) =>
            s.id.toLowerCase() === decodedId ||
            s.name.toLowerCase() === decodedId ||
            s.name.toLowerCase().includes(decodedId) ||
            decodedId.includes(s.name.toLowerCase()),
        )
        if (match) {
          stored = await operations.loadStoredScene(match.id)
        }
      } catch {}
    }

    if (!stored) {
      try {
        const siteRows = await query<RowDataPacket & { scene_id: string | null; name: string }>(
          'SELECT scene_id, name FROM sites WHERE public_id = ? OR name = ? OR LOWER(name) = ? LIMIT 1',
          [id, id, id.toLowerCase()],
        )
        const firstSite = siteRows[0]
        if (firstSite) {
          siteName = firstSite.name
          if (firstSite.scene_id) {
            stored = await operations.loadStoredScene(firstSite.scene_id)
            if (!stored && (firstSite.scene_id === 'bursa_baskoy' || firstSite.name.toLowerCase().includes('bursa'))) {
              const candidatePaths = [
                join(process.cwd(), 'apps/editor/public/assets/data/layout_bursa.json'),
                join(process.cwd(), 'public/assets/data/layout_bursa.json'),
                join(process.cwd(), 'public/assets/data/layout_2026-09-11.json'),
                'E:/Digital Twin/editor/apps/editor/public/assets/data/layout_bursa.json',
                'E:/Digital Twin/Viewer/public/assets/data/layout_2026-09-11.json',
              ]
              for (const p of candidatePaths) {
                if (existsSync(p)) {
                  try {
                    const raw = JSON.parse(readFileSync(p, 'utf8'))
                    const nodes = raw.nodes || raw.graph?.nodes || raw
                    stored = {
                      id: firstSite.scene_id,
                      name: firstSite.name,
                      version: 1,
                      nodeCount: Object.keys(nodes).length,
                      graph: { nodes },
                    } as any
                    break
                  } catch {}
                }
              }
            }
          }
        }
      } catch {
        // Fall back gracefully if sites table query fails
      }
    }

    if (!stored) {
      const candidatePaths = [
        join(process.cwd(), `apps/editor/public/assets/data/layout_${decodedId}.json`),
        join(process.cwd(), `public/assets/data/layout_${decodedId}.json`),
        `E:/Digital Twin/editor/apps/editor/public/assets/data/layout_${decodedId}.json`,
        `E:/Digital Twin/Viewer/public/assets/data/layout_${decodedId}.json`,
      ]
      for (const p of candidatePaths) {
        if (existsSync(p)) {
          try {
            const raw = JSON.parse(readFileSync(p, 'utf8'))
            const nodes = raw.nodes || raw.graph?.nodes || raw
            const inferredName = decodedId === '6507e9525168' ? 'BEYAZ KAĞIT A.Ş.' : (raw.name || decodedId)
            stored = {
              id: decodedId,
              name: inferredName,
              version: 1,
              nodeCount: Object.keys(nodes).length,
              graph: { nodes },
            } as any
            siteName = inferredName
            break
          } catch {}
        }
      }
    }

    if (!stored && !siteName) {
      const isExplicitBursa =
        decodedId === 'bursa' ||
        decodedId === 'site_bursa' ||
        decodedId === 'bursa_baskoy' ||
        decodedId === '01JM1SITE00000000000000002' ||
        decodedId === 'default'

      if (!isExplicitBursa) {
        const candidateModelPaths = [
          join(process.cwd(), `apps/editor/public/assets/model/model_${decodedId}.glb`),
          join(process.cwd(), `public/assets/model/model_${decodedId}.glb`),
          `E:/Digital Twin/editor/apps/editor/public/assets/model/model_${decodedId}.glb`,
          `E:/Digital Twin/Viewer/public/assets/model/model_${decodedId}.glb`,
        ]
        const hasModel = candidateModelPaths.some((p) => existsSync(p))

        const emptyManifest = {
          version: '1.0',
          site: {
            id: decodedId,
            name: decodedId === '6507e9525168' ? 'BEYAZ KAĞIT A.Ş.' : (decodedId.length > 25 ? 'Lojistik Depo' : decodedId),
            description: hasModel
              ? 'Lojistik Depo 3D Dijital İkiz Modeli.'
              : 'Bu projede henüz yerleşim çizilmemiştir. Editör üzerinden raf ve duvar ekleyebilirsiniz.',
            city: 'Türkiye',
            country: 'TR',
          },
          assets: {
            modelUrl: hasModel ? `assets/model/model_${decodedId}.glb` : null,
            layoutUrl: `assets/data/layout_${decodedId}.json`,
            planCadUrl: null,
          },
          events: {
            url: `/api/scenes/${encodeURIComponent(decodedId)}/events`,
            sceneId: decodedId,
          },
          layoutData: { nodes: {} },
          building: {
            id: `building_${decodedId}`,
            bounds: { min: [-50, 0, -30], max: [50, 12, 30] },
          },
          zones: [],
          metrics: {
            totalRacks: 0,
            totalPalletSlots: 0,
            totalAreaM2: 0,
            clearHeightM: 12.0,
            docksCount: 0,
          },
          isEmpty: true,
        }
        const res = NextResponse.json(emptyManifest)
        return withViewerCors(request, res)
      }

      const res = NextResponse.json(BURSA_MANIFEST)
      return withViewerCors(request, res)
    }

    const resolvedSceneId = stored?.id || id
    const nodes = (stored?.graph?.nodes || {}) as Record<string, any>
    const allNodes = Object.values(nodes)

    // 1. Dynamic building detection & bounds calculation
    const buildingNode = allNodes.find((n) => n.type === 'building')
    let minX = Infinity, minY = 0, minZ = Infinity
    let maxX = -Infinity, maxY = 14, maxZ = -Infinity

    for (const n of allNodes) {
      if (Array.isArray(n.position)) {
        const [x, y, z] = n.position
        if (typeof x === 'number' && typeof z === 'number') {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (z < minZ) minZ = z
          if (z > maxZ) maxZ = z
          if (typeof y === 'number' && y > maxY) maxY = y
        }
      }
      if (Array.isArray(n.start) && Array.isArray(n.end)) {
        const [x1, z1] = n.start
        const [x2, z2] = n.end
        if (x1 < minX) minX = x1
        if (x1 > maxX) maxX = x1
        if (x2 < minX) minX = x2
        if (x2 > maxX) maxX = x2
        if (z1 < minZ) minZ = z1
        if (z1 > maxZ) maxZ = z1
        if (z2 < minZ) minZ = z2
        if (z2 > maxZ) maxZ = z2
        if (typeof n.height === 'number' && n.height > maxY) maxY = n.height
      }
      if (Array.isArray(n.polygon)) {
        for (const pt of n.polygon) {
          if (Array.isArray(pt)) {
            const [px, pz] = pt
            if (px < minX) minX = px
            if (px > maxX) maxX = px
            if (pz < minZ) minZ = pz
            if (pz > maxZ) maxZ = pz
          }
        }
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX === maxX) {
      minX = -60; maxX = 60; minZ = -40; maxZ = 40; maxY = 14;
    }

    const buildingBounds = {
      min: [Number((minX - 5).toFixed(2)), 0, Number((minZ - 5).toFixed(2))],
      max: [Number((maxX + 5).toFixed(2)), Number((maxY + 2).toFixed(2)), Number((maxZ + 5).toFixed(2))],
    }

    // 2. Dynamic metrics calculation
    let totalRacks = 0
    let totalPalletSlots = 0
    let docksCount = 0

    for (const n of allNodes) {
      const isRack = n.type === 'warehouse:pallet-rack' || (n.type === 'item' && String(n.name || '').toLowerCase().includes('rack'))
      if (isRack) {
        totalRacks++
        const levels = Number(n.levels || 5)
        const depthPositions = Number(n.depthPositions || 1)
        const bayClearWidth = Number(n.bayClearWidth || 2.73)
        const alongRun = 0.8
        const toUpright = Number(n.clearanceToUpright || 0.075)
        const between = Number(n.clearanceBetweenPallets || 0.075)
        const usable = bayClearWidth - 2 * toUpright + between
        const step = alongRun + between
        const autoPalletsPerLevel = Math.max(0, Math.floor(usable / step + 1e-9))
        const palletsPerLevel = Number(n.palletsPerLevel || autoPalletsPerLevel || 3)
        const totalLevels = (n.groundLevelStorage ? 1 : 0) + levels
        totalPalletSlots += totalLevels * palletsPerLevel * depthPositions
      } else if (n.type === 'door' || (n.type === 'item' && String(n.name || '').toLowerCase().includes('dock'))) {
        docksCount++
      }
    }

    const approxAreaM2 = Math.round(Math.max(50, (maxX - minX) * (maxZ - minZ)))
    const clearHeightM = Math.max(8.5, Math.min(18.0, maxY))

    // 3. Dynamic zones extraction
    const zoneNodes = allNodes.filter((n) => n.type === 'zone')
    const dynamicZones = zoneNodes.map((z, idx) => {
      let areaM2 = 1500
      if (Array.isArray(z.polygon) && z.polygon.length >= 3) {
        let sum = 0
        for (let i = 0; i < z.polygon.length; i++) {
          const j = (i + 1) % z.polygon.length
          sum += z.polygon[i][0] * z.polygon[j][1] - z.polygon[j][0] * z.polygon[i][1]
        }
        areaM2 = Math.round(Math.abs(sum) / 2)
      }
      return {
        id: z.id,
        key: `zone_${idx + 1}`,
        name: z.name || `Bölge ${idx + 1}`,
        labelTr: z.name || `Depo Bölgesi ${idx + 1}`,
        labelEn: z.name || `Warehouse Zone ${idx + 1}`,
        areaM2,
        palletCapacity: Math.round(totalPalletSlots / Math.max(1, zoneNodes.length)),
        color: z.color || '#3b82f6',
      }
    })

    const finalName = siteName || stored?.name || 'Lojistik Depo'
    const isSakarya = finalName.toLowerCase().includes('sakarya') || id.toLowerCase().includes('sakarya')
    const hasAnyNodes = allNodes.length > 0

    const description = hasAnyNodes
      ? `${approxAreaM2.toLocaleString('tr-TR')} m² kapalı alan, ${clearHeightM.toFixed(1)} m serbest yükseklik, ${docksCount} rampa ve ${totalPalletSlots.toLocaleString('tr-TR')} palet kapasiteli Dijital İkiz.`
      : 'Bu projede henüz yerleşim çizilmemiştir. Editör üzerinden raf ve duvar ekleyebilirsiniz.'

    const cwd = process.cwd()
    const candidateModelPaths = [
      join(cwd, 'public/assets/model', `model_${resolvedSceneId}.glb`),
      join(cwd, 'apps/editor/public/assets/model', `model_${resolvedSceneId}.glb`),
      `E:/Digital Twin/editor/apps/editor/public/assets/model/model_${resolvedSceneId}.glb`,
      `E:/Digital Twin/Viewer/public/assets/model/model_${resolvedSceneId}.glb`,
    ]
    let hasSceneGlb = false
    for (const p of candidateModelPaths) {
      if (existsSync(p)) {
        hasSceneGlb = true
        break
      }
    }

    const versionParam = stored?.version ? `?v=${stored.version}` : ''
    let resolvedModelUrl: string | null = null
    let resolvedLayoutUrl: string | null = null

    if (isExplicitBursa) {
      resolvedModelUrl = 'assets/model/model_2026-09-11.glb'
      resolvedLayoutUrl = 'assets/data/layout_2026-09-11.json'
    } else if (hasSceneGlb) {
      resolvedModelUrl = `assets/model/model_${resolvedSceneId}.glb${versionParam}`
      resolvedLayoutUrl = `assets/data/layout_${resolvedSceneId}.json${versionParam}`
    } else if (hasAnyNodes) {
      // Scene has nodes, assign standard asset URLs for auto-sync
      resolvedModelUrl = `assets/model/model_${resolvedSceneId}.glb${versionParam}`
      resolvedLayoutUrl = `assets/data/layout_${resolvedSceneId}.json${versionParam}`
    }

    const manifest = {
      version: '1.0',
      site: {
        id: resolvedSceneId,
        name: finalName,
        description,
        city: isSakarya ? 'Sakarya' : 'Türkiye',
        country: 'TR',
      },
      assets: {
        modelUrl: resolvedModelUrl,
        layoutUrl: resolvedLayoutUrl,
        planCadUrl: 'assets/data/plan_cad.json',
      },
      events: {
        url: `/api/scenes/${resolvedSceneId}/events`,
        sceneId: resolvedSceneId,
      },
      layoutData: stored?.graph ?? { nodes: {} },
      building: {
        id: buildingNode?.id || `building_${resolvedSceneId}`,
        bounds: buildingBounds,
      },
      zones: dynamicZones.length > 0 ? dynamicZones : (isExplicitBursa ? BURSA_MANIFEST.zones : []),
      metrics: {
        totalRacks: totalRacks,
        totalPalletSlots: totalPalletSlots,
        totalAreaM2: hasAnyNodes ? approxAreaM2 : 0,
        clearHeightM: hasAnyNodes ? Number(clearHeightM.toFixed(2)) : 0,
        docksCount: docksCount,
      },
      isEmpty: !hasAnyNodes,
    }

    const res = NextResponse.json(manifest)
    return withViewerCors(request, res)
  } catch (err) {
    console.error('[viewer-manifest] Error generating dynamic manifest:', err)
    const isBursa = id === 'bursa' || id === 'site_bursa' || id === 'bursa_baskoy'
    if (isBursa) {
      const res = NextResponse.json(BURSA_MANIFEST)
      return withViewerCors(request, res)
    }
    const emptyFallback = {
      version: '1.0',
      site: {
        id,
        name: 'Lojistik Depo',
        description: 'Bu sahne verisi yüklenirken bir sorun oluştu veya henüz yerleşim çizilmemiştir.',
        city: 'Türkiye',
        country: 'TR',
      },
      assets: { modelUrl: null, layoutUrl: null, planCadUrl: null },
      events: { url: `/api/scenes/${encodeURIComponent(id)}/events`, sceneId: id },
      layoutData: { nodes: {} },
      building: { id: `building_${id}`, bounds: { min: [-50, 0, -30], max: [50, 12, 30] } },
      zones: [],
      metrics: { totalRacks: 0, totalPalletSlots: 0, totalAreaM2: 0, clearHeightM: 12.0, docksCount: 0 },
      isEmpty: true,
    }
    const res = NextResponse.json(emptyFallback)
    return withViewerCors(request, res)
  }
}
