import { describe, expect, mock, test } from 'bun:test'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three'
import { acceleratedRaycast } from 'three-mesh-bvh'
import {
  createSceneBvhMaintainer,
  isSceneBvhExcluded,
} from './scene-bvh-maintainer'

function makeMesh(name = 'mesh', geometry?: BufferGeometry) {
  const mesh = new Mesh(geometry ?? new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
  mesh.name = name
  return mesh
}

function drain(maintainer: { step(): void }, steps: number) {
  for (let index = 0; index < steps; index += 1) maintainer.step()
}

describe('createSceneBvhMaintainer', () => {
  describe('Continuous Scene Inspection & Late Mesh Indexing', () => {
    test('mount sonrasında eklenen mesh indeksleniyor — tek seferlik tarayıcının sessiz hatası', () => {
      const root = new Group()
      const maintainer = createSceneBvhMaintainer(root, { scanInterval: 2 })

      maintainer.step() // ilk tarama: sahne boş
      const late = makeMesh('late')
      root.add(late)
      drain(maintainer, 3) // scanInterval'i aş

      expect(late.raycast).toBe(acceleratedRaycast)
      expect(late.geometry.boundsTree).toBeDefined()
    })

    test('geometri değişimi (duvar düzenlemesi) yeni geometriyi indeksliyor', () => {
      const root = new Group()
      const mesh = makeMesh('wall')
      root.add(mesh)
      const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1 })
      drain(maintainer, 2)
      expect(mesh.geometry.boundsTree).toBeDefined()

      mesh.geometry = new BoxGeometry(2, 2, 2) // düzenleme: geometri takası
      drain(maintainer, 2)

      expect(mesh.geometry.boundsTree).toBeDefined()
    })
  })

  describe('Exclusion & Filtering Rules', () => {
    test('isSceneBvhExcluded detects userData.excludeFromBvh flag', () => {
      const meshNormal = makeMesh('normal')
      expect(isSceneBvhExcluded(meshNormal)).toBe(false)

      const meshExcluded = makeMesh('excluded')
      meshExcluded.userData.excludeFromBvh = true
      expect(isSceneBvhExcluded(meshExcluded)).toBe(true)

      const meshExplicitFalse = makeMesh('explicit-false')
      meshExplicitFalse.userData.excludeFromBvh = false
      expect(isSceneBvhExcluded(meshExplicitFalse)).toBe(false)
    })

    test('excludeFromBvh işaretli mesh hiç dokunulmuyor ve normal raycast koruyor', () => {
      const root = new Group()
      const excluded = makeMesh('overlay')
      excluded.userData.excludeFromBvh = true
      root.add(excluded)
      const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1 })
      drain(maintainer, 3)

      expect(excluded.raycast).toBe(Mesh.prototype.raycast)
      expect(excluded.geometry.boundsTree).toBeUndefined()
    })
  })

  describe('Budget Regulation & Queue Processing', () => {
    test('bütçe işi ertelese de her adımda en az bir inşa ilerliyor', () => {
      const root = new Group()
      const meshes = Array.from({ length: 5 }, (_, index) => makeMesh(`m${index}`))
      for (const mesh of meshes) root.add(mesh)
      // budgetMs 0 + sahte saat: her step tek inşadan sonra bütçeyi aşar.
      let tick = 0
      const maintainer = createSceneBvhMaintainer(root, {
        scanInterval: 1,
        budgetMs: 0,
        now: () => tick++,
      })

      maintainer.step() // tarama + 1 inşa
      const builtAfterOne = meshes.filter((mesh) => mesh.geometry.boundsTree).length
      expect(builtAfterOne).toBe(1)

      drain(maintainer, 4)
      expect(meshes.every((mesh) => mesh.geometry.boundsTree)).toBe(true)
    })

    test('respects positive budgetMs and processes multiple queued geometries within deadline', () => {
      const root = new Group()
      const meshes = Array.from({ length: 4 }, (_, index) => makeMesh(`batch_${index}`))
      for (const mesh of meshes) root.add(mesh)

      let currentTime = 100
      const maintainer = createSceneBvhMaintainer(root, {
        scanInterval: 1,
        budgetMs: 10,
        now: () => {
          currentTime += 1 // each check consumes 1ms
          return currentTime
        },
      })

      maintainer.step()
      // Within 10ms budget, all 4 meshes should be built
      expect(meshes.every((m) => m.geometry.boundsTree !== undefined)).toBe(true)
    })
  })

  describe('Disposal & Lifecycle Cleanup', () => {
    test('dispose raycast fonksiyonlarını ve ağaçları geri alıyor', () => {
      const root = new Group()
      const mesh = makeMesh()
      root.add(mesh)
      const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1 })
      drain(maintainer, 2)
      expect(mesh.geometry.boundsTree).toBeDefined()

      maintainer.dispose()

      expect(mesh.raycast).toBe(Mesh.prototype.raycast)
      expect(mesh.geometry.boundsTree).toBeFalsy()
    })
  })

  describe('Geometry Compatibility & Invariant Checks', () => {
    test('üçgensiz veya boş geometri kuyruğa girmiyor', () => {
      const root = new Group()
      const empty = new Mesh(undefined, new MeshBasicMaterial())
      empty.name = 'empty'
      root.add(empty)
      const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1 })
      drain(maintainer, 3)

      expect(empty.geometry?.boundsTree).toBeUndefined()
    })

    test('geometries with fewer than 3 vertices are skipped', () => {
      const root = new Group()
      const lineGeom = new BufferGeometry()
      const positions = new Float32Array([0, 0, 0, 1, 1, 1]) // 2 vertices only
      lineGeom.setAttribute('position', new BufferAttribute(positions, 3))
      const pointMesh = new Mesh(lineGeom, new MeshBasicMaterial())
      root.add(pointMesh)

      const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1 })
      drain(maintainer, 2)

      expect(pointMesh.geometry.boundsTree).toBeUndefined()
    })

    test('handles computeBoundsTree failures gracefully and avoids re-queue storms', () => {
      const root = new Group()
      const brokenMesh = makeMesh('broken')
      root.add(brokenMesh)

      const warnSpy = mock(() => undefined)
      const origWarn = console.warn
      console.warn = warnSpy

      try {
        const throwingBvhOptions = {
          get strategy(): number {
            throw new Error('Simulated BVH options failure')
          },
        }

        const maintainer = createSceneBvhMaintainer(root, {
          scanInterval: 1,
          bvh: throwingBvhOptions as any,
        })

        maintainer.step() // will scan, queue, and fail in try/catch
        expect(warnSpy).toHaveBeenCalledTimes(1)

        // Subsequent steps must NOT re-throw or re-queue the failed geometry
        maintainer.step()
        maintainer.step()
        expect(warnSpy).toHaveBeenCalledTimes(1) // Still 1, no storm
      } finally {
        console.warn = origWarn
      }
    })
  })

  describe('Accelerated Raycasting Verification', () => {
    test('performs accelerated raycast and computes valid intersections', () => {
      const root = new Group()
      const mesh = makeMesh('target', new BoxGeometry(2, 2, 2))
      mesh.position.set(0, 0, 0)
      mesh.updateMatrixWorld(true)
      root.add(mesh)

      const maintainer = createSceneBvhMaintainer(root, { scanInterval: 1 })
      drain(maintainer, 2)

      expect(mesh.raycast).toBe(acceleratedRaycast)
      expect(mesh.geometry.boundsTree).toBeDefined()

      const raycaster = new Raycaster(new Vector3(0, 0, 5), new Vector3(0, 0, -1))
      const intersects: any[] = []
      mesh.raycast(raycaster, intersects)

      expect(intersects.length).toBeGreaterThan(0)
      expect(intersects[0].point.z).toBeCloseTo(1, 2) // Front face at z = 1
    })
  })
})
