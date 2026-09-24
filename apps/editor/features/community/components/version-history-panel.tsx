'use client'

import { Eye, History, Loader2, Save, Upload } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Button } from '@/components/ui/primitives/button'
import { cn } from '@/lib/utils'
import {
  getProjectVersionList,
  getProjectVersionStatus,
  type ProjectVersionListItem,
  type ProjectVersionStatus,
  publishProjectModel,
} from '../lib/models/actions'

export interface VersionHistoryContextValue {
  projectId: string
  previewVersion: number | null
  /** Bumped by the host after it saves or restores, so the list refetches. */
  refreshKey: number
  onPreview: (version: number) => void
  onSaveVersion: (options?: { publish?: boolean }) => Promise<string | null>
}

export const VersionHistoryContext = createContext<VersionHistoryContextValue | null>(null)

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function VersionHistoryPanel() {
  const context = useContext(VersionHistoryContext)
  const [versions, setVersions] = useState<ProjectVersionListItem[]>([])
  const [status, setStatus] = useState<ProjectVersionStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const projectId = context?.projectId
  const refreshKey = context?.refreshKey

  const refresh = useCallback(async () => {
    if (!projectId) return
    const [listResult, statusResult] = await Promise.all([
      getProjectVersionList(projectId),
      getProjectVersionStatus(projectId),
    ])
    if (listResult.success) setVersions(listResult.data ?? [])
    if (statusResult.success) setStatus(statusResult.data ?? null)
    if (!listResult.success) setMessage(listResult.error ?? 'Failed to load versions')
    setIsLoading(false)
  }, [projectId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a refetch trigger
  useEffect(() => {
    refresh()
  }, [refresh, refreshKey])

  if (!context) return null

  const runAction = async (key: string, action: () => Promise<string | null>) => {
    setBusyAction(key)
    setMessage(null)
    try {
      setMessage(await action())
      await refresh()
    } finally {
      setBusyAction(null)
    }
  }

  const handlePublishVersion = (version: number) =>
    runAction(`publish-${version}`, async () => {
      const result = await publishProjectModel(context.projectId, { version })
      return result.success ? (result.message ?? null) : (result.error ?? 'Publish failed')
    })

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2 font-medium text-sm">
        <History className="h-4 w-4" />
        Version history
      </div>

      {status && (
        <p className="text-muted-foreground text-xs">
          {status.publishedVersion !== null
            ? `Published: v${status.publishedVersion}`
            : 'Not published yet'}
          {status.hasUnsavedDraftChanges ? ' · Draft has unsaved changes' : ''}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={busyAction !== null}
          onClick={() => runAction('save', () => context.onSaveVersion())}
          size="sm"
          variant="outline"
        >
          {busyAction === 'save' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save version
        </Button>
        <Button
          className="flex-1"
          disabled={busyAction !== null}
          onClick={() => runAction('publish', () => context.onSaveVersion({ publish: true }))}
          size="sm"
        >
          {busyAction === 'publish' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Publish
        </Button>
      </div>

      {message && <p className="text-muted-foreground text-xs">{message}</p>}

      <div className="-mx-1 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="px-1 text-muted-foreground text-xs">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="px-1 text-muted-foreground text-xs">No versions yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {versions.map((item) => (
              <li
                className={cn(
                  'rounded-md border border-transparent px-2 py-1.5 text-xs',
                  context.previewVersion === item.version && 'border-border bg-accent',
                )}
                key={item.id}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">v{item.version}</span>
                  {item.isDraft && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">Draft</span>
                  )}
                  {item.isPublished && (
                    <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                      Published
                    </span>
                  )}
                  <span className="ml-auto flex gap-1">
                    {!item.isDraft && (
                      <button
                        className="rounded p-1 hover:bg-accent"
                        onClick={() => context.onPreview(item.version)}
                        title="Preview this version"
                        type="button"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!(item.isDraft || item.isPublished) && (
                      <button
                        className="rounded p-1 hover:bg-accent disabled:opacity-50"
                        disabled={busyAction !== null}
                        onClick={() => handlePublishVersion(item.version)}
                        title="Publish this version"
                        type="button"
                      >
                        <Upload className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {formatDate(item.updatedAt)}
                  {item.restoredFromVersion !== null &&
                    ` · restored from v${item.restoredFromVersion}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
