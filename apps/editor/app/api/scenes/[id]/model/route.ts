import { type NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

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
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range')
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

function resolveModelFilePath(id: string): string | null {
  const candidates: string[] = []

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
    candidates.push(path.join(base, 'public/assets/model', `model_${id}.glb`))
    candidates.push(path.join(base, 'assets/model', `model_${id}.glb`))
    if (isBursa) {
      candidates.push(path.join(base, 'public/assets/model', 'model_2026-09-22.glb'))
      candidates.push(path.join(base, 'assets/model', 'model_2026-09-22.glb'))
    }
  }

  // Fallback to latest standard active model if exact scene file not present
  for (const base of searchBases) {
    candidates.push(path.join(base, 'public/assets/model', 'model_2026-09-22.glb'))
    candidates.push(path.join(base, 'assets/model', 'model_2026-09-22.glb'))
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const stat = fs.statSync(p)
        if (stat.isFile() && stat.size > 0) return p
      } catch {}
    }
  }

  return null
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const filePath = resolveModelFilePath(id)

  if (!filePath) {
    const res = NextResponse.json({ error: 'Model GLB not found', id }, { status: 404 })
    return withViewerCors(request, res)
  }

  try {
    const stat = fs.statSync(filePath)
    const fileStream = fs.createReadStream(filePath)
    
    // Convert Node ReadStream to Web ReadableStream
    const readable = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk))
        fileStream.on('end', () => controller.close())
        fileStream.on('error', (err) => controller.error(err))
      },
      cancel() {
        fileStream.destroy()
      },
    })

    const headers = new Headers({
      'Content-Type': 'model/gltf-binary',
      'Content-Length': stat.size.toString(),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    })

    const res = new NextResponse(readable, { status: 200, headers })
    return withViewerCors(request, res)
  } catch (err) {
    console.error(`Failed to stream GLB model for scene ${id}:`, err)
    const res = NextResponse.json({ error: 'Failed to stream model' }, { status: 500 })
    return withViewerCors(request, res)
  }
}
