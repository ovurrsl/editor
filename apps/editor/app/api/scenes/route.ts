import type { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authAvailable } from '@/lib/auth/db'
import { canEdit, getSessionUser } from '@/lib/auth/session'
import { apiGraphSchema } from '@/lib/graph-schema'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'
import { query, type RowDataPacket } from '@panel/lib/db'

export const dynamic = 'force-dynamic'

const createSceneSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200).nullable().optional(),
  graph: apiGraphSchema,
  thumbnailUrl: z.string().url().nullable().optional(),
})

const listQuerySchema = z.object({
  projectId: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
})

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const url = new URL(request.url)
  const parsed = listQuerySchema.safeParse({
    projectId: url.searchParams.get('projectId') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  // With auth on, a signed-in user sees the scenes they own AND the scenes
  // shared with them; an admin sees all scenes; a signed-out caller sees none.
  let viewerId: string | undefined
  let isAdmin = false
  if (authAvailable()) {
    const user = await getSessionUser()
    if (!user) return sceneApiJson(request, { scenes: [] })
    if (user.role === 'admin') {
      isAdmin = true
      viewerId = undefined
    } else {
      viewerId = user.id
    }
  }

  const operations = await getSceneOperations()
  const scenes = await operations.listScenes({
    projectId: parsed.data.projectId,
    viewerId,
    limit: parsed.data.limit,
  })

  // If non-admin, also merge scenes linked via site assignments
  if (authAvailable() && !isAdmin && viewerId) {
    try {
      const assignedRows = await query<RowDataPacket & { scene_id: string | null; public_id: string; name: string }>(
        `SELECT s.public_id, s.name, s.scene_id
           FROM assignments a
           JOIN sites s ON s.id = a.site_id
           JOIN users u ON u.id = a.user_id
          WHERE u.public_id = ?
            AND s.status <> 'archived'
          ORDER BY s.name ASC`,
        [viewerId],
      )
      const existingIds = new Set(scenes.map((s) => s.id))
      for (const row of assignedRows) {
        const targetId = row.scene_id || row.public_id
        if (targetId && !existingIds.has(targetId)) {
          let loadedMeta: (typeof scenes)[0] | null = null
          try {
            const loaded = await operations.loadStoredScene(targetId)
            if (loaded) {
              loadedMeta = {
                id: loaded.id,
                name: loaded.name || row.name,
                projectId: loaded.projectId,
                ownerId: loaded.ownerId,
                thumbnailUrl: loaded.thumbnailUrl,
                version: loaded.version,
                createdAt: loaded.createdAt,
                updatedAt: loaded.updatedAt,
                sizeBytes: loaded.sizeBytes,
                nodeCount: loaded.nodeCount,
                editorUrl: loaded.editorUrl,
                url: loaded.url,
                published: loaded.published,
                graphHash: loaded.graphHash,
              }
            }
          } catch {}

          if (!loadedMeta) {
            loadedMeta = {
              id: targetId,
              name: row.name,
              projectId: null,
              ownerId: null,
              thumbnailUrl: null,
              version: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              sizeBytes: 0,
              nodeCount: 0,
              editorUrl: `/scene/${targetId}`,
              url: `/scene/${targetId}`,
              published: true,
              graphHash: '',
            }
          }
          scenes.push(loadedMeta)
          existingIds.add(targetId)
        }
      }
    } catch {}
  }

  return sceneApiJson(request, { scenes })
}

export async function POST(request: NextRequest) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  // With auth on, creating a scene requires being signed in with an editing
  // role, and stamps the owner. Without auth (SQLite dev), creation stays
  // open and unowned.
  let ownerId: string | undefined
  if (authAvailable()) {
    const user = await getSessionUser()
    if (!user) return sceneApiJson(request, { error: 'auth_required' }, { status: 401 })
    if (!canEdit(user)) return sceneApiJson(request, { error: 'forbidden' }, { status: 403 })
    ownerId = user.id
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: 'body must be valid JSON' },
      { status: 400 },
    )
  }

  const parsed = createSceneSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const operations = await getSceneOperations()
  try {
    const meta = await operations.saveScene({
      id: parsed.data.id,
      name: parsed.data.name,
      projectId: parsed.data.projectId ?? null,
      ownerId,
      graph: parsed.data.graph as never,
      thumbnailUrl: parsed.data.thumbnailUrl ?? null,
    })
    return sceneApiJson(request, meta, {
      status: 201,
      headers: { Location: `/scene/${meta.id}` },
    })
  } catch (error) {
    return handleStoreError(request, error)
  }
}

function handleStoreError(request: NextRequest, error: unknown): NextResponse {
  const code = (error as { code?: string })?.code
  if (code === 'version_conflict') {
    return sceneApiJson(request, { error: 'version_conflict' }, { status: 409 })
  }
  if (code === 'not_found') {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }
  if (code === 'too_large') {
    return sceneApiJson(request, { error: 'too_large' }, { status: 413 })
  }
  if (code === 'invalid') {
    return sceneApiJson(request, { error: 'invalid' }, { status: 400 })
  }
  const message = error instanceof Error ? error.message : 'unexpected_error'
  return sceneApiJson(request, { error: 'internal_error', message }, { status: 500 })
}
