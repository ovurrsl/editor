'use client'

import { Eye, History, Pencil, Share2, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { SceneMeta } from '@/components/scene-loader'
import { SceneBackupsDialog } from './scene-backups-dialog'
import { SceneDeleteDialog } from './scene-delete-dialog'
import { ScenePreviewDialog } from './scene-preview-dialog'
import { SceneRenameDialog } from './scene-rename-dialog'
import { SceneShareDialog } from './scene-share-dialog'

/**
 * The full scenes library grid — this is where the rich per-project management
 * lives (rename, delete, share, backups, preview), unlike the editor's rail,
 * which is a plain switcher. Rendered by the server-side `/scenes` page; a
 * successful action calls `router.refresh()` to re-fetch that server list.
 */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

type Dialog = {
  kind: 'rename' | 'delete' | 'share' | 'backups' | 'preview'
  scene: SceneMeta
}

const ICON_BTN =
  'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

export function SceneGrid({
  scenes,
  currentUserId,
  isAdmin,
  userRole = 'viewer',
  editableSceneIds,
  launchToken,
  viewerUrl = 'https://viewer.opex.help',
}: {
  scenes: SceneMeta[]
  currentUserId: string | null
  isAdmin: boolean
  userRole?: string
  editableSceneIds?: string[]
  launchToken?: string
  viewerUrl?: string
}) {
  const router = useRouter()
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const editableSet = new Set(editableSceneIds ?? [])
  // A scene is manageable by the user if it is in editableSceneIds (explicit per-scene permission),
  // or (fallback) owner/admin and not global viewer.
  const canManage = (scene: SceneMeta): boolean => {
    if (editableSceneIds !== undefined) {
      return editableSet.has(scene.id)
    }
    return userRole !== 'viewer' && currentUserId != null && (scene.ownerId === currentUserId || isAdmin)
  }

  const handleCardClick = (scene: SceneMeta) => {
    if (!canManage(scene)) {
      const targetUrl = `${viewerUrl}/?launch_token=${encodeURIComponent(launchToken || '')}&sceneId=${encodeURIComponent(scene.id)}`
      window.location.assign(targetUrl)
    } else {
      router.push(`/scene/${scene.id}`)
    }
  }

  const DISABLED_TOOLTIP = 'Bu işlem için Editör veya Yönetici yetkisi gereklidir'

  return (
    <>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {scenes.map((scene) => {
          const manage = canManage(scene)
          const vitrinUrl = `${viewerUrl}/?launch_token=${encodeURIComponent(launchToken || '')}&sceneId=${encodeURIComponent(scene.id)}`

          return (
            <li
              key={scene.id}
              className="flex flex-col rounded-xl border border-border/60 bg-background transition-colors hover:border-border"
            >
              <button
                className="group block rounded-t-xl p-4 text-left transition-colors hover:bg-accent/30"
                onClick={() => handleCardClick(scene)}
                type="button"
                title={manage ? 'Editörde Aç' : '3D Vitrinde Aç'}
              >
                <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-accent/30">
                  {scene.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={scene.name}
                      className="h-full w-full object-cover"
                      src={scene.thumbnailUrl}
                    />
                  ) : (
                    <span className="text-muted-foreground text-xs">No thumbnail</span>
                  )}
                </div>
                <div className="mt-3">
                  <h2 className="truncate font-semibold text-sm group-hover:text-foreground">
                    {scene.name}
                  </h2>
                  <div className="mt-1 flex items-center justify-between text-muted-foreground text-xs">
                    <span>{scene.nodeCount} nodes</span>
                    <time dateTime={scene.updatedAt}>{formatDate(scene.updatedAt)}</time>
                  </div>
                </div>
              </button>

              <div className="flex items-center gap-1 border-border/60 border-t px-3 py-2">
                <a
                  href={vitrinUrl}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-primary text-xs font-medium transition-colors hover:bg-primary/10"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Yeni 3D Vitrinde Görüntüle"
                >
                  <Eye className="size-3.5" />
                  3D Vitrin
                </a>

                {manage ? (
                  <button
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
                    onClick={() => setDialog({ kind: 'backups', scene })}
                    type="button"
                  >
                    <History className="size-3.5" />
                    Yedekler
                  </button>
                ) : (
                  <button
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground/40 text-xs cursor-not-allowed"
                    disabled
                    title={DISABLED_TOOLTIP}
                    type="button"
                  >
                    <History className="size-3.5" />
                    Yedekler
                  </button>
                )}

                <button
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setDialog({ kind: 'preview', scene })}
                  type="button"
                >
                  Önizle
                </button>

                <div className="ml-auto flex items-center gap-0.5">
                  {manage ? (
                    <>
                      <button
                        aria-label="Yeniden adlandır"
                        className={ICON_BTN}
                        onClick={() => setDialog({ kind: 'rename', scene })}
                        title="Yeniden adlandır"
                        type="button"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        aria-label="Paylaş"
                        className={ICON_BTN}
                        onClick={() => setDialog({ kind: 'share', scene })}
                        title="Paylaş"
                        type="button"
                      >
                        <Share2 className="size-3.5" />
                      </button>
                      <button
                        aria-label="Sil"
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                        onClick={() => setDialog({ kind: 'delete', scene })}
                        title="Sil"
                        type="button"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        aria-label="Yeniden adlandır (Yetki yok)"
                        className="rounded-md p-1.5 text-muted-foreground/40 cursor-not-allowed"
                        disabled
                        title={DISABLED_TOOLTIP}
                        type="button"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        aria-label="Paylaş (Yetki yok)"
                        className="rounded-md p-1.5 text-muted-foreground/40 cursor-not-allowed"
                        disabled
                        title={DISABLED_TOOLTIP}
                        type="button"
                      >
                        <Share2 className="size-3.5" />
                      </button>
                      <button
                        aria-label="Sil (Yetki yok)"
                        className="rounded-md p-1.5 text-muted-foreground/40 cursor-not-allowed"
                        disabled
                        title={DISABLED_TOOLTIP}
                        type="button"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {dialog?.kind === 'rename' && (
        <SceneRenameDialog
          onClose={() => setDialog(null)}
          onRenamed={() => router.refresh()}
          scene={dialog.scene}
        />
      )}
      {dialog?.kind === 'delete' && (
        <SceneDeleteDialog
          onClose={() => setDialog(null)}
          onDeleted={() => router.refresh()}
          scene={dialog.scene}
        />
      )}
      {dialog?.kind === 'share' && (
        <SceneShareDialog
          onClose={() => setDialog(null)}
          onSaved={() => router.refresh()}
          scene={dialog.scene}
        />
      )}
      {dialog?.kind === 'backups' && (
        <SceneBackupsDialog
          onClose={() => setDialog(null)}
          onRestored={() => router.refresh()}
          scene={dialog.scene}
        />
      )}
      {dialog?.kind === 'preview' && (
        <ScenePreviewDialog onClose={() => setDialog(null)} scene={dialog.scene} />
      )}
    </>
  )
}
