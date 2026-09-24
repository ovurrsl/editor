'use client'

import { Editor, type SceneGraph } from '@pascal-app/editor'
import { PascalWebXRButton } from '@webxr/plugin/pascal-editor'
import { useParams } from 'next/navigation'
import { useCallback, useEffect } from 'react'
import { EDITOR_SIDEBAR_TABS } from '@/components/editor-sidebar-tabs'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'
import {
  useWebXRInstalled,
  WebXRFeatureConsumer,
  WebXRFeatureRuntime,
} from '@/components/webxr-feature-gate'
import { CloudSaveButton } from '@/features/community/components/cloud-save-button'
import { useAuth } from '@/features/community/lib/auth/hooks'
import {
  getLocalProject,
  updateLocalProjectScene,
} from '@/features/community/lib/local-storage/project-store'
import { getProjectModel, saveProjectModel } from '@/features/community/lib/models/actions'
import { uploadProjectThumbnail } from '@/features/community/lib/projects/actions'
import { useProjectStore } from '@/features/community/lib/projects/store'

function isLocalProjectId(projectId: string) {
  return projectId.startsWith('local_')
}

export default function EditorPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId
  const isLocal = isLocalProjectId(projectId)
  const { isAuthenticated } = useAuth()
  const setActiveProject = useProjectStore((state) => state.setActiveProject)
  const updateActiveThumbnail = useProjectStore((state) => state.updateActiveThumbnail)
  const webXRInstalled = useWebXRInstalled()

  useEffect(() => {
    if (isAuthenticated && !isLocal) {
      setActiveProject(projectId)
    }
  }, [projectId, isLocal, isAuthenticated, setActiveProject])

  // A thrown error surfaces the editor's load-failure retry instead of an empty
  // scene, so a transient fetch failure can never be autosaved over the cloud copy.
  const handleLoad = useCallback(async (): Promise<SceneGraph | null> => {
    if (isLocal) {
      return getLocalProject(projectId)?.scene_graph ?? null
    }
    const result = await getProjectModel(projectId)
    if (!result.success) {
      throw new Error(result.error ?? 'Failed to load project')
    }
    return result.data?.scene_graph ?? null
  }, [projectId, isLocal])

  const handleSave = useCallback(
    async (scene: SceneGraph) => {
      if (isLocal) {
        updateLocalProjectScene(projectId, scene)
        return
      }
      const result = await saveProjectModel(projectId, scene)
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to save project')
      }
    },
    [projectId, isLocal],
  )

  const handleThumbnailCapture = useCallback(
    async (blob: Blob) => {
      if (isLocal) return
      const result = await uploadProjectThumbnail(projectId, blob)
      if (result.success) {
        updateActiveThumbnail(result.data.thumbnail_url)
      }
    },
    [projectId, isLocal, updateActiveThumbnail],
  )

  return (
    <div className="relative h-screen w-screen">
      <div className="pointer-events-none absolute top-3 right-3 z-50">
        <CloudSaveButton projectId={projectId} />
      </div>
      <WebXRFeatureRuntime enabled={webXRInstalled}>
        <WebXRFeatureConsumer>
          {(vr) => (
            <Editor
              guardAgainstSceneWipe
              immersive={vr?.session ? vr.immersive : undefined}
              layoutVersion="v2"
              onLoad={handleLoad}
              onSave={handleSave}
              onThumbnailCapture={isLocal ? undefined : handleThumbnailCapture}
              projectId={projectId}
              sidebarTabs={EDITOR_SIDEBAR_TABS}
              viewerToolbarLeft={<CommunityViewerToolbarLeft />}
              viewerToolbarRight={
                <CommunityViewerToolbarRight
                  vrButton={
                    vr ? (
                      <PascalWebXRButton
                        className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-accent disabled:opacity-50"
                        feature={vr}
                      />
                    ) : null
                  }
                  vrLabel="Enter VR"
                />
              }
            />
          )}
        </WebXRFeatureConsumer>
      </WebXRFeatureRuntime>
    </div>
  )
}
