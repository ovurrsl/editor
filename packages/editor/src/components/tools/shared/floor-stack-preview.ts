import {
  type AnyNode,
  type AnyNodeId,
  getFloorStackedPosition,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

type FloorStackPreviewArgs = {
  node: AnyNode
  position: [number, number, number]
  rotation?: unknown
  levelId?: string | null
  nodes?: Record<AnyNodeId, AnyNode>
  /** Pointer-decided support cap — see `FloorPlacedElevationArgs.maxElevation`. */
  maxElevation?: number | null
}

/**
 * Y of the storey a floor-placed preview belongs to, measured in the frame
 * `ToolManager`'s group renders in (building-local).
 *
 * Read off the level's Object3D rather than recomputed from the scene, because
 * `LevelSystem` owns that number: it lerps toward the storey base plus the
 * exploded-view gap. Reading the object is what makes a ghost ride the explode
 * animation instead of snapping to its end state, and it is the same source
 * `Grid` puts its raycast plane at — so cursor and ghost agree by construction.
 *
 * Level resolution mirrors `getFloorPlacedElevation`: the node's own storey
 * first, the caller's hint second. The active selection is the last resort, for
 * a draft that has not been parented yet.
 */
export function getStoreyPreviewLift(levelId?: string | null): number {
  const resolved = levelId ?? useViewer.getState().selection.levelId ?? null
  if (!resolved) return 0
  return sceneRegistry.nodes.get(resolved)?.position.y ?? 0
}

function storeyLift(
  node: AnyNode,
  levelId: string | null | undefined,
  nodes: Record<AnyNodeId, AnyNode>,
): number {
  const parentId = (node as { parentId?: AnyNodeId | null }).parentId ?? null
  const parent = parentId ? nodes[parentId] : null
  return getStoreyPreviewLift(parent?.type === 'level' ? parent.id : levelId)
}

/**
 * Where to draw the ghost of a floor-placed node, in the tool group's frame.
 *
 * Two different frames meet here. `getFloorStackedPosition` answers in the
 * node's own frame — level-local, the number that gets committed, measured from
 * the storey base — while every tool visual is rendered inside `ToolManager`'s
 * building-local group. On a scene whose active storey is not at 0 (a basement
 * below it, or an upper floor) the difference is the storey elevation, and the
 * ghost is drawn that far below the cursor while the click still places
 * correctly: the committed node is re-parented under the level, which hands the
 * elevation back. So the preview lied, not the placement — which is exactly why
 * it went unnoticed until a scene with a basement showed up.
 *
 * Callers that need the committed value want `getFloorStackedPosition` from
 * core; this one is only ever correct as a visual.
 */
export function getFloorStackPreviewPosition({
  node,
  position,
  rotation,
  levelId,
  nodes,
  maxElevation,
}: FloorStackPreviewArgs): [number, number, number] {
  const resolvedNodes = nodes ?? useScene.getState().nodes
  const [x, y, z] = getFloorStackedPosition({
    node,
    nodes: resolvedNodes,
    position,
    rotation,
    levelId,
    maxElevation,
  })
  return [x, y + storeyLift(node, levelId, resolvedNodes), z]
}
