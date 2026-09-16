import type { BufferGeometry, Material, Object3D, Texture } from 'three'

function isCachedMaterial(material: Material): boolean {
  return Boolean(material.userData?.__pascalCachedMaterial)
}

function isCachedTexture(texture: Texture): boolean {
  return Boolean(texture.userData?.__pascalCachedTexture)
}

function isTexture(value: unknown): value is Texture {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'isTexture' in value &&
      (value as Texture).isTexture === true &&
      typeof (value as Texture).dispose === 'function',
  )
}

const KNOWN_TEXTURE_SLOTS = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'emissiveMap',
  'envMap',
  'lightMap',
  'metalnessMap',
  'normalMap',
  'roughnessMap',
  'specularMap',
  'gradientMap',
  'transmissionMap',
  'thicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'anisotropyMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
] as const

function collectMaterialTextures(material: Material, textures: Set<Texture>): void {
  if (isCachedMaterial(material)) return

  // 1. Scan known standard texture properties
  for (const slot of KNOWN_TEXTURE_SLOTS) {
    const val = (material as unknown as Record<string, unknown>)[slot]
    if (isTexture(val) && !isCachedTexture(val)) {
      textures.add(val)
    }
  }

  // 2. Scan arbitrary properties for custom materials
  for (const key of Object.keys(material)) {
    const val = (material as unknown as Record<string, unknown>)[key]
    if (isTexture(val) && !isCachedTexture(val)) {
      textures.add(val)
    }
  }

  // 3. Scan shader uniforms
  const shaderMat = material as Material & {
    uniforms?: Record<string, { value?: unknown }>
  }
  if (shaderMat.uniforms && typeof shaderMat.uniforms === 'object') {
    for (const uniform of Object.values(shaderMat.uniforms)) {
      if (uniform) {
        if (isTexture(uniform.value) && !isCachedTexture(uniform.value)) {
          textures.add(uniform.value)
        } else if (Array.isArray(uniform.value)) {
          for (const item of uniform.value) {
            if (isTexture(item) && !isCachedTexture(item)) {
              textures.add(item)
            }
          }
        }
      }
    }
  }
}

/** Dispose geometry, material textures, and non-cached materials owned by an Object3D subtree. */
export function disposeObject3DResources(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()

  root.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: BufferGeometry
      material?: Material | Material[]
    }
    if (renderable.geometry) geometries.add(renderable.geometry)
    const objectMaterials = renderable.material
    if (Array.isArray(objectMaterials)) {
      for (const material of objectMaterials) materials.add(material)
    } else if (objectMaterials) {
      materials.add(objectMaterials)
    }
  })

  for (const material of materials) {
    collectMaterialTextures(material, textures)
  }

  for (const geometry of geometries) geometry.dispose()
  for (const texture of textures) texture.dispose()
  for (const material of materials) {
    if (!isCachedMaterial(material)) material.dispose()
  }
}

