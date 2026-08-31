import type { SceneGraph } from './clone-scene-graph'
import type { AnyNode, AnyNodeId } from '../schema'
import type { Collection, CollectionId } from '../schema/collections'
import type { SceneMaterial, SceneMaterialId } from '../schema/scene-material'
import useScene, { type SceneState } from '../store/use-scene'
import useLiveNodeOverrides from '../store/use-live-node-overrides'
import useLiveTransforms from '../store/use-live-transforms'
import {
  pauseSceneHistory,
  resumeSceneHistory,
  notifySceneCommit,
  areSceneSnapshotsEqual,
  type SceneSnapshot,
} from '../store/history-control'

export type SceneGraphLike = {
  nodes?: Record<string, any>
  rootNodeIds?: string[]
  collections?: Record<string, any>
  materials?: Record<string, any>
  installedPlugins?: string[]
}

export interface SceneGraphPatch {
  baseVersion?: number
  updatedNodes?: Record<string, AnyNode>
  createdNodes?: Record<string, AnyNode>
  deletedNodeIds?: string[]
  rootNodeIds?: string[]
  materials?: Record<string, SceneMaterial | null>
  collections?: Record<string, Collection | null>
  installedPlugins?: string[]
}

function areValuesShallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Computes a minimal JSON-serializable diff between two scene graphs.
 * Returns null if the graphs are identical.
 */
export function computeSceneGraphDiff(
  base: SceneGraphLike,
  target: SceneGraphLike,
  baseVersion?: number,
): SceneGraphPatch | null {

  const baseNodes = base.nodes ?? {}
  const targetNodes = target.nodes ?? {}

  const updatedNodes: Record<string, AnyNode> = {}
  const createdNodes: Record<string, AnyNode> = {}
  const deletedNodeIds: string[] = []

  let hasChanges = false

  // Check target nodes against base
  for (const [id, targetNode] of Object.entries(targetNodes)) {
    const baseNode = baseNodes[id as AnyNodeId]
    if (!baseNode) {
      createdNodes[id] = targetNode
      hasChanges = true
    } else if (!areValuesShallowEqual(baseNode, targetNode)) {
      updatedNodes[id] = targetNode
      hasChanges = true
    }
  }

  // Check deleted nodes
  for (const id of Object.keys(baseNodes)) {
    if (!targetNodes[id as AnyNodeId]) {
      deletedNodeIds.push(id)
      hasChanges = true
    }
  }

  // Check rootNodeIds
  let changedRootNodeIds: string[] | undefined
  const baseRoots = base.rootNodeIds ?? []
  const targetRoots = target.rootNodeIds ?? []
  if (
    baseRoots.length !== targetRoots.length ||
    baseRoots.some((id, idx) => id !== targetRoots[idx])
  ) {
    changedRootNodeIds = [...targetRoots]
    hasChanges = true
  }

  // Check materials
  let changedMaterials: Record<string, SceneMaterial | null> | undefined
  const baseMaterials = base.materials ?? {}
  const targetMaterials = target.materials ?? {}
  for (const [id, targetMat] of Object.entries(targetMaterials)) {
    const baseMat = baseMaterials[id as SceneMaterialId]
    if (!baseMat || !areValuesShallowEqual(baseMat, targetMat)) {
      if (!changedMaterials) changedMaterials = {}
      changedMaterials[id] = targetMat
      hasChanges = true
    }
  }
  for (const id of Object.keys(baseMaterials)) {
    if (!targetMaterials[id as SceneMaterialId]) {
      if (!changedMaterials) changedMaterials = {}
      changedMaterials[id] = null
      hasChanges = true
    }
  }

  // Check collections
  let changedCollections: Record<string, Collection | null> | undefined
  const baseCollections = base.collections ?? {}
  const targetCollections = target.collections ?? {}
  for (const [id, targetCol] of Object.entries(targetCollections)) {
    const baseCol = baseCollections[id as CollectionId]
    if (!baseCol || !areValuesShallowEqual(baseCol, targetCol)) {
      if (!changedCollections) changedCollections = {}
      changedCollections[id] = targetCol
      hasChanges = true
    }
  }
  for (const id of Object.keys(baseCollections)) {
    if (!targetCollections[id as CollectionId]) {
      if (!changedCollections) changedCollections = {}
      changedCollections[id] = null
      hasChanges = true
    }
  }

  // Check installed plugins
  let changedInstalledPlugins: string[] | undefined
  const basePlugins = base.installedPlugins ?? []
  const targetPlugins = target.installedPlugins ?? []
  if (
    basePlugins.length !== targetPlugins.length ||
    basePlugins.some((p, idx) => p !== targetPlugins[idx])
  ) {
    changedInstalledPlugins = [...targetPlugins]
    hasChanges = true
  }

  if (!hasChanges) return null

  const patch: SceneGraphPatch = {}
  if (baseVersion !== undefined) patch.baseVersion = baseVersion
  if (Object.keys(updatedNodes).length > 0) patch.updatedNodes = updatedNodes
  if (Object.keys(createdNodes).length > 0) patch.createdNodes = createdNodes
  if (deletedNodeIds.length > 0) patch.deletedNodeIds = deletedNodeIds
  if (changedRootNodeIds) patch.rootNodeIds = changedRootNodeIds
  if (changedMaterials) patch.materials = changedMaterials
  if (changedCollections) patch.collections = changedCollections
  if (changedInstalledPlugins) patch.installedPlugins = changedInstalledPlugins

  return patch
}

/**
 * Applies a SceneGraphPatch onto a base SceneGraph, producing a new SceneGraph.
 */
export function applySceneGraphPatch(base: SceneGraphLike, patch: SceneGraphPatch): SceneGraph {
  const nextNodes: Record<AnyNodeId, AnyNode> = { ...(base.nodes ?? {}) }


  if (patch.deletedNodeIds) {
    for (const id of patch.deletedNodeIds) {
      delete nextNodes[id as AnyNodeId]
    }
  }

  if (patch.createdNodes) {
    for (const [id, node] of Object.entries(patch.createdNodes)) {
      nextNodes[id as AnyNodeId] = node
    }
  }

  if (patch.updatedNodes) {
    for (const [id, node] of Object.entries(patch.updatedNodes)) {
      nextNodes[id as AnyNodeId] = node
    }
  }

  let computedRoots = patch.rootNodeIds ? [...patch.rootNodeIds] : [...(base.rootNodeIds ?? [])]
  if (patch.deletedNodeIds && patch.deletedNodeIds.length > 0) {
    const deletedSet = new Set(patch.deletedNodeIds)
    computedRoots = computedRoots.filter((rid) => !deletedSet.has(rid))
  }
  if (!patch.rootNodeIds && patch.createdNodes) {
    for (const [id, node] of Object.entries(patch.createdNodes)) {
      if ((node.parentId === null || node.parentId === undefined) && !computedRoots.includes(id)) {
        computedRoots.push(id)
      }
    }
  }
  const nextRootNodeIds: AnyNodeId[] = computedRoots as AnyNodeId[]

  let nextMaterials: Record<SceneMaterialId, SceneMaterial> | undefined
  if (patch.materials || base.materials) {
    nextMaterials = { ...(base.materials ?? {}) } as Record<SceneMaterialId, SceneMaterial>
    if (patch.materials) {
      for (const [id, mat] of Object.entries(patch.materials)) {
        if (mat === null) {
          delete nextMaterials[id as SceneMaterialId]
        } else {
          nextMaterials[id as SceneMaterialId] = mat
        }
      }
    }
  }

  let nextCollections: Record<CollectionId, Collection> | undefined
  if (patch.collections || base.collections) {
    nextCollections = { ...(base.collections ?? {}) } as Record<CollectionId, Collection>
    if (patch.collections) {
      for (const [id, col] of Object.entries(patch.collections)) {
        if (col === null) {
          delete nextCollections[id as CollectionId]
        } else {
          nextCollections[id as CollectionId] = col
        }
      }
    }
    if (patch.deletedNodeIds && patch.deletedNodeIds.length > 0) {
      const deletedSet = new Set(patch.deletedNodeIds)
      for (const [colId, col] of Object.entries(nextCollections)) {
        if (col && Array.isArray(col.nodeIds) && col.nodeIds.some((id) => deletedSet.has(id))) {
          nextCollections[colId as CollectionId] = {
            ...col,
            nodeIds: col.nodeIds.filter((id) => !deletedSet.has(id)),
          }
        }
      }
    }
  }

  const nextInstalledPlugins = patch.installedPlugins ?? base.installedPlugins

  return {
    nodes: nextNodes,
    rootNodeIds: nextRootNodeIds,
    ...(nextMaterials && { materials: nextMaterials }),
    ...(nextCollections && { collections: nextCollections }),
    ...(nextInstalledPlugins && { installedPlugins: [...nextInstalledPlugins] }),
  }
}

/**
 * Directly and granularly applies a SceneGraphPatch to the active zustand scene store.
 * Only touches modified nodes, avoids full scene teardowns, preserves undo history,
 * and executes in sub-millisecond time.
 */
export function applySceneGraphPatchToStore(patch: SceneGraphPatch): boolean {
  const state = useScene.getState()
  const currentNodes = state.nodes ?? {}

  const hasNodeChanges =
    (patch.updatedNodes && Object.keys(patch.updatedNodes).length > 0) ||
    (patch.createdNodes && Object.keys(patch.createdNodes).length > 0) ||
    (patch.deletedNodeIds && patch.deletedNodeIds.length > 0)

  const hasRootChanges = Boolean(patch.rootNodeIds)
  const hasMaterialChanges = Boolean(patch.materials && Object.keys(patch.materials).length > 0)
  const hasCollectionChanges = Boolean(patch.collections && Object.keys(patch.collections).length > 0)
  const hasPluginChanges = Boolean(patch.installedPlugins)

  if (!hasNodeChanges && !hasRootChanges && !hasMaterialChanges && !hasCollectionChanges && !hasPluginChanges) {
    return false
  }

  const nextNodes: Record<AnyNodeId, AnyNode> = { ...currentNodes }
  const dirtyIds = new Set<AnyNodeId>()

  if (patch.deletedNodeIds) {
    for (const id of patch.deletedNodeIds) {
      const existing = nextNodes[id as AnyNodeId]
      if (existing?.parentId) dirtyIds.add(existing.parentId as AnyNodeId)
      delete nextNodes[id as AnyNodeId]
      state.clearDirty(id as AnyNodeId)
      useLiveNodeOverrides.getState().clear(id)
      useLiveTransforms.getState().clear(id)
    }
  }

  if (patch.createdNodes) {
    for (const [id, node] of Object.entries(patch.createdNodes)) {
      nextNodes[id as AnyNodeId] = node
      dirtyIds.add(id as AnyNodeId)
      if (node.parentId) dirtyIds.add(node.parentId as AnyNodeId)
      useLiveNodeOverrides.getState().clear(id)
      useLiveTransforms.getState().clear(id)
    }
  }

  if (patch.updatedNodes) {
    for (const [id, node] of Object.entries(patch.updatedNodes)) {
      nextNodes[id as AnyNodeId] = node
      dirtyIds.add(id as AnyNodeId)
      if (node.parentId) dirtyIds.add(node.parentId as AnyNodeId)
      const prev = currentNodes[id as AnyNodeId]
      if (prev?.parentId && prev.parentId !== node.parentId) {
        dirtyIds.add(prev.parentId as AnyNodeId)
      }
      useLiveNodeOverrides.getState().clear(id)
      useLiveTransforms.getState().clear(id)
    }
  }

  let computedRoots = patch.rootNodeIds ? [...patch.rootNodeIds] : [...state.rootNodeIds]
  if (patch.deletedNodeIds && patch.deletedNodeIds.length > 0) {
    const deletedSet = new Set(patch.deletedNodeIds)
    computedRoots = computedRoots.filter((rid) => !deletedSet.has(rid))
  }
  if (!patch.rootNodeIds && patch.createdNodes) {
    for (const [id, node] of Object.entries(patch.createdNodes)) {
      if ((node.parentId === null || node.parentId === undefined) && !computedRoots.includes(id)) {
        computedRoots.push(id)
      }
    }
  }
  const nextRootNodeIds: AnyNodeId[] = computedRoots as AnyNodeId[]

  let nextMaterials = state.materials
  if (patch.materials) {
    nextMaterials = { ...state.materials }
    const changedMatIds = new Set(Object.keys(patch.materials))
    for (const [id, mat] of Object.entries(patch.materials)) {
      if (mat === null) {
        delete nextMaterials[id as SceneMaterialId]
      } else {
        nextMaterials[id as SceneMaterialId] = mat
      }
    }
    for (const [id, node] of Object.entries(nextNodes)) {
      const slots = (node as any)?.slots
      if (slots && typeof slots === 'object') {
        for (const ref of Object.values(slots)) {
          if (typeof ref === 'string' && changedMatIds.has(ref)) {
            dirtyIds.add(id as AnyNodeId)
          }
        }
      }
    }
  }

  let nextCollections = state.collections
  if (patch.collections || (patch.deletedNodeIds && patch.deletedNodeIds.length > 0)) {
    nextCollections = { ...state.collections }
    if (patch.collections) {
      for (const [id, col] of Object.entries(patch.collections)) {
        if (col === null) {
          delete nextCollections[id as CollectionId]
        } else {
          nextCollections[id as CollectionId] = col
        }
      }
    }
    if (patch.deletedNodeIds && patch.deletedNodeIds.length > 0) {
      const deletedSet = new Set(patch.deletedNodeIds)
      for (const [colId, col] of Object.entries(nextCollections)) {
        if (col && Array.isArray(col.nodeIds) && col.nodeIds.some((id) => deletedSet.has(id))) {
          nextCollections[colId as CollectionId] = {
            ...col,
            nodeIds: col.nodeIds.filter((id) => !deletedSet.has(id)),
          }
        }
      }
    }
  }

  const nextInstalledPlugins = patch.installedPlugins
    ? Array.from(new Set(patch.installedPlugins))
    : state.installedPlugins

  const beforeSnapshot: SceneSnapshot = {
    nodes: state.nodes,
    rootNodeIds: state.rootNodeIds,
    collections: state.collections,
    materials: state.materials,
    installedPlugins: state.installedPlugins,
  }

  const afterSnapshot: SceneSnapshot = {
    nodes: nextNodes,
    rootNodeIds: nextRootNodeIds,
    collections: nextCollections,
    materials: nextMaterials,
    installedPlugins: nextInstalledPlugins,
  }

  if (areSceneSnapshotsEqual(beforeSnapshot, afterSnapshot)) {
    return false
  }

  pauseSceneHistory(useScene)
  try {
    useScene.setState({
      nodes: nextNodes,
      rootNodeIds: nextRootNodeIds,
      materials: nextMaterials,
      collections: nextCollections,
      installedPlugins: nextInstalledPlugins,
    })
  } finally {
    resumeSceneHistory(useScene)
  }

  for (const id of dirtyIds) {
    if (nextNodes[id]) state.markDirty(id)
  }

  notifySceneCommit({
    origin: 'host',
    before: beforeSnapshot,
    current: afterSnapshot,
  })

  return true
}
