import { type NextRequest, NextResponse } from 'next/server'
import { existsSync, mkdirSync, writeFileSync, statSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

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
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    }
  }
  return response
}

export function OPTIONS(request: NextRequest) {
  const res = new NextResponse(null, { status: 204 })
  return withViewerCors(request, res)
}

function resolveAssetDirectories() {
  const cwd = process.cwd()
  const editorPublic = cwd.endsWith('editor') || cwd.includes('apps')
    ? (existsSync(join(cwd, 'public/assets')) ? join(cwd, 'public/assets') : join(cwd, 'apps/editor/public/assets'))
    : join(cwd, 'apps/editor/public/assets')

  const viewerPublic = 'E:/Digital Twin/Viewer/public/assets'

  return {
    editorModelDirs: [
      join(editorPublic, 'model'),
      join(cwd, 'public/assets/model'),
    ].filter((p, i, arr) => arr.indexOf(p) === i),
    editorDataDirs: [
      join(editorPublic, 'data'),
      join(cwd, 'public/assets/data'),
    ].filter((p, i, arr) => arr.indexOf(p) === i),
    viewerModelDir: existsSync(viewerPublic) ? join(viewerPublic, 'model') : null,
    viewerDataDir: existsSync(viewerPublic) ? join(viewerPublic, 'data') : null,
  }
}

/**
 * Cleans up stale, outdated, duplicate, or temporary GLB and layout files
 * when a new update arrives, ensuring disk space is maintained and obsolete versions are pruned.
 */
function cleanOldSceneAssets(sceneId: string, dirs: ReturnType<typeof resolveAssetDirectories>) {
  const allModelDirs = [...dirs.editorModelDirs, dirs.viewerModelDir].filter(Boolean) as string[]
  const allDataDirs = [...dirs.editorDataDirs, dirs.viewerDataDir].filter(Boolean) as string[]

  const cleanedFiles: string[] = []

  // 1. Purge stale GLBs
  for (const dir of allModelDirs) {
    if (!existsSync(dir)) continue
    try {
      const files = readdirSync(dir)
      for (const file of files) {
        // Match old numbered variants (e.g. model_xxx (1).glb), temporary files (model_xxx.tmp), or dated variants
        const isMatchingScene = file.startsWith(`model_${sceneId}`)
        const isCanonical = file === `model_${sceneId}.glb`

        if (isMatchingScene && !isCanonical) {
          const filePath = join(dir, file)
          try {
            unlinkSync(filePath)
            cleanedFiles.push(filePath)
            console.log(`[assets-api] 🧹 Cleaned up obsolete model file: ${filePath}`)
          } catch (e) {
            console.warn(`[assets-api] Failed to delete old model file ${file}:`, e)
          }
        }

        // Deprecated historical versions for Bursa (preserve only active model_2026-09-11.glb)
        const isBursa = sceneId === 'bursa_baskoy' || sceneId === '01JM1SITE00000000000000002' || sceneId === 'bursa'
        if (isBursa) {
          const deprecatedBursaModels = [
            'model_2026-09-08.glb',
            'model_2026-09-09.glb',
            'model_2026-09-10 (1).glb',
            'model_2026-09-10.glb',
          ]
          if (deprecatedBursaModels.includes(file)) {
            const filePath = join(dir, file)
            try {
              unlinkSync(filePath)
              cleanedFiles.push(filePath)
              console.log(`[assets-api] 🧹 Cleaned up deprecated Bursa model: ${filePath}`)
            } catch (e) {
              console.warn(`[assets-api] Failed to delete deprecated Bursa model ${file}:`, e)
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[assets-api] Error reading model directory ${dir} for cleanup:`, err)
    }
  }

  // 2. Purge stale Layout JSONs
  for (const dir of allDataDirs) {
    if (!existsSync(dir)) continue
    try {
      const files = readdirSync(dir)
      for (const file of files) {
        const isMatchingScene = file.startsWith(`layout_${sceneId}`)
        const isCanonical = file === `layout_${sceneId}.json`

        if (isMatchingScene && !isCanonical) {
          const filePath = join(dir, file)
          try {
            unlinkSync(filePath)
            cleanedFiles.push(filePath)
            console.log(`[assets-api] 🧹 Cleaned up obsolete layout file: ${filePath}`)
          } catch (e) {
            console.warn(`[assets-api] Failed to delete old layout file ${file}:`, e)
          }
        }

        const isBursa = sceneId === 'bursa_baskoy' || sceneId === '01JM1SITE00000000000000002' || sceneId === 'bursa'
        if (isBursa) {
          const deprecatedBursaLayouts = [
            'layout_2026-09-08.json',
            'layout_2026-09-09.json',
            'layout_2026-09-10 (1).json',
            'layout_2026-09-10.json',
          ]
          if (deprecatedBursaLayouts.includes(file)) {
            const filePath = join(dir, file)
            try {
              unlinkSync(filePath)
              cleanedFiles.push(filePath)
              console.log(`[assets-api] 🧹 Cleaned up deprecated Bursa layout: ${filePath}`)
            } catch (e) {
              console.warn(`[assets-api] Failed to delete deprecated Bursa layout ${file}:`, e)
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[assets-api] Error reading data directory ${dir} for cleanup:`, err)
    }
  }

  return cleanedFiles
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const { editorModelDirs, editorDataDirs } = resolveAssetDirectories()

  let glbFound = false
  let glbSize = 0
  let glbModified: Date | null = null

  for (const dir of editorModelDirs) {
    const glbPath = join(dir, `model_${id}.glb`)
    if (existsSync(glbPath)) {
      glbFound = true
      try {
        const s = statSync(glbPath)
        glbSize = s.size
        glbModified = s.mtime
      } catch {}
      break
    }
  }

  let layoutFound = false
  let layoutSize = 0
  for (const dir of editorDataDirs) {
    const layoutPath = join(dir, `layout_${id}.json`)
    if (existsSync(layoutPath)) {
      layoutFound = true
      try {
        layoutSize = statSync(layoutPath).size
      } catch {}
      break
    }
  }

  const v = glbModified ? glbModified.getTime() : Date.now()
  const res = NextResponse.json({
    ok: true,
    sceneId: id,
    hasGlb: glbFound,
    hasLayout: layoutFound,
    glbSize,
    layoutSize,
    modelUrl: glbFound ? `/assets/model/model_${id}.glb?v=${v}` : null,
    layoutUrl: layoutFound ? `/assets/data/layout_${id}.json?v=${v}` : null,
    lastModified: glbModified?.toISOString() ?? null,
  })

  return withViewerCors(request, res)
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const dirs = resolveAssetDirectories()

  // Ensure directories exist
  for (const dir of dirs.editorModelDirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  for (const dir of dirs.editorDataDirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  if (dirs.viewerModelDir && !existsSync(dirs.viewerModelDir)) {
    mkdirSync(dirs.viewerModelDir, { recursive: true })
  }
  if (dirs.viewerDataDir && !existsSync(dirs.viewerDataDir)) {
    mkdirSync(dirs.viewerDataDir, { recursive: true })
  }

  let glbBuffer: Buffer | null = null
  let layoutContent: string | null = null

  const contentType = request.headers.get('content-type') || ''

  try {
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const glbEntry = formData.get('glb')
      if (glbEntry instanceof Blob) {
        const arrayBuf = await glbEntry.arrayBuffer()
        glbBuffer = Buffer.from(arrayBuf)
      }
      const layoutEntry = formData.get('layout')
      if (typeof layoutEntry === 'string') {
        layoutContent = layoutEntry
      } else if (layoutEntry instanceof Blob) {
        layoutContent = await layoutEntry.text()
      }
    } else if (contentType.includes('application/json')) {
      const json = await request.json()
      if (json.glbBase64 && typeof json.glbBase64 === 'string') {
        glbBuffer = Buffer.from(json.glbBase64, 'base64')
      }
      if (json.layout) {
        layoutContent = typeof json.layout === 'string' ? json.layout : JSON.stringify(json.layout, null, 2)
      }
    } else if (contentType.includes('model/gltf-binary') || contentType.includes('application/octet-stream')) {
      const arrayBuf = await request.arrayBuffer()
      glbBuffer = Buffer.from(arrayBuf)
    }
  } catch (err) {
    console.error('[assets-api] Error reading asset payload:', err)
    const errRes = NextResponse.json({ error: 'invalid_payload', details: String(err) }, { status: 400 })
    return withViewerCors(request, errRes)
  }

  let glbBytesWritten = 0
  let layoutBytesWritten = 0

  if (glbBuffer && glbBuffer.length > 0) {
    for (const dir of dirs.editorModelDirs) {
      const targetPath = join(dir, `model_${id}.glb`)
      writeFileSync(targetPath, glbBuffer)
      glbBytesWritten = glbBuffer.length
    }
    if (dirs.viewerModelDir) {
      try {
        writeFileSync(join(dirs.viewerModelDir, `model_${id}.glb`), glbBuffer)
      } catch (e) {
        console.warn('[assets-api] Failed to mirror GLB to Viewer directory:', e)
      }
    }
  }

  if (layoutContent && layoutContent.length > 0) {
    for (const dir of dirs.editorDataDirs) {
      const targetPath = join(dir, `layout_${id}.json`)
      writeFileSync(targetPath, layoutContent, 'utf8')
      layoutBytesWritten = layoutContent.length
    }
    if (dirs.viewerDataDir) {
      try {
        writeFileSync(join(dirs.viewerDataDir, `layout_${id}.json`), layoutContent, 'utf8')
      } catch (e) {
        console.warn('[assets-api] Failed to mirror layout JSON to Viewer directory:', e)
      }
    }
  }

  // Automatically clean up old stale versions and temporary files
  const cleanedFiles = cleanOldSceneAssets(id, dirs)

  const v = Date.now()
  const response = NextResponse.json({
    ok: true,
    sceneId: id,
    glbBytesWritten,
    layoutBytesWritten,
    cleanedFilesCount: cleanedFiles.length,
    modelUrl: glbBytesWritten > 0 ? `/assets/model/model_${id}.glb?v=${v}` : null,
    layoutUrl: layoutBytesWritten > 0 ? `/assets/data/layout_${id}.json?v=${v}` : null,
    syncedAt: new Date().toISOString(),
  })

  return withViewerCors(request, response)
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const dirs = resolveAssetDirectories()
  const allModelDirs = [...dirs.editorModelDirs, dirs.viewerModelDir].filter(Boolean) as string[]
  const allDataDirs = [...dirs.editorDataDirs, dirs.viewerDataDir].filter(Boolean) as string[]

  let deletedCount = 0

  for (const dir of allModelDirs) {
    const glbPath = join(dir, `model_${id}.glb`)
    if (existsSync(glbPath)) {
      try {
        unlinkSync(glbPath)
        deletedCount++
      } catch {}
    }
  }

  for (const dir of allDataDirs) {
    const layoutPath = join(dir, `layout_${id}.json`)
    if (existsSync(layoutPath)) {
      try {
        unlinkSync(layoutPath)
        deletedCount++
      } catch {}
    }
  }

  const cleaned = cleanOldSceneAssets(id, dirs)
  deletedCount += cleaned.length

  const res = NextResponse.json({ ok: true, sceneId: id, deletedCount })
  return withViewerCors(request, res)
}
