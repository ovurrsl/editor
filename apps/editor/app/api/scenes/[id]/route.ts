import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeSceneMutation, authorizeSceneRead } from '@/lib/auth/guard'
import { publishedSceneIds } from '@/lib/auth/site-scenes'
import { countGraphNodes, isEmptyGraphOverwrite } from '@/lib/empty-graph-guard'
import {
  applySceneGraphPatch,
  computeSceneGraphDiff,
  type SceneGraph,
  type SceneGraphPatch,
} from '@pascal-app/core'
import { apiGraphPatchSchema, apiGraphSchema } from '@/lib/graph-schema'
import {
  guardSceneApiRequest,
  sceneApiJson,
  sceneApiPreflight,
  withSceneApiHeaders,
} from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

const putSceneSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    graph: apiGraphSchema.optional(),
    patch: apiGraphPatchSchema.optional(),
    baseVersion: z.number().int().nonnegative().optional(),
    thumbnailUrl: z.string().url().nullable().optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
    /**
     * Overwriting a populated scene with a 0-node graph is rejected (409
     * `empty_graph_rejected`) unless this is set: an empty PUT is a hydration
     * race or a bug far more often than an intentional full deletion, and the
     * wipe is silent while the deletion is recoverable from scene_revisions.
     */
    force: z.boolean().optional(),
  })
  .refine((data) => data.graph !== undefined || data.patch !== undefined, {
    message: 'Either "graph" or "patch" must be provided',
  })

const patchSceneSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    patch: apiGraphPatchSchema.optional(),
    baseVersion: z.number().int().nonnegative().optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
    thumbnailUrl: z.string().url().nullable().optional(),
    force: z.boolean().optional(),
  })
  .refine((data) => data.name !== undefined || data.patch !== undefined, {
    message: 'Either "name" or "patch" must be provided',
  })

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const operations = await getSceneOperations()
  try {
    const scene = await operations.loadStoredScene(id)
    if (!scene) {
      return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
    }
    // The origin guard above proves where the request came from, not who sent
    // it. Without this a scene id was enough to read the drawing.
    const auth = await authorizeSceneRead(id, scene.ownerId ?? null, {
      published: (await publishedSceneIds()).has(id),
    })
    if (!auth.ok) return sceneApiJson(request, { error: auth.error }, { status: auth.status })
    return sceneApiJson(request, scene, {
      headers: { ETag: `"${scene.version}"` },
    })
  } catch (error) {
    return handleStoreError(request, error)
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params

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

  const parsed = putSceneSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const ifMatch = parseIfMatch(request.headers.get('If-Match'))
  const expectedVersion =
    ifMatch ?? parsed.data.expectedVersion ?? (parsed.data.patch ? parsed.data.baseVersion : undefined)

  const operations = await getSceneOperations()
  try {
    const existing = await operations.loadStoredScene(id)
    if (!existing) {
      return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
    }
    const auth = await authorizeSceneMutation(id, existing.ownerId)
    if (!auth.ok) return sceneApiJson(request, { error: auth.error }, { status: auth.status })

    // Single-active-editor lease: if another account currently holds the live
    // edit lease on this scene, refuse this save so two editors can't clobber
    // each other. A free lease (no fresh holder) is allowed. The live editor
    // UI keeps a non-holder in preview, so this is a server-side safety net.
    if (auth.user && operations.canTrackPresence) {
      const editor = (await operations.listScenePresence(id)).find((p) => p.isEditor)
      if (editor && editor.userId !== auth.user.id) {
        return sceneApiJson(request, { error: 'scene_locked_by_editor' }, { status: 423 })
      }
    }

    let targetGraph: SceneGraph
    let diffPatch: SceneGraphPatch | null = null

    if (parsed.data.patch) {
      targetGraph = applySceneGraphPatch(existing.graph, parsed.data.patch as SceneGraphPatch)
      diffPatch = parsed.data.patch as SceneGraphPatch
    } else if (parsed.data.graph) {
      targetGraph = parsed.data.graph as SceneGraph
      diffPatch = computeSceneGraphDiff(existing.graph, targetGraph, existing.version)
    } else {
      return sceneApiJson(
        request,
        { error: 'invalid_request', details: 'Either graph or patch is required' },
        { status: 400 },
      )
    }

    const targetNodeCount = Object.keys(targetGraph.nodes ?? {}).length
    if (
      !parsed.data.force &&
      isEmptyGraphOverwrite(targetNodeCount, existing.nodeCount)
    ) {
      return sceneApiJson(
        request,
        {
          error: 'empty_graph_rejected',
          details: `Refusing to overwrite ${existing.nodeCount} nodes with an empty graph. Pass "force": true to overwrite intentionally.`,
          currentVersion: existing.version,
          currentNodeCount: existing.nodeCount,
        },
        { status: 409 },
      )
    }
    const meta = await operations.saveScene({
      id,
      name: parsed.data.name ?? existing.name,
      projectId: existing.projectId,
      ownerId: existing.ownerId,
      graph: targetGraph as never,
      thumbnailUrl:
        parsed.data.thumbnailUrl === undefined ? existing.thumbnailUrl : parsed.data.thumbnailUrl,
      expectedVersion: expectedVersion ?? existing.version,
    })
    if (operations.canAppendSceneEvents) {
      await operations.appendSceneEvent({
        sceneId: id,
        version: meta.version,
        kind: 'save_scene',
        graph: targetGraph as never,
        patch: diffPatch ?? undefined,
        baseVersion: existing.version,
      })
    }
    return sceneApiJson(request, meta, {
      headers: { ETag: `"${meta.version}"` },
    })
  } catch (error) {
    return handleStoreError(request, error, { includeCurrentVersionFor: id })
  }
}


export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const ifMatch = parseIfMatch(request.headers.get('If-Match'))

  const operations = await getSceneOperations()
  try {
    const existing = await operations.loadStoredScene(id)
    if (!existing) {
      return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
    }
    const auth = await authorizeSceneMutation(id, existing.ownerId)
    if (!auth.ok) return sceneApiJson(request, { error: auth.error }, { status: auth.status })
    const removed = await operations.deleteStoredScene(id, { expectedVersion: ifMatch })
    if (!removed) {
      return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
    }
    return withSceneApiHeaders(request, new NextResponse(null, { status: 204 }))
  } catch (error) {
    return handleStoreError(request, error, { includeCurrentVersionFor: id })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params

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

  const parsed = patchSceneSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const ifMatch = parseIfMatch(request.headers.get('If-Match'))
  const expectedVersion =
    ifMatch ?? parsed.data.expectedVersion ?? (parsed.data.patch ? parsed.data.baseVersion : undefined)

  const operations = await getSceneOperations()
  try {
    const existing = await operations.loadStoredScene(id)
    if (!existing) {
      return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
    }
    const auth = await authorizeSceneMutation(id, existing.ownerId)
    if (!auth.ok) return sceneApiJson(request, { error: auth.error }, { status: auth.status })

    if (parsed.data.patch) {
      if (auth.user && operations.canTrackPresence) {
        const editor = (await operations.listScenePresence(id)).find((p) => p.isEditor)
        if (editor && editor.userId !== auth.user.id) {
          return sceneApiJson(request, { error: 'scene_locked_by_editor' }, { status: 423 })
        }
      }

      if (expectedVersion !== undefined && expectedVersion !== existing.version) {
        return sceneApiJson(
          request,
          { error: 'version_conflict', currentVersion: existing.version },
          { status: 409 },
        )
      }

      const targetGraph = applySceneGraphPatch(existing.graph, parsed.data.patch as SceneGraphPatch)
      const targetNodeCount = Object.keys(targetGraph.nodes ?? {}).length

      if (
        !parsed.data.force &&
        isEmptyGraphOverwrite(targetNodeCount, existing.nodeCount)
      ) {
        return sceneApiJson(
          request,
          {
            error: 'empty_graph_rejected',
            details: `Refusing to overwrite ${existing.nodeCount} nodes with an empty graph. Pass "force": true to overwrite intentionally.`,
            currentVersion: existing.version,
            currentNodeCount: existing.nodeCount,
          },
          { status: 409 },
        )
      }

      const meta = await operations.saveScene({
        id,
        name: parsed.data.name ?? existing.name,
        projectId: existing.projectId,
        ownerId: existing.ownerId,
        graph: targetGraph as never,
        thumbnailUrl:
          parsed.data.thumbnailUrl === undefined ? existing.thumbnailUrl : parsed.data.thumbnailUrl,
        expectedVersion: existing.version,
      })

      if (operations.canAppendSceneEvents) {
        await operations.appendSceneEvent({
          sceneId: id,
          version: meta.version,
          kind: 'save_scene',
          graph: targetGraph as never,
          patch: parsed.data.patch as SceneGraphPatch,
          baseVersion: existing.version,
        })
      }

      return sceneApiJson(request, meta, {
        headers: { ETag: `"${meta.version}"` },
      })
    }

    if (parsed.data.name) {
      const meta = await operations.renameStoredScene(id, parsed.data.name, { expectedVersion })
      return sceneApiJson(request, meta, {
        headers: { ETag: `"${meta.version}"` },
      })
    }

    return sceneApiJson(
      request,
      { error: 'invalid_request', details: 'Either name or patch must be provided' },
      { status: 400 },
    )
  } catch (error) {
    return handleStoreError(request, error, { includeCurrentVersionFor: id })
  }
}


/**
 * Parses an `If-Match` header value per RFC 7232. Accepts `"<version>"` or
 * weak `W/"<version>"` forms. Returns `undefined` when the header is absent,
 * the wildcard `*`, or unparseable as a non-negative integer.
 */
function parseIfMatch(raw: string | null): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (trimmed === '*') return undefined
  const match = trimmed.match(/^(?:W\/)?"([^"]+)"$/)
  const inner = match ? match[1] : trimmed
  if (!inner) return undefined
  const n = Number(inner)
  if (!(Number.isFinite(n) && Number.isInteger(n)) || n < 0) return undefined
  return n
}

async function handleStoreError(
  request: NextRequest,
  error: unknown,
  opts: { includeCurrentVersionFor?: string } = {},
): Promise<NextResponse> {
  const code = (error as { code?: string })?.code
  if (code === 'version_conflict') {
    let currentVersion: number | undefined
    if (opts.includeCurrentVersionFor) {
      try {
        const operations = await getSceneOperations()
        const current = await operations.loadStoredScene(opts.includeCurrentVersionFor)
        currentVersion = current?.version
      } catch {
        // Best-effort; skip reporting currentVersion on secondary failure.
      }
    }
    return sceneApiJson(
      request,
      currentVersion === undefined
        ? { error: 'version_conflict' }
        : { error: 'version_conflict', currentVersion },
      { status: 409 },
    )
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
