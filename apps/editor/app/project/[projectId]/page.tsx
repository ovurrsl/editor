'use client'

import { useScene } from '@pascal-app/core'
import { applySceneGraphToEditor, Editor, type SceneGraph } from '@pascal-app/editor'
import { PascalWebXRButton } from '@webxr/plugin/pascal-editor'
import { History } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DevDebugMenu } from '@/components/dev-debug-menu'
import { EDITOR_SIDEBAR_TABS } from '@/components/editor-sidebar-tabs'
import { Button } from '@/components/ui/primitives/button'
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
import { FeedbackDialog } from '@/features/community/components/feedback-dialog'
import { PascalRadio } from '@/features/community/components/pascal-radio'
import { ProjectDropdown } from '@/features/community/components/project-dropdown'
import {
  VersionHistoryContext,
  type VersionHistoryContextValue,
  VersionHistoryPanel,
} from '@/features/community/components/version-history-panel'
import { deleteProjectAssetByUrl } from '@/features/community/lib/assets/actions'
import { useAuth } from '@/features/community/lib/auth/hooks'
import { submitFeedbackWithImages } from '@/features/community/lib/feedback/submit'
import {
  getLocalProject,
  updateLocalProjectScene,
} from '@/features/community/lib/local-storage/project-store'
import {
  getProjectModel,
  getProjectVersionByNumber,
  saveProjectModel,
  saveProjectVersion,
} from '@/features/community/lib/models/actions'
import {
  updateProjectVisibility,
  uploadProjectThumbnail,
} from '@/features/community/lib/projects/actions'
import { useProjectStore } from '@/features/community/lib/projects/store'
import { uploadAssetWithProgress } from '@/lib/upload-asset'

const HISTORY_TAB = {
  id: 'history',
  label: 'History',
  component: VersionHistoryPanel,
  mobileDefaultSnap: 0.5,
  mobileIcon: <History className="h-5 w-5" />,
  icon: <History className="h-6 w-6" />,
}

function isLocalProjectId(projectId: string) {
  return projectId.startsWith('local_')
}

function currentSceneGraph(): SceneGraph {
  const { nodes, rootNodeIds, collections, materials, installedPlugins } = useScene.getState()
  return { nodes, rootNodeIds, collections, materials, installedPlugins }
}

type VersionPreview = { version: number; scene: SceneGraph }

export default function EditorPage() {
  const params = useParams<{ projectId: string }>()
  const projectId = params.projectId
  const isLocal = isLocalProjectId(projectId)
  const { isAuthenticated } = useAuth()
  const setActiveProject = useProjectStore((state) => state.setActiveProject)
  const updateActiveThumbnail = useProjectStore((state) => state.updateActiveThumbnail)
  const activeProject = useProjectStore((state) =>
    state.activeProject?.id === projectId ? state.activeProject : null,
  )
  const webXRInstalled = useWebXRInstalled()
  const [preview, setPreview] = useState<VersionPreview | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  // The editing scene to put back when a version preview closes.
  const sceneBeforePreviewRef = useRef<SceneGraph | null>(null)

  useEffect(() => {
    if (isAuthenticated && !isLocal) {
      setActiveProject(projectId)
    }
  }, [projectId, isLocal, isAuthenticated, setActiveProject])

  useEffect(() => {
    if (preview || !sceneBeforePreviewRef.current) return
    applySceneGraphToEditor(sceneBeforePreviewRef.current)
    sceneBeforePreviewRef.current = null
  }, [preview])

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
    return result.data?.model?.scene_graph ?? null
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

  const handlePreview = useCallback(
    async (version: number) => {
      const result = await getProjectVersionByNumber(projectId, version)
      const scene = result.data?.scene_graph
      if (!scene) return
      if (!sceneBeforePreviewRef.current) {
        sceneBeforePreviewRef.current = currentSceneGraph()
      }
      setPreview({ version, scene })
    },
    [projectId],
  )

  // Flush the live scene into the draft first, so the locked version holds
  // exactly what is on screen rather than the last debounced autosave.
  const handleSaveVersion = useCallback(
    async (options?: { publish?: boolean }) => {
      const draftResult = await saveProjectModel(projectId, currentSceneGraph())
      if (!draftResult.success) return draftResult.error ?? 'Failed to save draft'
      const result = await saveProjectVersion(projectId, options)
      setHistoryRefreshKey((key) => key + 1)
      return result.success ? (result.message ?? null) : (result.error ?? 'Failed to save version')
    },
    [projectId],
  )

  const handleRestore = useCallback(async () => {
    if (!preview) return
    const result = await saveProjectModel(projectId, preview.scene, {
      restoredFromVersion: preview.version,
    })
    if (!result.success) return
    sceneBeforePreviewRef.current = preview.scene
    setPreview(null)
    setHistoryRefreshKey((key) => key + 1)
  }, [projectId, preview])

  const handleVisibilityChange = useCallback(
    async (field: 'isPrivate' | 'showScansPublic' | 'showGuidesPublic', value: boolean) => {
      const result = await updateProjectVisibility(projectId, { [field]: value })
      if (!result.success) throw new Error(result.error ?? 'Failed to update visibility')
      await setActiveProject(projectId)
    },
    [projectId, setActiveProject],
  )

  const handleSaveShortcut = useCallback(() => {
    if (isLocal || preview) return false
    handleSaveVersion()
    return true
  }, [isLocal, preview, handleSaveVersion])

  const historyContext = useMemo<VersionHistoryContextValue>(
    () => ({
      projectId,
      previewVersion: preview?.version ?? null,
      refreshKey: historyRefreshKey,
      onPreview: handlePreview,
      onSaveVersion: handleSaveVersion,
    }),
    [projectId, preview, historyRefreshKey, handlePreview, handleSaveVersion],
  )

  const sidebarTabs = useMemo(
    () => (isLocal ? EDITOR_SIDEBAR_TABS : [...EDITOR_SIDEBAR_TABS, HISTORY_TAB]),
    [isLocal],
  )

  const previewBanner = preview ? (
    <div className="pointer-events-auto absolute top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-background/95 px-4 py-1.5 text-sm shadow-lg backdrop-blur">
      <span>Previewing v{preview.version}</span>
      <Button onClick={handleRestore} size="sm">
        Restore this version
      </Button>
      <Button onClick={() => setPreview(null)} size="sm" variant="outline">
        Exit preview
      </Button>
    </div>
  ) : null

  return (
    <VersionHistoryContext.Provider value={historyContext}>
      <div className="relative h-screen w-screen">
        <DevDebugMenu />
        <div className="pointer-events-none absolute top-3 right-3 z-50 flex items-start gap-2">
          <div className="pointer-events-auto">
            <PascalRadio />
          </div>
          {isAuthenticated && !isLocal && (
            <div className="pointer-events-auto">
              <ProjectDropdown projectId={projectId} />
            </div>
          )}
          <div className="pointer-events-auto">
            <FeedbackDialog
              onSubmit={submitFeedbackWithImages}
              projectId={isLocal ? undefined : projectId}
            />
          </div>
          <CloudSaveButton projectId={projectId} />
        </div>
        <WebXRFeatureRuntime enabled={webXRInstalled}>
          <WebXRFeatureConsumer>
            {(vr) => (
              <Editor
                guardAgainstSceneWipe
                immersive={vr?.session ? vr.immersive : undefined}
                isVersionPreviewMode={preview !== null}
                layoutVersion="v2"
                onLoad={handleLoad}
                onSave={handleSave}
                onSaveShortcut={handleSaveShortcut}
                onThumbnailCapture={isLocal ? undefined : handleThumbnailCapture}
                previewScene={preview?.scene}
                projectId={projectId}
                sidebarTabs={sidebarTabs}
                settingsPanelProps={
                  activeProject
                    ? {
                        projectId,
                        projectName: activeProject.name,
                        projectVisibility: {
                          isPrivate: activeProject.is_private,
                          showScansPublic: activeProject.show_scans_public,
                          showGuidesPublic: activeProject.show_guides_public,
                        },
                        onVisibilityChange: handleVisibilityChange,
                      }
                    : undefined
                }
                sitePanelProps={
                  isLocal
                    ? undefined
                    : {
                        projectId,
                        onUploadAsset: uploadAssetWithProgress,
                        onDeleteAsset: deleteProjectAssetByUrl,
                      }
                }
                viewerBanner={previewBanner}
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
    </VersionHistoryContext.Provider>
  )
}
