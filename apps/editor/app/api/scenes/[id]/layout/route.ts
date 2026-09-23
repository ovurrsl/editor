import { type NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
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
      response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    }
  } else {
    response.headers.set('Access-Control-Allow-Origin', '*')
  }
  return response
}

export function OPTIONS(request: NextRequest) {
  const res = new NextResponse(null, { status: 204 })
  return withViewerCors(request, res)
}

function resolveStaticLayoutFile(id: string): string | null {
  const searchBases = [
    process.cwd(),
    path.join(process.cwd(), 'apps/editor'),
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'apps/editor/public'),
  ]

  const isBursa =
    id === 'bursa' ||
    id === 'site_bursa' ||
    id === 'bursa_baskoy' ||
    id === '01JM1SITE00000000000000002' ||
    id === '0312b44c083a' ||
    id === 'default'

  for (const base of searchBases) {
    const specific = path.join(base, 'public/assets/data', `layout_${id}.json`)
    if (fs.existsSync(specific)) return specific
    const specificAlt = path.join(base, 'assets/data', `layout_${id}.json`)
    if (fs.existsSync(specificAlt)) return specificAlt
  }

  // Fallback to latest standard layout file
  for (const base of searchBases) {
    const def = path.join(base, 'public/assets/data/layout_2026-09-22.json')
    if (fs.existsSync(def)) return def
    const defAlt = path.join(base, 'assets/data/layout_2026-09-22.json')
    if (fs.existsSync(defAlt)) return defAlt
  }

  return null
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params

  // 1. Try to load live scene graph from database store
  try {
    const operations = await getSceneOperations()
    const stored = await operations.loadStoredScene(id)
    if (stored?.graph && Object.keys(stored.graph.nodes || {}).length > 0) {
      const layoutData = {
        id: stored.id,
        name: stored.name,
        nodes: stored.graph.nodes,
        rootNodeIds: stored.graph.rootNodeIds || [],
        installedPlugins: stored.graph.installedPlugins || [],
      }
      const res = NextResponse.json(layoutData, {
        headers: {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
        },
      })
      return withViewerCors(request, res)
    }
  } catch (err) {
    console.warn(`Could not load scene ${id} from database store:`, err)
  }

  // 2. Try static file fallback from assets
  const staticFile = resolveStaticLayoutFile(id)
  if (staticFile) {
    try {
      const raw = fs.readFileSync(staticFile, 'utf8')
      const parsed = JSON.parse(raw)
      const res = NextResponse.json(parsed, {
        headers: {
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        },
      })
      return withViewerCors(request, res)
    } catch (err) {
      console.error(`Failed to read static layout file ${staticFile}:`, err)
    }
  }

  const res = NextResponse.json({ error: 'Layout not found for scene', id }, { status: 404 })
  return withViewerCors(request, res)
}
