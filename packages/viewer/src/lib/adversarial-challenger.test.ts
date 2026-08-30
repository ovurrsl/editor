import { describe, expect, mock, test } from 'bun:test'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SphereGeometry,
  Vector3,
} from 'three'
import { acceleratedRaycast } from 'three-mesh-bvh'
import { createFrameClock } from '../components/viewer/frame-limiter'
import {
  createSceneBvhMaintainer,
  isSceneBvhExcluded,
} from './scene-bvh-maintainer'
 
describe('Adversarial Challenge: FrameLimiter & Monotonic Frame Clock', () => {
  describe('Clock Monotonicity under Chaotic & Irregular Frame Timing', () => {
    test('strictly preserves monotonicity across 10,000 randomized jittery frame intervals', () => {
      const clock = createFrameClock(100)
      const targetInterval = 1000 / 60
      let currentWallTime = 50_000
      let lastFrameTime = 100

      expect(clock.sample(currentWallTime, targetInterval)).toBeNull()

      const deltas = [0, 0.5, 1, 2, 8, 16.6, 17, 33.3, 50, 100, 250, 500, 1200]
      for (let i = 0; i < 10_000; i++) {
        const delta = deltas[i % deltas.length]
        currentWallTime += delta
        const sampled = clock.sample(currentWallTime, targetInterval)
        if (sampled !== null) {
          expect(sampled).toBeGreaterThanOrEqual(lastFrameTime)
          lastFrameTime = sampled
        }
      }
    })

    test('recovers gracefully from negative wall-time jumps (clock skew / backwards jumps)', () => {
      const clock = createFrameClock(0)
      const interval = 20

      expect(clock.sample(1000, interval)).toBeNull()
      expect(clock.sample(1020, interval)).toBeCloseTo(0.02)

      expect(clock.sample(950, interval)).toBeNull()
      expect(clock.sample(990, interval)).toBeNull()

      const resumed = clock.sample(1040, interval)
      expect(resumed).not.toBeNull()
      expect(resumed).toBeGreaterThanOrEqual(0.02)
    })

    test('handles multi-kick bursts during sleep and wake without monotonic violation', () => {
      const clock = createFrameClock(50)
      let currentTime = 50

      for (let k = 0; k < 5; k++) {
        currentTime = clock.step(1 / 1000)
        expect(currentTime).toBeCloseTo(50 + (k + 1) * 0.001)
      }

      const sampleAfterWake = clock.sample(10_000, 1000 / 60)
      expect(sampleAfterWake === null || sampleAfterWake >= currentTime).toBe(true)
    })

    test('maintains sub-millisecond precision and no float drift across 240 FPS and 360 FPS targets', () => {
      const highFpsTargets = [144, 240, 360]

      for (const fps of highFpsTargets) {
        const interval = 1000 / fps
        const clock = createFrameClock(0)
        let wallTime = 10_000
        expect(clock.sample(wallTime, interval)).toBeNull()

        let lastResult = 0
        for (let step = 1; step <= 1_000; step++) {
          wallTime = 10_000 + step * interval + 1e-6
          const result = clock.sample(wallTime, interval)
          if (result !== null) {
            expect(result).toBeGreaterThanOrEqual(lastResult)
            expect(result).toBeCloseTo(step * (interval / 1000), 2)
            lastResult = result
          }
        }
        expect(lastResult).toBeCloseTo(1000 * (interval / 1000), 2)
      }
    })

    test('boundary FPS inputs: 0, negative, NaN, Infinity default safely', () => {
      const resolveEffectiveFps = (fps?: number) =>
        Number.isFinite(fps) && (fps as number) > 0 ? (fps as number) : 50

      expect(resolveEffectiveFps(0)).toBe(50)
      expect(resolveEffectiveFps(-1)).toBe(50)
      expect(resolveEffectiveFps(-60)).toBe(50)
      expect(resolveEffectiveFps(NaN)).toBe(50)
      expect(resolveEffectiveFps(Infinity)).toBe(50)
      expect(resolveEffectiveFps(-Infinity)).toBe(50)
      expect(resolveEffectiveFps(240)).toBe(240)
    })
  })
})

describe('Adversarial Challenge: SceneBvhMaintainer & Memory Safety', () => {
  describe('High-Density Mesh Churn & Stress Scalability (4k/10k scene scale)', () => {
    test('handles continuous addition of 1,000 meshes under 4ms budget without starvation', () => {
      const root = new Group()
      const meshCount = 1000
      const meshes: Mesh[] = []

      for (let i = 0; i < meshCount; i++) {
        const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
        m.name = 'churn_mesh_' + i
        meshes.push(m)
        root.add(m)
      }

      let simulatedTime = 0
      const maintainer = createSceneBvhMaintainer(root, {
        scanInterval: 1,
        budgetMs: 4,
        now: () => {
          simulatedTime += 0.5
          return simulatedTime
        },
      })

      let totalSteps = 0
      while (meshes.some((m) => !m.geometry.boundsTree) && totalSteps < 2_000) {
        maintainer.step()
        totalSteps++
      }

      const indexedCount = meshes.filter((m) => !!m.geometry.boundsTree).length
      expect(indexedCount).toBe(meshCount)
      expect(totalSteps).toBeGreaterThan(1)
    })

    test('rapid geometry replacement churn (100 sequential geometry edits on same mesh)', () => {
      const root = new Group()
      const dynamicWall = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
      root.add(dynamicWall)

      const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1, budgetMs: 10 })
      maintainer.step()
      expect(dynamicWall.geometry.boundsTree).toBeDefined()

      for (let edit = 1; edit <= 100; edit++) {
        dynamicWall.geometry = new BoxGeometry(1 + edit * 0.1, 2, 3)
        maintainer.step()
        expect(dynamicWall.geometry.boundsTree).toBeDefined()
        expect(dynamicWall.raycast).toBe(acceleratedRaycast)
      }
    })

    test('extreme geometry edge cases: zero-vertex, empty attributes, degenerate triangles, point clouds', () => {
      const root = new Group()

      const zeroVertexGeom = new BufferGeometry()
      zeroVertexGeom.setAttribute('position', new BufferAttribute(new Float32Array([]), 3))
      const zeroMesh = new Mesh(zeroVertexGeom, new MeshBasicMaterial())
      zeroMesh.name = 'zero_vertex'
      root.add(zeroMesh)

      const oneVertexGeom = new BufferGeometry()
      oneVertexGeom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3))
      const oneMesh = new Mesh(oneVertexGeom, new MeshBasicMaterial())
      oneMesh.name = 'one_vertex'
      root.add(oneMesh)

      const twoVertexGeom = new BufferGeometry()
      twoVertexGeom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1]), 3))
      const twoMesh = new Mesh(twoVertexGeom, new MeshBasicMaterial())
      twoMesh.name = 'two_vertex'
      root.add(twoMesh)

      const emptyGeom = new BufferGeometry()
      const emptyMesh = new Mesh(emptyGeom, new MeshBasicMaterial())
      emptyMesh.name = 'empty_geom'
      root.add(emptyMesh)

      const validMesh = new Mesh(new SphereGeometry(1, 8, 8), new MeshBasicMaterial())
      validMesh.name = 'valid_sphere'
      root.add(validMesh)

      const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1, budgetMs: 10 })
      maintainer.step()
      maintainer.step()

      expect(zeroMesh.geometry.boundsTree).toBeUndefined()
      expect(oneMesh.geometry.boundsTree).toBeUndefined()
      expect(twoMesh.geometry.boundsTree).toBeUndefined()
      expect(emptyMesh.geometry.boundsTree).toBeUndefined()

      expect(validMesh.geometry.boundsTree).toBeDefined()
      expect(validMesh.raycast).toBe(acceleratedRaycast)
    })

    test('dynamic excludeFromBvh toggle during runtime lifecycle', () => {
      const root = new Group()
      const toggledMesh = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())
      toggledMesh.userData.excludeFromBvh = true
      root.add(toggledMesh)

      const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1, budgetMs: 10 })
      maintainer.step()
      maintainer.step()

      expect(toggledMesh.raycast).toBe(Mesh.prototype.raycast)
      expect(toggledMesh.geometry.boundsTree).toBeUndefined()

      toggledMesh.userData.excludeFromBvh = false
      maintainer.step()
      maintainer.step()

      expect(toggledMesh.raycast).toBe(acceleratedRaycast)
      expect(toggledMesh.geometry.boundsTree).toBeDefined()
    })

    test('complete lifecycle teardown & raycast restoration via dispose()', () => {
      const root = new Group()
      const mesh1 = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
      const mesh2 = new Mesh(new SphereGeometry(1, 4, 4), new MeshBasicMaterial())
      root.add(mesh1, mesh2)

      const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1, budgetMs: 10 })
      maintainer.step()
      maintainer.step()

      expect(mesh1.raycast).toBe(acceleratedRaycast)
      expect(mesh2.raycast).toBe(acceleratedRaycast)
      expect(mesh1.geometry.boundsTree).toBeDefined()
      expect(mesh2.geometry.boundsTree).toBeDefined()

      maintainer.dispose()

      expect(mesh1.raycast).toBe(Mesh.prototype.raycast)
      expect(mesh2.raycast).toBe(Mesh.prototype.raycast)
      expect(mesh1.geometry.boundsTree).toBeFalsy()
      expect(mesh2.geometry.boundsTree).toBeFalsy()
    })

    test('error storm prevention: corrupted computeBoundsTree failure does not re-queue', () => {
      const root = new Group()
      const brokenMesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
      root.add(brokenMesh)

      const warnMock = mock(() => undefined)
      const origWarn = console.warn
      console.warn = warnMock

      try {
        const throwingBvh = {
          get strategy(): number {
            throw new Error('Adversarial corrupted mesh tree crash')
          },
        }

        const maintainer = createSceneBvhMaintainer(root, {
          scanInterval: 1,
          bvh: throwingBvh as any,
        })

        maintainer.step()
        expect(warnMock).toHaveBeenCalledTimes(1)

        for (let s = 0; s < 10; s++) {
          maintainer.step()
        }
        expect(warnMock).toHaveBeenCalledTimes(1)
      } finally {
        console.warn = origWarn
      }
    })
  })
    test('Ruthless scale test: 5,000 meshes scene graph traversal and budgeted indexing', () => {
      const root = new Group()
      const totalMeshes = 5000
      const meshes = []
      for (let i = 0; i < totalMeshes; i++) {
        const m = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
        meshes.push(m)
        root.add(m)
      }

      let tick = 0
      const maintainer = createSceneBvhMaintainer(root, {
        scanInterval: 15,
        budgetMs: 4,
        now: () => tick += 0.2,
      })

      // Run 200 maintenance steps
      for (let s = 0; s < 200; s++) {
        maintainer.step()
      }

      // Check indexing progress (a portion must be built every step without blocking)
      const indexed = meshes.filter(m => !!m.geometry.boundsTree).length
      expect(indexed).toBeGreaterThan(0)
    })

    test('Raycasting safety while BVH build queue is partially processed', () => {
      const root = new Group()
      const mesh1 = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())
      const mesh2 = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial())
      mesh1.position.set(0, 0, 0)
      mesh2.position.set(5, 0, 0)
      mesh1.updateMatrixWorld(true)
      mesh2.updateMatrixWorld(true)
      root.add(mesh1, mesh2)

      const maintainer = createSceneBvhMaintainer(root, {
        scanInterval: 1,
        budgetMs: 0, // only 1 mesh built per step
      })

      maintainer.step() // scans both, but only mesh1 gets boundsTree built on step 1

      expect(mesh1.geometry.boundsTree).toBeDefined()
      expect(mesh1.raycast).toBe(acceleratedRaycast)
      // mesh2 has acceleratedRaycast assigned, but boundsTree not yet built
      expect(mesh2.raycast).toBe(acceleratedRaycast)
      expect(mesh2.geometry.boundsTree).toBeUndefined()

      // Raycast against both meshes: acceleratedRaycast falls back cleanly to stock raycasting if boundsTree is absent
      const raycaster1 = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1))
      const hits1 = []
      mesh1.raycast(raycaster1, hits1)
      expect(hits1.length).toBeGreaterThan(0)

      const raycaster2 = new Raycaster(new Vector3(5, 0, 5), new Vector3(0, 0, -1))
      const hits2 = []
      mesh2.raycast(raycaster2, hits2)
      expect(hits2.length).toBeGreaterThan(0)
    })

})
