import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import fs from 'node:fs'
import path from 'node:path'

// Polyfill FileReader for Node.js if not present
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    result: any = null
    onload: any = null
    onloadend: any = null
    async readAsArrayBuffer(blob: Blob) {
      this.result = await blob.arrayBuffer()
      if (this.onload) this.onload({ target: this })
      if (this.onloadend) this.onloadend({ target: this })
    }
    async readAsDataURL(blob: Blob) {
      const buf = await blob.arrayBuffer()
      const base64 = Buffer.from(buf).toString('base64')
      this.result = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + base64
      if (this.onload) this.onload({ target: this })
      if (this.onloadend) this.onloadend({ target: this })
    }
  } as any
}


async function loadBaseModel(buffer: ArrayBuffer): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    loader.parse(buffer, '', (gltf) => {
      resolve(gltf.scene)
    }, (err) => {
      reject(err)
    })
  })
}

export async function bakeModelToDisk(sceneId: string, sceneData: any): Promise<string | null> {
  const nodes = sceneData.nodes || sceneData.graph?.nodes || {}
  const allNodes = Object.values(nodes) as any[]
  if (allNodes.length === 0) return null

  const buildingNode = allNodes.find((n) => n.type === 'building') || { id: `building_${sceneId}` }
  const levelNodes = allNodes.filter((n) => n.type === 'level')
  if (levelNodes.length === 0) {
    levelNodes.push({ id: `level_ground_${sceneId}`, elevation: 0 })
  }

  let threeScene = new THREE.Scene()
  threeScene.name = 'scene-renderer'

  let isGuzeller = false
  const sceneName = (sceneData.name || '').toLowerCase()
  if (sceneId !== '6c5728d1aed7' && (sceneName.includes('güzeller') || sceneName.includes('guzeller'))) {
    isGuzeller = true
    
    let baseModelPath = path.join(process.cwd(), 'apps/editor/public/assets/model/model_6c5728d1aed7.glb')
    if (!fs.existsSync(baseModelPath)) {
        baseModelPath = path.join(process.cwd(), 'public/assets/model/model_6c5728d1aed7.glb')
    }

    if (baseModelPath) {
      try {
        const buf = fs.readFileSync(baseModelPath)
        const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        const loadedScene = await loadBaseModel(arrayBuf)
        threeScene = loadedScene
      } catch (e) {
        console.error("Failed to load base model for baking", e)
      }
    }
  }

  const buildingGroup = new THREE.Group()
  buildingGroup.name = buildingNode.id
  buildingGroup.userData = { pascalId: buildingNode.id, kind: 'building' }
  threeScene.add(buildingGroup)

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.8, metalness: 0.1 })
  const slabMat = new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.9, metalness: 0.05 })
  const colMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.6, metalness: 0.2 })
  const rackUprightMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.5, metalness: 0.3 })
  const rackBeamMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6, metalness: 0.2 })
  const palletMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.8, metalness: 0.0 })
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.7, metalness: 0.0 })
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5, metalness: 0.4 })

  const levelGroups = new Map<string, THREE.Group>()
  for (const lvl of levelNodes) {
    const lg = new THREE.Group()
    lg.name = lvl.id
    lg.userData = { pascalId: lvl.id, kind: 'level' }
    lg.position.y = Number(lvl.elevation || 0)
    buildingGroup.add(lg)
    levelGroups.set(lvl.id, lg)
  }

  const defaultLevel = levelGroups.values().next().value!

  function getLevelGroup(parentId?: string): THREE.Group {
    if (parentId && levelGroups.has(parentId)) return levelGroups.get(parentId)!
    if (parentId && nodes[parentId]?.parentId && levelGroups.has(nodes[parentId].parentId)) {
      return levelGroups.get(nodes[parentId].parentId)!
    }
    return defaultLevel
  }

  // 1. Slabs
  if (!isGuzeller) for (const node of allNodes) {
    if (node.type === 'slab' && Array.isArray(node.polygon) && node.polygon.length >= 3) {
      try {
        const poly = node.polygon
        const shape = new THREE.Shape()
        shape.moveTo(poly[0][0], -poly[0][1])
        for (let i = 1; i < poly.length; i++) {
          shape.lineTo(poly[i][0], -poly[i][1])
        }
        shape.closePath()
        const thickness = Math.max(0.1, Number(node.thickness || 0.2))
        const geom = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
        geom.rotateX(Math.PI / 2)
        const mesh = new THREE.Mesh(geom, slabMat)
        mesh.position.y = Number(node.elevation || 0) + thickness
        mesh.name = `slab_${node.id}`
        mesh.userData = { pascalId: node.id, kind: 'slab' }
        getLevelGroup(node.parentId).add(mesh)
      } catch {}
    }
  }

  // 2. Walls
  if (!isGuzeller) for (const node of allNodes) {
    if (node.type === 'wall' && Array.isArray(node.start) && Array.isArray(node.end)) {
      try {
        const [x1, z1] = node.start
        const [x2, z2] = node.end
        const dx = x2 - x1
        const dz = z2 - z1
        const length = Math.hypot(dx, dz)
        if (length < 0.05) continue
        const height = Math.max(2.5, Number(node.height || 12.5))
        const thickness = Math.max(0.1, Number(node.thickness || 0.3))
        const angle = Math.atan2(dz, dx)

        const geom = new THREE.BoxGeometry(length, height, thickness)
        const mesh = new THREE.Mesh(geom, wallMat)
        mesh.position.set((x1 + x2) / 2, height / 2, (z1 + z2) / 2)
        mesh.rotation.y = -angle
        mesh.name = `wall_${node.id}`
        mesh.userData = { pascalId: node.id, kind: 'wall' }
        getLevelGroup(node.parentId).add(mesh)
      } catch {}
    }
  }

  // 3. Columns
  if (!isGuzeller) for (const node of allNodes) {
    if (node.type === 'column') {
      try {
        const pos = Array.isArray(node.position) ? node.position : [0, 0, 0]
        const px = Number(pos[0] || 0)
        const py = Number(pos[1] || 0)
        const pz = Number(pos[2] || 0)
        const height = Math.max(2.5, Number(node.height || 12.5))
        const width = Math.max(0.3, Number(node.width || (node.radius ? node.radius * 2 : 0.8)))
        const depth = Math.max(0.3, Number(node.depth || width))

        let geom: THREE.BufferGeometry
        if (node.crossSection === 'round' || node.radius) {
          const r = width / 2
          geom = new THREE.CylinderGeometry(r, r, height, 16)
        } else {
          geom = new THREE.BoxGeometry(width, height, depth)
        }

        const mesh = new THREE.Mesh(geom, colMat)
        mesh.position.set(px, py + height / 2, pz)
        if (Array.isArray(node.rotation)) {
          mesh.rotation.set(node.rotation[0] || 0, node.rotation[1] || 0, node.rotation[2] || 0)
        }
        mesh.name = `column_${node.id}`
        mesh.userData = { pascalId: node.id, kind: 'column' }
        getLevelGroup(node.parentId).add(mesh)
      } catch {}
    }
  }

  // 4. Doors
  if (!isGuzeller) for (const node of allNodes) {
    if (node.type === 'door') {
      try {
        const pos = Array.isArray(node.position) ? node.position : [0, 0, 0]
        const width = Math.max(1.0, Number(node.width || 3.0))
        const height = Math.max(2.0, Number(node.height || 4.5))
        const depth = Math.max(0.1, Number(node.thickness || 0.2))
        const geom = new THREE.BoxGeometry(width, height, depth)
        const mesh = new THREE.Mesh(geom, doorMat)
        mesh.position.set(Number(pos[0] || 0), Number(pos[1] || 0) + height / 2, Number(pos[2] || 0))
        if (Array.isArray(node.rotation)) {
          mesh.rotation.set(node.rotation[0] || 0, node.rotation[1] || 0, node.rotation[2] || 0)
        }
        mesh.name = `door_${node.id}`
        mesh.userData = { pascalId: node.id, kind: 'door' }
        getLevelGroup(node.parentId).add(mesh)
      } catch {}
    }
  }

  // 5. Pallet Racks & Cargo Pallets
  const sharedUprightGeom = new THREE.BoxGeometry(0.1, 10.0, 0.1)
  const sharedBeamGeom = new THREE.BoxGeometry(2.7, 0.12, 0.08)
  const sharedPalletGeom = new THREE.BoxGeometry(1.2, 0.15, 0.8)
  const sharedBoxGeom = new THREE.BoxGeometry(0.5, 0.5, 0.5)

  for (const node of allNodes) {
    const isRackType = node.type === 'warehouse:pallet-rack'
    const isItemRack =
      node.type === 'item' &&
      (node.name?.toLowerCase().includes('rack') || node.name?.toLowerCase().includes('shelf'))
    if (isRackType || isItemRack) {
      try {
        const pos = Array.isArray(node.position) ? node.position : [0, 0, 0]
        const px = Number(pos[0] || 0)
        const py = Number(pos[1] || 0)
        const pz = Number(pos[2] || 0)
        const h = Math.max(4.0, Number(node.uprightHeight || node.height || 10.0))
        const d = Math.max(0.8, Number(node.depth || 1.1))
        const bw = Math.max(1.5, Number(node.bayClearWidth || node.width || 2.7))
        const levels = Math.max(2, Math.min(8, Number(node.levels || 5)))

        const rackGroup = new THREE.Group()
        rackGroup.name = `rack_${node.id}`
        rackGroup.position.set(px, py, pz)
        if (Array.isArray(node.rotation)) {
          rackGroup.rotation.set(node.rotation[0] || 0, node.rotation[1] || 0, node.rotation[2] || 0)
        }
        rackGroup.userData = { pascalId: node.id, kind: 'rack', isAsset: true }

        // 4 upright posts
        const halfW = bw / 2
        const halfD = d / 2
        const postGeom = h === 10.0 ? sharedUprightGeom : new THREE.BoxGeometry(0.1, h, 0.1)
        const postOffsets = [
          [-halfW, h / 2, -halfD],
          [-halfW, h / 2, halfD],
          [halfW, h / 2, -halfD],
          [halfW, h / 2, halfD],
        ]
        for (const offset of postOffsets) {
          const post = new THREE.Mesh(postGeom, rackUprightMat)
          post.position.set(offset[0]!, offset[1]!, offset[2]!)
          post.userData = { kind: 'upright', isAsset: true }
          rackGroup.add(post)
        }

        // Horizontal shelf beams and pallets per level
        const levelSpacing = (h - 0.5) / levels
        for (let l = 1; l <= levels; l++) {
          const beamY = l * levelSpacing
          const fBeam = new THREE.Mesh(sharedBeamGeom, rackBeamMat)
          fBeam.position.set(0, beamY, halfD)
          fBeam.userData = { kind: 'beam', isAsset: true }
          rackGroup.add(fBeam)

          const bBeam = new THREE.Mesh(sharedBeamGeom, rackBeamMat)
          bBeam.position.set(0, beamY, -halfD)
          bBeam.userData = { kind: 'beam', isAsset: true }
          rackGroup.add(bBeam)

          // 2 Euro Pallets on shelf
          for (const palX of [-halfW * 0.5, halfW * 0.5]) {
            const pallet = new THREE.Mesh(sharedPalletGeom, palletMat)
            pallet.position.set(palX, beamY + 0.08, 0)
            pallet.userData = { kind: 'pallet', isAsset: true }
            rackGroup.add(pallet)

            const cargo = new THREE.Mesh(sharedBoxGeom, boxMat)
            cargo.position.set(palX, beamY + 0.42, 0)
            cargo.userData = { kind: 'cargo', isAsset: true }
            rackGroup.add(cargo)
          }
        }

        getLevelGroup(node.parentId).add(rackGroup)
      } catch {}
    }
  }

  // Export to GLB
  const exporter = new GLTFExporter()
  const arrayBuffer = await exporter.parseAsync(threeScene, { binary: true }) as ArrayBuffer
  const buffer = Buffer.from(arrayBuffer)

  // Target directory
  const targetDir = path.join(process.cwd(), 'apps/editor/public/assets/model')
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }
  const filePath = path.join(targetDir, `model_${sceneId}.glb`)
  fs.writeFileSync(filePath, buffer)

  // Also save layout json
  const dataDir = path.join(process.cwd(), 'apps/editor/public/assets/data')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  const layoutPath = path.join(dataDir, `layout_${sceneId}.json`)
  fs.writeFileSync(layoutPath, JSON.stringify(sceneData, null, 2))

  return filePath
}
