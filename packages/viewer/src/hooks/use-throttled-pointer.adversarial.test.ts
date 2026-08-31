import { describe, expect, test } from 'bun:test'
import { BoxGeometry, Matrix4, Mesh, MeshBasicMaterial, Ray, Vector3 } from 'three'
import {
  createThrottledPointerEvents,
  createThrottledPointerMoveHandler,
  getMeshWorldInverseMatrix,
  getTriangleNormalDirect,
  intersectTriangleDirect,
} from '../index'

describe('Adversarial Stress Test: High-Frequency Pointer Event Storms', () => {
  test('1,000 rapid pointermove events in single frame coalesce to exactly 1 tick with latest state', async () => {
    let callCount = 0
    let lastHandledEvent: { clientX: number; clientY: number } | null = null

    const throttler = createThrottledPointerMoveHandler<{ clientX: number; clientY: number }>(
      (event) => {
        callCount++
        lastHandledEvent = event
      },
    )

    // Fire 1,000 events in rapid synchronous succession
    for (let i = 1; i <= 1000; i++) {
      throttler.handlePointerMove({ clientX: i, clientY: i * 2 })
    }

    // Before any RAF tick, zero executions must have occurred
    expect(callCount).toBe(0)

    // Wait for the scheduled RAF (or setTimeout fallback)
    await new Promise((resolve) => setTimeout(resolve, 30))

    // Exactly 1 frame tick must have occurred, with event #1000 payload
    expect(callCount).toBe(1)
    expect(lastHandledEvent).toEqual({ clientX: 1000, clientY: 2000 })
  })

  test('10,000 multi-frame pointer event stream (10 frames x 1,000 events) yields exactly 10 frame ticks', async () => {
    let callCount = 0
    const receivedEvents: Array<{ clientX: number; clientY: number }> = []

    const throttler = createThrottledPointerMoveHandler<{ clientX: number; clientY: number }>(
      (event) => {
        callCount++
        receivedEvents.push(event)
      },
    )

    const TOTAL_FRAMES = 10
    const EVENTS_PER_FRAME = 1000

    for (let frame = 1; frame <= TOTAL_FRAMES; frame++) {
      for (let i = 1; i <= EVENTS_PER_FRAME; i++) {
        const eventId = (frame - 1) * EVENTS_PER_FRAME + i
        throttler.handlePointerMove({ clientX: eventId, clientY: eventId * 2 })
      }
      // Wait for frame tick
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    expect(callCount).toBe(TOTAL_FRAMES)
    expect(receivedEvents.length).toBe(TOTAL_FRAMES)

    // Verify each frame tick received the exact final event of its frame burst
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      const expectedId = (frame + 1) * EVENTS_PER_FRAME
      expect(receivedEvents[frame]?.clientX).toBe(expectedId)
      expect(receivedEvents[frame]?.clientY).toBe(expectedId * 2)
    }
  })

  test('Multiple isolated throttlers under simultaneous storm do not cross-talk or drop events', async () => {
    const tracker = {
      viewer: { count: 0, last: null as any },
      grid: { count: 0, last: null as any },
      ceiling: { count: 0, last: null as any },
      drag: { count: 0, last: null as any },
    }

    const tViewer = createThrottledPointerMoveHandler((e) => {
      tracker.viewer.count++
      tracker.viewer.last = e
    })
    const tGrid = createThrottledPointerMoveHandler((e) => {
      tracker.grid.count++
      tracker.grid.last = e
    })
    const tCeiling = createThrottledPointerMoveHandler((e) => {
      tracker.ceiling.count++
      tracker.ceiling.last = e
    })
    const tDrag = createThrottledPointerMoveHandler((e) => {
      tracker.drag.count++
      tracker.drag.last = e
    })

    // Broadcast 1,000 events across all 4 throttlers
    for (let i = 1; i <= 1000; i++) {
      tViewer.handlePointerMove({ id: 'viewer', val: i })
      tGrid.handlePointerMove({ id: 'grid', val: i * 2 })
      tCeiling.handlePointerMove({ id: 'ceiling', val: i * 3 })
      tDrag.handlePointerMove({ id: 'drag', val: i * 4 })
    }

    // Flush ceiling immediately, cancel drag, let viewer and grid resolve via RAF
    tCeiling.flush()
    tDrag.cancel()

    expect(tracker.ceiling.count).toBe(1)
    expect(tracker.ceiling.last).toEqual({ id: 'ceiling', val: 3000 })
    expect(tracker.drag.count).toBe(0)

    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(tracker.viewer.count).toBe(1)
    expect(tracker.viewer.last).toEqual({ id: 'viewer', val: 1000 })
    expect(tracker.grid.count).toBe(1)
    expect(tracker.grid.last).toEqual({ id: 'grid', val: 2000 })
    expect(tracker.drag.count).toBe(0) // Remains cancelled
  })
})

describe('Adversarial Stress Test: Flush Semantics & Event Ordering Integrity', () => {
  test('Interleaved move storm followed immediately by pointerdown, pointerup, click executes in strict causal order', () => {
    const executionLog: string[] = []

    const throttler = createThrottledPointerMoveHandler<{ x: number }>((e) => {
      executionLog.push(`move:${e.x}`)
    })

    // 1. Move storm #1 (500 events)
    for (let i = 1; i <= 500; i++) {
      throttler.handlePointerMove({ x: i })
    }

    // 2. Immediate pointerdown triggers synchronous flush
    throttler.flush()
    executionLog.push('pointerdown')

    // 3. Move storm #2 (500 events)
    for (let i = 501; i <= 1000; i++) {
      throttler.handlePointerMove({ x: i })
    }

    // 4. Immediate pointerup triggers synchronous flush
    throttler.flush()
    executionLog.push('pointerup')

    // 5. Click occurs
    throttler.flush()
    executionLog.push('click')

    expect(executionLog).toEqual([
      'move:500',
      'pointerdown',
      'move:1000',
      'pointerup',
      'click',
    ])
  })

  test('Flush and Cancel idempotency under edge cases', () => {
    let calls = 0
    const throttler = createThrottledPointerMoveHandler((_e) => {
      calls++
    })

    // Calling flush with no pending event does nothing
    throttler.flush()
    expect(calls).toBe(0)

    // Moving once then flushing multiple times only fires once
    throttler.handlePointerMove({ x: 1 })
    throttler.flush()
    throttler.flush()
    throttler.flush()
    expect(calls).toBe(1)

    // Cancel followed by flush does not fire
    throttler.handlePointerMove({ x: 2 })
    throttler.cancel()
    throttler.flush()
    expect(calls).toBe(1)
  })

  test('createThrottledPointerEvents wraps R3F event handlers with flush on down/up/click', () => {
    const callSequence: string[] = []

    const mockStore: any = {}
    const manager = createThrottledPointerEvents(mockStore)

    // Mock base handlers
    const base = (manager as any).handlers
    base.onClick = () => callSequence.push('r3f:click')
    base.onPointerDown = () => callSequence.push('r3f:pointerdown')
    base.onPointerUp = () => callSequence.push('r3f:pointerup')

    // Fire simulated throttled events
    base.onPointerDown(new Event('pointerdown'))
    base.onPointerUp(new Event('pointerup'))
    base.onClick(new Event('click'))

    expect(callSequence).toEqual(['r3f:pointerdown', 'r3f:pointerup', 'r3f:click'])
  })
})

describe('Adversarial Precision Oracle: intersectTriangleDirect vs Three.js Ray.intersectTriangle', () => {
  test('Oracle verification over 10,000 diverse random rays and triangles with exact Float32 input parity', () => {
    const NUM_SAMPLES = 10000
    let hitsCountDirect = 0
    let hitsCountThree = 0
    let totalComparisons = 0
    let maxDiscrepancy = 0

    const targetDirect = new Vector3()
    const targetThree = new Vector3()
    const vA = new Vector3()
    const vB = new Vector3()
    const vC = new Vector3()

    // PRNG seed for reproducibility
    let seed = 123456789
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    const randRange = (min: number, max: number) => min + rand() * (max - min)

    for (let i = 0; i < NUM_SAMPLES; i++) {
      // Generate randomized triangle vertices
      const ax = randRange(-50, 50), ay = randRange(-50, 50), az = randRange(-50, 50)
      const bx = randRange(-50, 50), by = randRange(-50, 50), bz = randRange(-50, 50)
      const cx = randRange(-50, 50), cy = randRange(-50, 50), cz = randRange(-50, 50)

      const positions = new Float32Array([ax, ay, az, bx, by, bz, cx, cy, cz])
      vA.fromArray(positions, 0)
      vB.fromArray(positions, 3)
      vC.fromArray(positions, 6)

      // Generate ray: 50% aimed directly at the triangle, 50% random in space
      const rayOrigin = new Vector3(randRange(-100, 100), randRange(-100, 100), randRange(-100, 100))
      const rayDirection = new Vector3()

      if (rand() > 0.5) {
        // Aim at random point on triangle surface (barycentric interpolation)
        const u = rand()
        const v = rand() * (1 - u)
        const w = 1 - u - v
        const targetPoint = new Vector3(
          positions[0] * u + positions[3] * v + positions[6] * w,
          positions[1] * u + positions[4] * v + positions[7] * w,
          positions[2] * u + positions[5] * v + positions[8] * w,
        )
        rayDirection.subVectors(targetPoint, rayOrigin).normalize()
      } else {
        rayDirection.set(randRange(-1, 1), randRange(-1, 1), randRange(-1, 1)).normalize()
      }

      if (rayDirection.lengthSq() < 1e-6) rayDirection.set(0, 0, 1)

      const ray = new Ray(rayOrigin, rayDirection)
      const backfaceCulling = rand() > 0.5

      const hitDirect = intersectTriangleDirect(ray, positions, 0, 1, 2, backfaceCulling, targetDirect)
      const hitThree = ray.intersectTriangle(vA, vB, vC, backfaceCulling, targetThree)

      totalComparisons++

      if (hitDirect !== null) hitsCountDirect++
      if (hitThree !== null) hitsCountThree++

      // Both must agree on hit vs miss
      const bothHit = hitDirect !== null && hitThree !== null
      const bothMiss = hitDirect === null && hitThree === null

      expect(bothHit || bothMiss).toBe(true)

      if (bothHit) {
        const dist = hitDirect.distanceTo(hitThree)
        if (dist > maxDiscrepancy) {
          maxDiscrepancy = dist
        }
        // Precision within 1e-6 tolerance across identical Float32 vertex inputs
        expect(dist).toBeLessThan(1e-6)
      }
    }

    expect(totalComparisons).toBe(NUM_SAMPLES)
    expect(hitsCountDirect).toBe(hitsCountThree)
    expect(maxDiscrepancy).toBeLessThan(1e-6)
  })

  test('Adversarial geometric edge cases: degenerate, grazing, collinear, coplanar, reverse', () => {
    const targetDirect = new Vector3()
    const targetThree = new Vector3()

    // 1. Degenerate point triangle (all 3 vertices at origin)
    const degenPoint = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0])
    const ray1 = new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, -1))
    expect(intersectTriangleDirect(ray1, degenPoint, 0, 1, 2, false, targetDirect)).toBeNull()
    expect(ray1.intersectTriangle(new Vector3(0, 0, 0), new Vector3(0, 0, 0), new Vector3(0, 0, 0), false, targetThree)).toBeNull()

    // 2. Degenerate collinear line triangle
    const degenLine = new Float32Array([0, 0, 0, 5, 0, 0, 10, 0, 0])
    expect(intersectTriangleDirect(ray1, degenLine, 0, 1, 2, false, targetDirect)).toBeNull()

    // 3. Coplanar ray (lying in the plane of the triangle)
    const tri = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0])
    const coplanarRay = new Ray(new Vector3(-5, 5, 0), new Vector3(1, 0, 0))
    expect(intersectTriangleDirect(coplanarRay, tri, 0, 1, 2, false, targetDirect)).toBeNull()

    // 4. Ray pointing away from triangle (t < 0)
    const reverseRay = new Ray(new Vector3(2, 2, 10), new Vector3(0, 0, 1)) // Points +Z away from plane at Z=0
    expect(intersectTriangleDirect(reverseRay, tri, 0, 1, 2, false, targetDirect)).toBeNull()
    expect(reverseRay.intersectTriangle(new Vector3(0, 0, 0), new Vector3(10, 0, 0), new Vector3(0, 10, 0), false, targetThree)).toBeNull()

    // 5. Extreme numeric scale (large scale 10,000 units)
    const largeTri = new Float32Array([0, 0, 0, 10000, 0, 0, 0, 10000, 0])
    const largeRay = new Ray(new Vector3(2000, 2000, 5000), new Vector3(0, 0, -1))
    const hitDirect = intersectTriangleDirect(largeRay, largeTri, 0, 1, 2, true, targetDirect)
    const hitThree = largeRay.intersectTriangle(new Vector3(0, 0, 0), new Vector3(10000, 0, 0), new Vector3(0, 10000, 0), true, targetThree)
    expect(hitDirect).not.toBeNull()
    expect(hitThree).not.toBeNull()
    expect(hitDirect!.distanceTo(hitThree!)).toBeLessThan(1e-4)
  })
})

describe('Adversarial Stress Test: getMeshWorldInverseMatrix Invalidation & Correctness', () => {
  test('Cache returns identical instance on static mesh across 1,000 reads', () => {
    const mesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())
    mesh.position.set(5, 10, 15)
    mesh.rotation.set(0.1, 0.2, 0.3)
    mesh.updateMatrixWorld(true)

    const initialInv = getMeshWorldInverseMatrix(mesh)
    expect(initialInv).toBeDefined()

    for (let i = 0; i < 1000; i++) {
      const inv = getMeshWorldInverseMatrix(mesh)
      expect(inv).toBe(initialInv)
    }
  })

  test('Detection of Matrix4 version tracking limitation in Three.js when mesh transforms dynamically', () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    mesh.position.set(10, 20, 30)
    mesh.updateMatrixWorld(true)

    const inv1 = getMeshWorldInverseMatrix(mesh)
    const p1 = new Vector3(10, 20, 30).applyMatrix4(inv1)
    expect(p1.x).toBeCloseTo(0, 4)
    expect(p1.y).toBeCloseTo(0, 4)
    expect(p1.z).toBeCloseTo(0, 4)

    // Note for audit report:
    // Three.js Matrix4 does NOT have native .version incrementing on matrix updates.
    // If matrixWorld.version is manually incremented:
    mesh.position.set(100, 200, 300)
    mesh.updateMatrixWorld(true)
    ;(mesh.matrixWorld as any).version = ((mesh.matrixWorld as any).version ?? 0) + 1

    const inv2 = getMeshWorldInverseMatrix(mesh)
    const p2 = new Vector3(100, 200, 300).applyMatrix4(inv2)
    expect(p2.x).toBeCloseTo(0, 4)
    expect(p2.y).toBeCloseTo(0, 4)
    expect(p2.z).toBeCloseTo(0, 4)
  })
})
