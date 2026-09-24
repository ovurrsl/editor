'use client'

import { Editor, type SceneGraph, useEditor } from '@pascal-app/editor'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import {
  getProjectModelPublic,
  incrementProjectViews,
} from '@/features/community/lib/projects/actions'
import { CollectionsPanel } from './collections-panel'
import { ViewerGuestCTA } from './viewer-guest-cta'

type ViewerState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; name: string; scene: SceneGraph }

const EMPTY_SCENE: SceneGraph = { nodes: {}, rootNodeIds: [] }

async function loadDemoScene(id: string): Promise<SceneGraph> {
  const response = await fetch(`/demos/${id}.json`)
  if (!response.ok) throw new Error(`Demo "${id}" not found`)
  return (await response.json()) as SceneGraph
}

export default function ViewerPage() {
  const params = useParams<{ id: string }>()
  const projectId = params.id
  const [state, setState] = useState<ViewerState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    if (projectId.startsWith('demo_')) {
      loadDemoScene(projectId)
        .then((scene) => {
          if (!cancelled) setState({ status: 'ready', name: 'Demo', scene })
        })
        .catch((error: unknown) => {
          if (cancelled) return
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Failed to load demo',
          })
        })
      return () => {
        cancelled = true
      }
    }

    getProjectModelPublic(projectId)
      .then((result) => {
        if (cancelled) return
        if (!(result.success && result.data)) {
          setState({ status: 'error', message: result.error ?? 'Project not found' })
          return
        }
        const scene = (result.data.model?.scene_graph as SceneGraph | null) ?? EMPTY_SCENE
        setState({ status: 'ready', name: result.data.project.name, scene })
        if (!result.data.isOwner) {
          incrementProjectViews(projectId)
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to load project',
        })
      })

    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    if (state.status !== 'ready') return
    useEditor.getState().setPreviewMode(true)
    return () => useEditor.getState().setPreviewMode(false)
  }, [state.status])

  const scene = state.status === 'ready' ? state.scene : null
  const handleLoad = useCallback(async () => scene, [scene])
  // Shared projects are read-only: never write the owner's scene from here.
  const handleSave = useCallback(async () => {}, [])

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background">
        <p className="text-destructive text-sm">{state.message}</p>
        <Link className="text-sm underline" href="/">
          Back to projects
        </Link>
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen">
      <Editor
        isVersionPreviewMode
        layoutVersion="v2"
        onLoad={handleLoad}
        onSave={handleSave}
        previewScene={state.scene}
        projectId={`viewer_${projectId}`}
      />
      <div className="pointer-events-none absolute top-20 right-4 z-40">
        <CollectionsPanel />
      </div>
      <ViewerGuestCTA />
    </div>
  )
}
