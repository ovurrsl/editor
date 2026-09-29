'use client'

import { type AnyNodeId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/editor'
import { BookMarked } from 'lucide-react'
import { useCallback } from 'react'
import { useAuth } from '../lib/auth/hooks'
import {
  type PresetData,
  PresetsPopover,
  type PresetsTab,
  type PresetType,
} from './presets-popover'

// Identity, placement and per-instance documentation stay with the node; every
// other field describes the door/window design and travels with the preset.
const INSTANCE_KEYS = new Set([
  'object',
  'id',
  'type',
  'name',
  'parentId',
  'visible',
  'camera',
  'metadata',
  'children',
  'position',
  'rotation',
  'side',
  'wallId',
  'roofSegmentId',
  'roofFace',
  'mark',
  'operationState',
])

function presetDataFromNode(node: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).filter(([key]) => !INSTANCE_KEYS.has(key)))
}

async function readJson<T>(response: Response): Promise<T | null> {
  return response.ok ? ((await response.json()) as T) : null
}

/**
 * Door/window presets (feat/roof): mounted in the editor's inspector footer,
 * shown while a single door or window is selected.
 */
export function DoorWindowPresets() {
  const { isAuthenticated } = useAuth()
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : undefined
  const node = useScene((state) =>
    selectedId
      ? (state.nodes[selectedId as AnyNodeId] as Record<string, unknown> | undefined)
      : undefined,
  )
  const type = node?.type === 'door' || node?.type === 'window' ? (node.type as PresetType) : null

  const fetchPresets = useCallback(
    async (tab: PresetsTab) => {
      if (!type) return []
      const json = await readJson<{ presets: PresetData[] }>(
        await fetch(`/api/presets?type=${type}&tab=${tab}`),
      )
      return json?.presets ?? []
    },
    [type],
  )

  const applyPreset = useCallback(
    (data: Record<string, unknown>) => {
      if (!selectedId) return
      useScene.getState().updateNode(selectedId as AnyNodeId, data)
    },
    [selectedId],
  )

  const savePreset = useCallback(
    async (name: string) => {
      if (!(type && node)) return
      await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name, data: presetDataFromNode(node) }),
      })
    },
    [type, node],
  )

  const updatePreset = useCallback(async (id: string, body: Record<string, unknown>) => {
    await fetch(`/api/presets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }, [])

  if (!(type && node)) return null

  return (
    <div className="border-border/30 border-t px-3 py-2">
      <PresetsPopover
        isAuthenticated={isAuthenticated}
        onApply={applyPreset}
        onDelete={async (id) => {
          await fetch(`/api/presets/${id}`, { method: 'DELETE' })
        }}
        onFetchPresets={fetchPresets}
        onOverwrite={(id) => updatePreset(id, { data: presetDataFromNode(node) })}
        onRename={(id, name) => updatePreset(id, { name })}
        onSave={savePreset}
        onToggleCommunity={(id, current) => updatePreset(id, { is_community: !current })}
        type={type}
      >
        <button
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          type="button"
        >
          <BookMarked className="h-4 w-4" />
          <span>{type === 'door' ? 'Door presets' : 'Window presets'}</span>
        </button>
      </PresetsPopover>
    </div>
  )
}
