'use client'

import { useScene, emitter } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { exportSceneToGlb, nextFrames } from '../../lib/glb-export'

export function GlbAutoSync({
  sceneId,
  onSyncComplete,
}: {
  sceneId?: string
  onSyncComplete?: (result: any) => void
}) {
  const scene = useThree((s) => s.scene)
  const isSyncingRef = useRef(false)

  useEffect(() => {
    const handleTriggerSync = async (event?: { sceneId?: string; graph?: any }) => {
      const targetId = event?.sceneId || sceneId
      if (!targetId || isSyncingRef.current) return

      isSyncingRef.current = true
      try {
        useViewer.getState().setExporting(true)
        await nextFrames()
        const sceneGroup = scene.getObjectByName('scene-renderer')
        if (!sceneGroup) {
          console.warn('[glb-auto-sync] scene-renderer group not found')
          return
        }

        const nodes = event?.graph?.nodes || useScene.getState().nodes
        const buffer = await exportSceneToGlb(sceneGroup, nodes, {
          textures: 'reference',
        })

        const formData = new FormData()
        formData.append('glb', new Blob([buffer], { type: 'model/gltf-binary' }), `model_${targetId}.glb`)
        formData.append('layout', JSON.stringify({ nodes }))

        const res = await fetch(`/api/scenes/${encodeURIComponent(targetId)}/assets`, {
          method: 'POST',
          body: formData,
        })

        if (res.ok) {
          const data = await res.json()
          console.log(`[glb-auto-sync] 🚀 GLB & Layout auto-synced for scene ${targetId}:`, data)
          onSyncComplete?.(data)
        } else {
          console.warn(`[glb-auto-sync] Failed to sync assets (${res.status})`)
        }
      } catch (err) {
        console.warn('[glb-auto-sync] Error during auto GLB sync:', err)
      } finally {
        useViewer.getState().setExporting(false)
        isSyncingRef.current = false
      }
    }

    emitter.on('scene:auto-sync-assets' as any, handleTriggerSync as any)
    return () => emitter.off('scene:auto-sync-assets' as any, handleTriggerSync as any)
  }, [scene, sceneId, onSyncComplete])

  return null
}
