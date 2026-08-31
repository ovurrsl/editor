'use client'

// Node registry bootstrap is loaded once at the root via
// `<ClientBootstrap>` in `app/layout.tsx` — no per-page side-effect
// import here.
import {
  applySceneGraphToEditor,
  Editor,
  type SceneGraph,
  useEditor,
  useInteractionScope,
  useScene,
  useViewer,
} from '@pascal-app/editor'
import {
  applySceneGraphPatch,
  applySceneGraphPatchToStore,
  computeSceneGraphDiff,
  type SceneGraphPatch,
} from '@pascal-app/core'
import { useRouter, useSearchParams } from 'next/navigation'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AccountSettingsSection } from '@/components/account-settings-section'
import { useSession } from '@/components/auth/session-provider'
import { countGraphNodes, isEmptyGraphOverwrite } from '@/lib/empty-graph-guard'
import { type PersistedSceneGraph, sceneGraphSignature } from '@/lib/scene-signature'
import { usePluginManager } from '@/lib/plugins/use-plugin-manager'
import { EDITOR_SIDEBAR_TABS } from './editor-sidebar-tabs'
import { useScenePresence } from './use-scene-presence'
import {
  CommunityViewerToolbarCenter,
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from './viewer-toolbar'

export interface SceneMeta {
  id: string
  name: string
  projectId: string | null
  thumbnailUrl: string | null
  version: number
  createdAt: string
  updatedAt: string
  ownerId: string | null
  sizeBytes: number
  nodeCount: number
}

// Card previews are stored inline in the scenes row, so they must stay small:
// a ~256px JPEG at moderate quality is a few KB and reads clearly at card size.
const THUMBNAIL_MAX_DIM = 256
const THUMBNAIL_QUALITY = 0.55
const THUMBNAIL_MAX_CHARS = 60_000

/**
 * Shrinks a captured snapshot to a small JPEG data URL. Runs in the browser
 * (canvas), returns null if a 2D context is unavailable.
 */
async function downscaleToDataUrl(
  blob: Blob,
  maxDim: number,
  quality: number,
): Promise<string | null> {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close?.()
  }
}

interface SceneLoaderProps {
  initialScene: SceneGraph
  meta: SceneMeta
  /**
   * View-only account: the scene opens in preview and nothing is ever saved.
   * The server refuses a viewer's writes anyway (403) — this stops the client
   * from attempting them and from showing editing affordances on load.
   */
  readOnly?: boolean
}

interface LiveSceneEvent {
  eventId: number
  sceneId: string
  version: number
  kind: string
  createdAt: string
  graph?: PersistedSceneGraph
  patch?: SceneGraphPatch
  baseVersion?: number
}

/**
 * `?disable=postFx` is read at post-processing module load, so it only takes
 * effect on a full page load. Reading it here as well lets the flag survive a
 * client-side navigation, since `disablePostFx` is a live prop.
 */
function isLightPreviewQuery(searchParams: URLSearchParams): boolean {
  const disable = searchParams.get('disable') ?? ''
  return disable.split(',').some((p) => p.trim() === 'postFx')
}

export function SceneLoader({ initialScene, meta, readOnly = false }: SceneLoaderProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const versionRef = useRef(meta.version)
  // Node count of the graph the server is known to hold. Guards against the
  // autosave wipe class: a save fired from a not-yet-hydrated (empty) editor
  // store must never overwrite a populated server copy.
  const serverNodeCountRef = useRef(meta.nodeCount)
  const lastSavedGraphRef = useRef<SceneGraph>(initialScene)
  const lastRemoteGraphJsonRef = useRef<string | null>(null)
  const isRecoveringRef = useRef(false)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { user, openAuth } = useSession()

  const presence = useScenePresence(meta.id, true)
  // Before presence loads, fall back to the server `readOnly` prop so an
  // editable canvas never flashes for someone who is not the lease holder.
  const forcedReadOnly = presence.loaded ? !presence.canEdit || !presence.isEditor : readOnly
  const forcedReadOnlyRef = useRef(forcedReadOnly)
  useEffect(() => {
    forcedReadOnlyRef.current = forcedReadOnly
  }, [forcedReadOnly])

  useEffect(() => {
    if (forcedReadOnly) {
      useEditor.getState().setPreviewMode(true)
      // A forced viewer must stay in preview even if the viewer overlay's
      // "back" button tries to exit it — re-assert on any store change.
      const unsub = useEditor.subscribe((s) => {
        if (!s.isPreviewMode) useEditor.getState().setPreviewMode(true)
      })
      return unsub
    }
    // Seamless Role Transfer & Lock Elimination (M2)
    forcedReadOnlyRef.current = false
    useEditor.getState().setPreviewMode(false)
    useInteractionScope.getState().end()
    useViewer.getState().setInputDragging(false)
    useViewer.getState().setCameraDragging(false)

    // Auto-recover active building and level selection if null
    const viewer = useViewer.getState()
    if (!viewer.selection.levelId) {
      const nodes = useScene.getState().nodes
      const firstBuilding = Object.values(nodes).find((n) => n.type === 'building')
      const firstLevel = Object.values(nodes).find((n) => n.type === 'level')
      if (firstBuilding && firstLevel) {
        viewer.setSelection({
          buildingId: firstBuilding.id,
          levelId: firstLevel.id,
          selectedIds: [],
          zoneId: null,
        })
      }
    }
    useViewer.getState().setSceneLocked(false)
  }, [forcedReadOnly])

  useEffect(() => {
    if (initialScene.installedPlugins && initialScene.installedPlugins.length > 0) {
      void usePluginManager.getState().syncWithScene(initialScene.installedPlugins)
    }
  }, [initialScene])

  const lightPreview = isLightPreviewQuery(searchParams)

  const handleLoad = useCallback(async () => initialScene, [initialScene])

  const handleSave = useCallback(
    async (graph: SceneGraph, options?: { keepalive?: boolean }) => {
      if (forcedReadOnlyRef.current) return

      const patch = computeSceneGraphDiff(lastSavedGraphRef.current, graph, versionRef.current)
      if (patch === null) {
        return
      }

      // Wipe guard: never PUT an empty graph over a populated server copy.
      // An empty serialization here means the editor store was not hydrated
      // (load in flight or failed), not that the user deleted everything.
      const outgoingNodeCount = countGraphNodes(graph)
      if (isEmptyGraphOverwrite(outgoingNodeCount, serverNodeCountRef.current)) {
        console.error(
          `[scene-loader] Blocked autosave: refusing to overwrite scene ${meta.id} ` +
            `(${serverNodeCountRef.current} nodes on the server) with an empty graph.`,
        )
        setSaveError('Autosave blocked: the editor tried to save an empty scene')
        return
      }

      try {
        const response = await fetch(`/api/scenes/${meta.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': String(versionRef.current),
          },
          body: JSON.stringify({ name: meta.name, patch, baseVersion: versionRef.current }),
          // `keepalive` lets the request outlive a page unload (the autosave
          // flush on refresh/close). Browsers cap keepalive bodies at 64KB, so
          // only the unload flush opts in — normal debounced saves omit it and
          // can carry arbitrarily large scenes.
          keepalive: options?.keepalive,
        })

        if (response.status === 409) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null
          if (body?.error === 'empty_graph_rejected') {
            // Server-side wipe guard (defense in depth behind the client-side
            // check above) — not a concurrent-session conflict.
            console.error(
              `[scene-loader] Server rejected an empty-graph save for scene ${meta.id}.`,
            )
            setSaveError('Autosave blocked: the editor tried to save an empty scene')
            throw new Error('empty_graph_rejected')
          }
          setConflict(true)
          throw new Error('version_conflict')
        }

        if (response.status === 401) {
          setSaveError('Sign in to save your changes.')
          openAuth()
          throw new Error('unauthorized')
        }

        if (!response.ok) {
          // Fallback to full PUT if PATCH fails for an unexpected reason
          const fallbackRes = await fetch(`/api/scenes/${meta.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'If-Match': String(versionRef.current),
            },
            body: JSON.stringify({ name: meta.name, graph }),
            keepalive: options?.keepalive,
          })
          if (!fallbackRes.ok) {
            const msg = `Save failed (${fallbackRes.status})`
            setSaveError(msg)
            throw new Error(msg)
          }
          const next = (await fallbackRes.json()) as SceneMeta
          versionRef.current = next.version
          serverNodeCountRef.current = next.nodeCount
          lastSavedGraphRef.current = graph
          setSaveError(null)
          return
        }

        const next = (await response.json()) as SceneMeta
        versionRef.current = next.version
        serverNodeCountRef.current = next.nodeCount
        lastSavedGraphRef.current = graph
        setSaveError(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Save failed'
        if (message !== 'version_conflict' && message !== 'empty_graph_rejected' && message !== 'unauthorized') {
          setSaveError(message)
        }
        throw error
      }
    },
    [meta.id, meta.name, openAuth],
  )

  useEffect(() => {
    const source = new EventSource(`/api/scenes/${meta.id}/events`)

    source.addEventListener('scene', (event) => {
      let payload: LiveSceneEvent
      try {
        payload = JSON.parse((event as MessageEvent<string>).data) as LiveSceneEvent
      } catch {
        return
      }
      if (payload.sceneId !== meta.id) return
      if (payload.version <= versionRef.current) return

      // Fast-path: granular patch application when baseVersion matches
      if (
        payload.patch &&
        (payload.baseVersion === undefined || payload.baseVersion === versionRef.current)
      ) {
        const applied = applySceneGraphPatchToStore(payload.patch)
        if (applied) {
          versionRef.current = payload.version
          if (lastSavedGraphRef.current) {
            lastSavedGraphRef.current = applySceneGraphPatch(
              lastSavedGraphRef.current,
              payload.patch,
            )
            serverNodeCountRef.current = Object.keys(lastSavedGraphRef.current.nodes ?? {}).length
          }
          if (payload.patch.installedPlugins && payload.patch.installedPlugins.length > 0) {
            void usePluginManager.getState().syncWithScene(payload.patch.installedPlugins)
          }
          setConflict(false)
          setSaveError(null)
          return
        }
      }

      // Full graph fallback
      if (payload.graph) {
        versionRef.current = payload.version
        serverNodeCountRef.current = countGraphNodes(payload.graph)
        lastSavedGraphRef.current = payload.graph as SceneGraph
        lastRemoteGraphJsonRef.current = sceneGraphSignature(payload.graph)
        applySceneGraphToEditor(payload.graph)
        if (payload.graph.installedPlugins && payload.graph.installedPlugins.length > 0) {
          void usePluginManager.getState().syncWithScene(payload.graph.installedPlugins)
        }
        setConflict(false)
        setSaveError(null)
      } else {
        // Recover from version gap by fetching full scene (deduplicated)
        if (isRecoveringRef.current) return
        isRecoveringRef.current = true
        void fetch(`/api/scenes/${meta.id}`)
          .then(async (res) => {
            if (!res.ok) return
            const fullScene = (await res.json()) as {
              version: number
              nodeCount: number
              graph: SceneGraph
            }
            if (fullScene && fullScene.version > versionRef.current) {
              versionRef.current = fullScene.version
              serverNodeCountRef.current = fullScene.nodeCount
              lastSavedGraphRef.current = fullScene.graph
              lastRemoteGraphJsonRef.current = sceneGraphSignature(fullScene.graph)
              applySceneGraphToEditor(fullScene.graph)
              if (
                fullScene.graph.installedPlugins &&
                fullScene.graph.installedPlugins.length > 0
              ) {
                void usePluginManager.getState().syncWithScene(fullScene.graph.installedPlugins)
              }
              setConflict(false)
              setSaveError(null)
            }
          })
          .catch(() => {})
          .finally(() => {
            isRecoveringRef.current = false
          })
      }
    })

    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        setSaveError('Live scene connection closed')
      }
    })

    return () => source.close()
  }, [meta.id])


  const handleThumb = useCallback(
    async (blob: Blob) => {
      // A non-lease holder never owns the scene write; the server would refuse it.
      if (forcedReadOnlyRef.current) return
      try {
        const dataUrl = await downscaleToDataUrl(blob, THUMBNAIL_MAX_DIM, THUMBNAIL_QUALITY)
        // The thumbnail lives inline in the scenes row (a TEXT column); an
        // oversized data URL would be rejected server-side, so drop it here
        // rather than send a doomed request.
        if (!dataUrl || dataUrl.length > THUMBNAIL_MAX_CHARS) return
        await fetch(`/api/scenes/${meta.id}/thumbnail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl }),
        })
      } catch {
        // Best-effort: a missing card preview is not worth surfacing an error.
      }
    },
    [meta.id],
  )

  return (
    <div className="relative h-screen w-screen">
      {conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-background p-4 shadow-xl">
          <h2 className="font-semibold text-sm">Another session saved first — refresh?</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Your changes haven&apos;t been saved. Reload to pick up the latest version.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80"
              onClick={() => router.refresh()}
              type="button"
            >
              Reload
            </button>
            <button
              className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40"
              onClick={() => setConflict(false)}
              type="button"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {saveError && !conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-destructive/50 bg-background p-3 shadow-xl">
          <p className="font-medium text-destructive text-xs">{saveError}</p>
        </div>
      )}
      {/*
        "Light preview" and "All scenes" used to float over the canvas here and
        are gone. Both were navigation sitting on top of the drawing: the first
        reloaded the page onto `?disable=postFx`, the second linked to `/scenes`
        — and the Scenes rail already answers the second from inside the editor,
        without leaving it.

        `disablePostFx` below is unaffected. `?disable=postFx` is still read
        (`isLightPreviewQuery`), so the flag keeps working for anyone measuring
        GPU cost; what went away is a permanent button for a diagnostic.
      */}
      <Editor
        disablePostFx={lightPreview}
        layoutVersion="v2"
        onLoad={handleLoad}
        onSave={handleSave}
        onThumbnailCapture={handleThumb}
        projectId={meta.projectId ?? 'default'}
        settingsPanelProps={{ accountSection: <AccountSettingsSection /> }}
        sidebarTabs={EDITOR_SIDEBAR_TABS}
        viewerToolbarCenter={
          <CommunityViewerToolbarCenter
            currentUserId={user?.id}
            presence={presence}
          />
        }
        viewerToolbarLeft={
          <CommunityViewerToolbarLeft
            currentUserId={user?.id}
            presence={presence}
          />
        }
        viewerToolbarRight={
          <CommunityViewerToolbarRight
            currentUserId={user?.id}
            presence={presence}
          />
        }
      />
    </div>
  )
}
