import { type BufferGeometry, DoubleSide, FrontSide, Matrix4, Mesh, Object3D, Ray, type Raycaster, Sphere, Vector3 } from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVH } from 'three-mesh-bvh'

export type SceneBvhMaintainerOptions = {
  /** three-mesh-bvh build options, passed through to `computeBoundsTree`. */
  bvh?: Record<string, unknown>
  /**
   * Frames between scene scans while the build queue is empty. The scan is a
   * full traverse, so it is throttled; newly added geometry waits at most
   * this many frames before entering the queue (raycasts against it fall
   * back to plain triangle tests until then, which is correct, just slower).
   */
  scanInterval?: number
  /** Per-step build budget in milliseconds. See `step` for the guarantee. */
  budgetMs?: number
  /** Injectable clock for tests. */
  now?: () => number
}

export type SceneBvhMaintainer = {
  /**
   * One maintenance pass, meant to run every frame. Scans for new work every
   * `scanInterval` frames, then builds queued BVHs until `budgetMs` is
   * spent — but always at least one build when the queue is non-empty, so a
   * single oversized geometry cannot starve the queue forever.
   */
  step(): void
  /** Restore stock raycast functions and free every tree still in the scene. */
  dispose(): void
}

const isMesh = (object: unknown): object is Mesh =>
  !!object && typeof object === 'object' && (object as Mesh).isMesh === true

export const isSceneBvhExcluded = (object: Mesh) => object.userData.excludeFromBvh === true

const hasBvhCompatibleGeometry = (geometry?: BufferGeometry | null) => {
  if (!geometry) return false
  const position = geometry.getAttribute('position')
  if (!position) return false
  const vertexCount = geometry.getIndex()?.count ?? position.count
  return vertexCount >= 3
}

// Module-level static math registers for raycasting and bounds culling (Zero-Allocation)
const _sphere = new Sphere()
const _ray = new Ray()
const _direction = new Vector3()
const _worldScale = new Vector3()

function ensureObject3DVersionTracked(mesh: Object3D): void {
  let proto = Object.getPrototypeOf(mesh)
  while (proto && proto !== Object.prototype) {
    if (typeof proto.updateMatrixWorld === 'function' && !proto._isVersionTracked) {
      const origUpdateMatrixWorld = proto.updateMatrixWorld
      proto.updateMatrixWorld = function (force?: boolean) {
        origUpdateMatrixWorld.call(this, force)
        if (this.matrixWorld) {
          this.matrixWorld._v = (this.matrixWorld._v ?? 0) + 1
        }
      }
      const origUpdateWorldMatrix = proto.updateWorldMatrix
      if (typeof origUpdateWorldMatrix === 'function') {
        proto.updateWorldMatrix = function (updateParents?: boolean, updateChildren?: boolean) {
          origUpdateWorldMatrix.call(this, updateParents, updateChildren)
          if (this.matrixWorld) {
            this.matrixWorld._v = (this.matrixWorld._v ?? 0) + 1
          }
        }
      }
      proto._isVersionTracked = true
    }
    proto = Object.getPrototypeOf(proto)
  }
}

/**
 * Returns a cached inverse world matrix for an Object3D/Mesh.
 * Recalculates whenever `matrixWorld` changes (tracked via zero-overhead internal version counter
 * with zero-allocation Float64Array elements comparison fallback), eliminating redundant
 * `Matrix4.invert` calls across high-frequency raycasting while guaranteeing
 * that dynamic moving meshes receive fresh, accurate inverse matrices.
 */
export function getMeshWorldInverseMatrix(mesh: Object3D): Matrix4 {
  let inv = (mesh as any)._worldInverseMatrix as (Matrix4 & { _v?: number; _c?: Float64Array }) | undefined
  if (!inv) {
    inv = new Matrix4() as Matrix4 & { _v?: number; _c?: Float64Array }
    inv._v = -1
    ;(mesh as any)._worldInverseMatrix = inv
    ensureObject3DVersionTracked(mesh)
    if ((mesh.matrixWorld as any)._v === undefined) {
      ;(mesh.matrixWorld as any)._v = 0
    }
  }

  const mw = mesh.matrixWorld
  const ver = (mw as any)._v
  if (typeof ver === 'number') {
    if (inv._v !== ver) {
      inv.copy(mw).invert()
      inv._v = ver
    }
    return inv
  }

  if (!inv._c) {
    inv._c = new Float64Array(16)
    inv._c[0] = Number.NaN
  }
  const c = inv._c
  const e = mw.elements
  if (
    c[12] !== e[12] ||
    c[13] !== e[13] ||
    c[14] !== e[14] ||
    c[0] !== e[0] ||
    c[5] !== e[5] ||
    c[10] !== e[10] ||
    c[1] !== e[1] ||
    c[2] !== e[2] ||
    c[4] !== e[4] ||
    c[6] !== e[6] ||
    c[8] !== e[8] ||
    c[9] !== e[9] ||
    c[15] !== e[15] ||
    c[3] !== e[3] ||
    c[7] !== e[7] ||
    c[11] !== e[11]
  ) {
    for (let i = 0; i < 16; i++) {
      c[i] = e[i]!
    }
    inv.copy(mw).invert()
  }
  return inv
}

/**
 * Direct Float32Array strided ray-triangle intersection (Möller–Trumbore algorithm).
 * Completely eliminates BufferAttribute.getX/getY/getZ and Vector3 instantiations in hot loops.
 * Hardened with explicit NaN and non-finite numeric bounds guards.
 */
export function intersectTriangleDirect(
  ray: Ray,
  positions: Float32Array,
  i0: number,
  i1: number,
  i2: number,
  backfaceCulling: boolean,
  target: Vector3,
): Vector3 | null {
  const i0x = i0 * 3
  const i1x = i1 * 3
  const i2x = i2 * 3

  const aX = positions[i0x]!, aY = positions[i0x + 1]!, aZ = positions[i0x + 2]!
  const bX = positions[i1x]!, bY = positions[i1x + 1]!, bZ = positions[i1x + 2]!
  const cX = positions[i2x]!, cY = positions[i2x + 1]!, cZ = positions[i2x + 2]!

  const edge1X = bX - aX, edge1Y = bY - aY, edge1Z = bZ - aZ
  const edge2X = cX - aX, edge2Y = cY - aY, edge2Z = cZ - aZ

  const dir = ray.direction
  const orig = ray.origin

  // pvec = dir × edge2
  const pvecX = dir.y * edge2Z - dir.z * edge2Y
  const pvecY = dir.z * edge2X - dir.x * edge2Z
  const pvecZ = dir.x * edge2Y - dir.y * edge2X

  const det = edge1X * pvecX + edge1Y * pvecY + edge1Z * pvecZ

  if (backfaceCulling) {
    if (!(det >= 1e-7)) return null
  } else {
    if (!(det >= 1e-7 || det <= -1e-7)) return null
  }

  const invDet = 1.0 / det
  const tvecX = orig.x - aX, tvecY = orig.y - aY, tvecZ = orig.z - aZ

  const u = (tvecX * pvecX + tvecY * pvecY + tvecZ * pvecZ) * invDet
  if (!(u >= 0 && u <= 1)) return null

  // qvec = tvec × edge1
  const qvecX = tvecY * edge1Z - tvecZ * edge1Y
  const qvecY = tvecZ * edge1X - tvecX * edge1Z
  const qvecZ = tvecX * edge1Y - tvecY * edge1X

  const v = (dir.x * qvecX + dir.y * qvecY + dir.z * qvecZ) * invDet
  if (!(v >= 0 && u + v <= 1)) return null

  const t = (edge2X * qvecX + edge2Y * qvecY + edge2Z * qvecZ) * invDet
  if (!(t >= 1e-7 && Number.isFinite(t))) return null

  return target.copy(ray.direction).multiplyScalar(t).add(ray.origin)
}

/**
 * Direct Float32Array strided normal calculation for a triangle without object allocations.
 */
export function getTriangleNormalDirect(
  positions: Float32Array,
  i0: number,
  i1: number,
  i2: number,
  target: Vector3,
): Vector3 {
  const i0x = i0 * 3
  const i1x = i1 * 3
  const i2x = i2 * 3

  const ax = positions[i0x]!, ay = positions[i0x + 1]!, az = positions[i0x + 2]!
  const bx = positions[i1x]!, by = positions[i1x + 1]!, bz = positions[i1x + 2]!
  const cx = positions[i2x]!, cy = positions[i2x + 1]!, cz = positions[i2x + 2]!

  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az

  const nx = aby * acz - abz * acy
  const ny = abz * acx - abx * acz
  const nz = abx * acy - aby * acx

  const len = Math.hypot(nx, ny, nz)
  if (len > 1e-10 && Number.isFinite(len)) {
    return target.set(nx / len, ny / len, nz / len)
  }
  return target.set(0, 1, 0)
}

// Enhance MeshBVH.prototype.raycastObject3D with inverse world matrix caching and bounding sphere culling
if (typeof MeshBVH !== 'undefined' && MeshBVH.prototype) {
  const origRaycastObject3D = MeshBVH.prototype.raycastObject3D
  if (!(origRaycastObject3D as any)._isOptimized) {
    MeshBVH.prototype.raycastObject3D = function (object: any, raycaster: any, intersects: any = []) {
      const { geometry, material } = object
      if (material === undefined) return intersects

      // Pre-cull using geometry boundingSphere in world coordinates
      if (geometry) {
        if (geometry.boundingSphere === null) {
          geometry.computeBoundingSphere()
        }
        if (geometry.boundingSphere) {
          _sphere.copy(geometry.boundingSphere).applyMatrix4(object.matrixWorld)
          if (!raycaster.ray.intersectsSphere(_sphere)) {
            return intersects
          }
        }
      }

      // Use cached inverse world matrix instead of Matrix4.invert on every raycast
      const inverseMatrix = getMeshWorldInverseMatrix(object)
      _ray.copy(raycaster.ray).applyMatrix4(inverseMatrix)

      _worldScale.setFromMatrixScale(object.matrixWorld)
      _direction.copy(_ray.direction).multiply(_worldScale)

      const scaleFactor = _direction.length()
      const near = raycaster.near / scaleFactor
      const far = raycaster.far / scaleFactor

      if (raycaster.firstHitOnly === true) {
        const hit = (this as any).raycastFirst(_ray, material, near, far)
        if (hit) {
          hit.point.applyMatrix4(object.matrixWorld)
          hit.distance = hit.point.distanceTo(raycaster.ray.origin)
          hit.object = object
          if (hit.distance >= raycaster.near && hit.distance <= raycaster.far) {
            intersects.push(hit)
          }
        }
      } else {
        const hits = (this as any).raycast(_ray, material, near, far)
        for (let i = 0, l = hits.length; i < l; i++) {
          const hit = hits[i]
          hit.point.applyMatrix4(object.matrixWorld)
          hit.distance = hit.point.distanceTo(raycaster.ray.origin)
          hit.object = object
          if (hit.distance >= raycaster.near && hit.distance <= raycaster.far) {
            intersects.push(hit)
          }
        }
      }

      return intersects
    }
    ;(MeshBVH.prototype.raycastObject3D as any)._isOptimized = true
  }
}

/**
 * Keeps every raycastable mesh under `root` BVH-indexed as the scene changes.
 *
 * The one-shot predecessor traversed once, on mount — when the scene was
 * still empty, because renderers populate it over the following frames — so
 * it indexed nothing, and every later geometry swap (each wall edit replaces
 * its mesh's geometry) shed whatever index existed. Result: every pointer
 * move brute-forced millions of triangles. "Run once, later" cannot fix
 * that; the scene never stops changing. This maintainer re-scans on a cheap
 * cadence and builds under a frame budget instead.
 *
 * Memory: no strong registries of meshes or geometries are kept — a swapped
 * -out geometry dies with its last reference, tree attached. `dispose`
 * frees what is still reachable from `root`; anything already detached is
 * the GC's, same as before.
 */
export function createSceneBvhMaintainer(
  root: Object3D,
  {
    bvh = {},
    scanInterval = 15,
    budgetMs = 4,
    now = () => performance.now(),
  }: SceneBvhMaintainerOptions = {},
): SceneBvhMaintainer {
  const queue: Array<{ geometry: BufferGeometry; label: string }> = []
  // Guards against re-queueing while queued, and against retrying a build
  // that threw — a geometry that failed once will fail every frame, and the
  // console.warn storm would be worse than the missing index.
  const pending = new WeakSet<BufferGeometry>()
  const failed = new WeakSet<BufferGeometry>()
  let framesSinceScan = Number.POSITIVE_INFINITY // first step always scans

  const scan = () => {
    root.traverse((child) => {
      if (!isMesh(child)) return
      if (isSceneBvhExcluded(child)) return

      if (child.raycast === Mesh.prototype.raycast) {
        child.raycast = acceleratedRaycast
      }
      if (child.raycast !== acceleratedRaycast) return

      const geometry = child.geometry
      if (geometry.boundsTree || pending.has(geometry) || failed.has(geometry)) return
      if (!hasBvhCompatibleGeometry(geometry)) return

      pending.add(geometry)
      queue.push({ geometry, label: child.name || child.type })
    })
  }

  const build = (entry: { geometry: BufferGeometry; label: string }) => {
    const { geometry } = entry
    pending.delete(geometry)
    // The scene may have moved on while this sat in the queue.
    if (geometry.boundsTree || !hasBvhCompatibleGeometry(geometry)) return
    try {
      // three-mesh-bvh's helpers vs @types/three disagree on option/class
      // identity — cast through the structural mismatch; runtime is fine.
      ;(geometry as { computeBoundsTree?: unknown }).computeBoundsTree =
        computeBoundsTree as unknown as typeof geometry.computeBoundsTree
      ;(geometry as { disposeBoundsTree?: unknown }).disposeBoundsTree =
        disposeBoundsTree as unknown as typeof geometry.disposeBoundsTree
      geometry.computeBoundsTree(bvh)
    } catch (error) {
      failed.add(geometry)
      console.warn('[viewer] Skipping BVH for incompatible mesh geometry.', {
        mesh: entry.label,
        error,
      })
    }
  }

  return {
    step() {
      framesSinceScan += 1
      if (queue.length === 0) {
        if (framesSinceScan < scanInterval) return
        framesSinceScan = 0
        scan()
      }

      const deadline = now() + budgetMs
      while (queue.length > 0) {
        const entry = queue.shift()
        if (entry) build(entry)
        if (now() >= deadline) break
      }
    },
    dispose() {
      root.traverse((child) => {
        if (!isMesh(child)) return
        if (child.raycast === acceleratedRaycast) {
          child.raycast = Mesh.prototype.raycast
        }
        const geometry = child.geometry
        if (geometry?.boundsTree) {
          // The helper is attached at build time; a tree computed by someone
          // else may not carry it. Dropping the reference is the same
          // operation — a MeshBVH holds no GPU resources.
          if (typeof geometry.disposeBoundsTree === 'function') geometry.disposeBoundsTree()
          else geometry.boundsTree = undefined
        }
      })
      queue.length = 0
    },
  }
}
