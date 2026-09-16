/**
 * Analytical bounding box computation for the floorplan view.
 * Inspects positioned nodes, wall/fence endpoints (start & end), and slab/zone/ceiling polygon vertices.
 */
export function computeFloorplanAnalyticalBounds(
  nodes: Record<string, unknown> | unknown[],
): {
  x: number
  y: number
  width: number
  height: number
} | null {
  const list = Array.isArray(nodes) ? nodes : Object.values(nodes)
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (const node of list) {
    if (!node || typeof node !== 'object') continue
    const anyNode = node as Record<string, unknown>

    // WallNode / FenceNode: start & end coordinates
    const start = anyNode.start
    const end = anyNode.end
    if (Array.isArray(start) && Array.isArray(end) && start.length >= 2 && end.length >= 2) {
      const x1 = Number(start[0])
      const z1 = Number(start[1])
      const x2 = Number(end[0])
      const z2 = Number(end[1])
      if (Number.isFinite(x1) && Number.isFinite(z1)) {
        minX = Math.min(minX, x1)
        maxX = Math.max(maxX, x1)
        minZ = Math.min(minZ, z1)
        maxZ = Math.max(maxZ, z1)
      }
      if (Number.isFinite(x2) && Number.isFinite(z2)) {
        minX = Math.min(minX, x2)
        maxX = Math.max(maxX, x2)
        minZ = Math.min(minZ, z2)
        maxZ = Math.max(maxZ, z2)
      }
      continue
    }

    // SlabNode / ZoneNode / CeilingNode: polygon boundary coordinates
    const polygon = anyNode.polygon
    if (Array.isArray(polygon)) {
      for (const pt of polygon) {
        if (Array.isArray(pt) && pt.length >= 2) {
          const px = Number(pt[0])
          const pz = Number(pt[1])
          if (Number.isFinite(px) && Number.isFinite(pz)) {
            minX = Math.min(minX, px)
            maxX = Math.max(maxX, px)
            minZ = Math.min(minZ, pz)
            maxZ = Math.max(maxZ, pz)
          }
        }
      }
      continue
    }

    // Positioned nodes: item, building, column, etc.
    if ('position' in anyNode && anyNode.position && Array.isArray(anyNode.position)) {
      const pos = anyNode.position as unknown[]
      const x = Number(pos[0]) || 0
      const z = Number(pos[2]) || 0
      const w = Number(anyNode.width) || 10
      const l = Number(anyNode.length) || 10
      minX = Math.min(minX, x - w / 2)
      maxX = Math.max(maxX, x + w / 2)
      minZ = Math.min(minZ, z - l / 2)
      maxZ = Math.max(maxZ, z + l / 2)
    }
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minZ) ||
    !Number.isFinite(maxZ)
  ) {
    return null
  }

  return {
    x: minX,
    y: minZ,
    width: maxX - minX,
    height: maxZ - minZ,
  }
}
