import { describe, expect, test } from 'bun:test'
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  Texture,
} from 'three'
import { disposeObject3DResources } from './dispose-object3d'

describe('disposeObject3DResources', () => {
  test('disposes nested geometry and materials once', () => {
    const root = new Group()
    const nested = new Group()
    const geometry = new BoxGeometry()
    const material = new MeshBasicMaterial()
    let geometryDisposals = 0
    let materialDisposals = 0
    geometry.addEventListener('dispose', () => geometryDisposals++)
    material.addEventListener('dispose', () => materialDisposals++)
    nested.add(new Mesh(geometry, material), new Mesh(geometry, material))
    root.add(nested)

    disposeObject3DResources(root)

    expect(geometryDisposals).toBe(1)
    expect(materialDisposals).toBe(1)
  })

  test('preserves Pascal material-cache ownership', () => {
    const root = new Group()
    const material = new MeshBasicMaterial()
    material.userData.__pascalCachedMaterial = true
    let materialDisposals = 0
    material.addEventListener('dispose', () => materialDisposals++)
    root.add(new Mesh(new BoxGeometry(), material))

    disposeObject3DResources(root)

    expect(materialDisposals).toBe(0)
  })

  test('disposes non-cached material textures (map, normalMap, roughnessMap, metalnessMap) once', () => {
    const root = new Group()
    const geometry = new BoxGeometry()
    const material = new MeshStandardMaterial()
    const map = new Texture()
    const normalMap = new Texture()
    const roughnessMap = new Texture()
    const metalnessMap = new Texture()

    material.map = map
    material.normalMap = normalMap
    material.roughnessMap = roughnessMap
    material.metalnessMap = metalnessMap

    let mapDisposals = 0
    let normalDisposals = 0
    let roughnessDisposals = 0
    let metalnessDisposals = 0

    map.addEventListener('dispose', () => mapDisposals++)
    normalMap.addEventListener('dispose', () => normalDisposals++)
    roughnessMap.addEventListener('dispose', () => roughnessDisposals++)
    metalnessMap.addEventListener('dispose', () => metalnessDisposals++)

    root.add(new Mesh(geometry, material))
    disposeObject3DResources(root)

    expect(mapDisposals).toBe(1)
    expect(normalDisposals).toBe(1)
    expect(roughnessDisposals).toBe(1)
    expect(metalnessDisposals).toBe(1)
  })

  test('preserves textures on cached materials', () => {
    const root = new Group()
    const material = new MeshStandardMaterial()
    material.userData.__pascalCachedMaterial = true
    const map = new Texture()
    let mapDisposals = 0
    map.addEventListener('dispose', () => mapDisposals++)
    material.map = map

    root.add(new Mesh(new BoxGeometry(), material))
    disposeObject3DResources(root)

    expect(mapDisposals).toBe(0)
  })

  test('preserves textures explicitly marked with __pascalCachedTexture', () => {
    const root = new Group()
    const material = new MeshStandardMaterial()
    const map = new Texture()
    map.userData.__pascalCachedTexture = true
    let mapDisposals = 0
    map.addEventListener('dispose', () => mapDisposals++)
    material.map = map

    root.add(new Mesh(new BoxGeometry(), material))
    disposeObject3DResources(root)

    expect(mapDisposals).toBe(0)
  })

  test('disposes shared texture across multiple materials only once', () => {
    const root = new Group()
    const mat1 = new MeshStandardMaterial()
    const mat2 = new MeshStandardMaterial()
    const sharedMap = new Texture()
    let disposals = 0
    sharedMap.addEventListener('dispose', () => disposals++)
    mat1.map = sharedMap
    mat2.map = sharedMap

    root.add(new Mesh(new BoxGeometry(), mat1), new Mesh(new BoxGeometry(), mat2))
    disposeObject3DResources(root)

    expect(disposals).toBe(1)
  })

  test('disposes custom property textures and shader uniform textures', () => {
    const root = new Group()
    const customTex = new Texture()
    const uniformTex = new Texture()
    const arrayTex1 = new Texture()
    const arrayTex2 = new Texture()
    const cachedUniformTex = new Texture()
    cachedUniformTex.userData.__pascalCachedTexture = true

    let customDisposals = 0
    let uniformDisposals = 0
    let array1Disposals = 0
    let array2Disposals = 0
    let cachedUniformDisposals = 0

    customTex.addEventListener('dispose', () => customDisposals++)
    uniformTex.addEventListener('dispose', () => uniformDisposals++)
    arrayTex1.addEventListener('dispose', () => array1Disposals++)
    arrayTex2.addEventListener('dispose', () => array2Disposals++)
    cachedUniformTex.addEventListener('dispose', () => cachedUniformDisposals++)

    const shaderMaterial = new ShaderMaterial({
      uniforms: {
        uCustomTexture: { value: uniformTex },
        uTextureArray: { value: [arrayTex1, arrayTex2] },
        uCachedTex: { value: cachedUniformTex },
      },
    })
    ;(shaderMaterial as any).customAttachedTexture = customTex

    root.add(new Mesh(new BoxGeometry(), shaderMaterial))
    disposeObject3DResources(root)

    expect(customDisposals).toBe(1)
    expect(uniformDisposals).toBe(1)
    expect(array1Disposals).toBe(1)
    expect(array2Disposals).toBe(1)
    expect(cachedUniformDisposals).toBe(0)
  })
})

