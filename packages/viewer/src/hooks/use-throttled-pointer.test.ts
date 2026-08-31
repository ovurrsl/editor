import { describe, expect, test } from 'bun:test'
import { Ray, Vector3 } from 'three'
import {
  createThrottledPointerMoveHandler,
  getMeshWorldInverseMatrix,
  getTriangleNormalDirect,
  intersectTriangleDirect,
} from '../index'
import { Mesh, BoxGeometry, MeshBasicMaterial } from 'three'

describe('useThrottledPointer & Throttled Pointer Helpers', () => {
  test('createThrottledPointerMoveHandler coalesces multiple rapid pointer moves into a single frame tick', async () => {
    let callCount = 0
    let lastHandledEvent: { clientX: number; clientY: number } | null = null

    const throttler = createThrottledPointerMoveHandler<{ clientX: number; clientY: number }>(
      (event) => {
        callCount++
        lastHandledEvent = event
      },
    )

    // Simulate high-frequency 1000Hz gaming mouse pointermove burst
    throttler.handlePointerMove({ clientX: 10, clientY: 20 })
    throttler.handlePointerMove({ clientX: 15, clientY: 25 })
    throttler.handlePointerMove({ clientX: 20, clientY: 30 })
    throttler.handlePointerMove({ clientX: 25, clientY: 35 })
    throttler.handlePointerMove({ clientX: 30, clientY: 40 })

    // Before RAF ticks, handler has not fired synchronously
    expect(callCount).toBe(0)

    // Flush immediately (simulating frame tick or pointerdown/up)
    throttler.flush()

    expect(callCount).toBe(1)
    expect(lastHandledEvent).toEqual({ clientX: 30, clientY: 40 })
  })

  test('createThrottledPointerMoveHandler cancel drops pending updates', () => {
    let callCount = 0
    const throttler = createThrottledPointerMoveHandler((_event) => {
      callCount++
    })

    throttler.handlePointerMove({ clientX: 10, clientY: 20 })
    throttler.cancel()
    throttler.flush()

    expect(callCount).toBe(0)
  })
})

describe('Direct Typed Buffer Raycasting & Inverse Matrix Caching', () => {
  test('intersectTriangleDirect computes accurate Möller–Trumbore intersection without allocations', () => {
    // Triangle: (0, 0, 0), (2, 0, 0), (0, 2, 0)
    const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0])

    const ray = new Ray(new Vector3(0.5, 0.5, 5), new Vector3(0, 0, -1))
    const target = new Vector3()

    const hit = intersectTriangleDirect(ray, positions, 0, 1, 2, true, target)
    expect(hit).not.toBeNull()
    expect(hit?.x).toBeCloseTo(0.5, 5)
    expect(hit?.y).toBeCloseTo(0.5, 5)
    expect(hit?.z).toBeCloseTo(0, 5)
  })

  test('intersectTriangleDirect returns null on miss or parallel rays', () => {
    const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0])

    // Ray that misses the triangle bounds
    const rayMiss = new Ray(new Vector3(5, 5, 5), new Vector3(0, 0, -1))
    const target = new Vector3()
    expect(intersectTriangleDirect(rayMiss, positions, 0, 1, 2, true, target)).toBeNull()

    // Ray parallel to triangle
    const rayParallel = new Ray(new Vector3(0.5, 0.5, 5), new Vector3(1, 0, 0))
    expect(intersectTriangleDirect(rayParallel, positions, 0, 1, 2, true, target)).toBeNull()
  })

  test('getTriangleNormalDirect calculates exact surface normal via direct buffer stride', () => {
    // XY plane triangle with normal pointing +Z: (0, 0, 0), (1, 0, 0), (0, 1, 0)
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const normal = new Vector3()

    getTriangleNormalDirect(positions, 0, 1, 2, normal)
    expect(normal.x).toBeCloseTo(0, 5)
    expect(normal.y).toBeCloseTo(0, 5)
    expect(normal.z).toBeCloseTo(1, 5)
  })

  test('getMeshWorldInverseMatrix caches inverse matrix and recomputes only on matrix version change', () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    mesh.position.set(10, 20, 30)
    mesh.updateMatrixWorld(true)

    const inv1 = getMeshWorldInverseMatrix(mesh)
    expect(inv1).toBeDefined()

    // Calling again returns the exact same cached instance without recomputing
    const inv2 = getMeshWorldInverseMatrix(mesh)
    expect(inv2).toBe(inv1)

    // Transforming point using cached inverse
    const p = new Vector3(10, 20, 30).applyMatrix4(inv1)
    expect(p.x).toBeCloseTo(0, 4)
    expect(p.y).toBeCloseTo(0, 4)
    expect(p.z).toBeCloseTo(0, 4)
  })
})
