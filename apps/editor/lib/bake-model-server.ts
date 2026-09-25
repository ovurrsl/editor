import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import fs from 'node:fs'
import path from 'node:path'

// Mock Blob and FileReader for GLTFExporter in Node.js
if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = class Blob {
    constructor(public parts: any[], public options?: any) {}
  } as any
}
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    onload: any
    onerror: any
    readAsArrayBuffer(blob: any) {
      if (blob && blob.parts) {
        setTimeout(() => this.onload({ target: { result: Buffer.from(blob.parts.join('')) } }), 0)
      } else {
        setTimeout(() => this.onerror(new Error('Invalid Blob')), 0)
      }
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
  
  const buildingNode = allNodes.find((n) => n.type === 'building') || { id: `building_${sceneId}` }
  const levelNodes = allNodes.filter((n) => n.type === 'level')
  if (levelNodes.length === 0) {
    levelNodes.push({ id: `level_ground_${sceneId}`, elevation: 0 })
  }

  let threeScene: any = new THREE.Scene()
  threeScene.name = 'scene-renderer'

  let isGuzeller = false
  const sceneName = (sceneData.name || '').toLowerCase()
  if (sceneId !== '6c5728d1aed7' && (sceneName.includes('g�zeller') || sceneName.includes('guzeller'))) {
    isGuzeller = true
    
    let baseModelPath = path.join(process.cwd(), 'apps/editor/public/assets/model/model_6c5728d1aed7.glb')
    if (!fs.existsSync(baseModelPath)) {
        baseModelPath = path.join(process.cwd(), 'public/assets/model/model_6c5728d1aed7.glb')
    }

    if (baseModelPath && fs.existsSync(baseModelPath)) {
      try {
        const buf = fs.readFileSync(baseModelPath)
        const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        const loadedScene = await loadBaseModel(arrayBuf)
        threeScene = loadedScene
        const toRemove: any[] = []
        threeScene.traverse((obj: any) => {
          const kind = (obj.userData?.kind || '').toLowerCase()
          if (kind === 'rack' || kind === 'warehouse:pallet-rack' || obj.userData?.isAsset === true || (obj.name && obj.name.toLowerCase().includes('pallet'))) {
            toRemove.push(obj)
          }
        })
        toRemove.forEach(obj => {
          if (obj.parent) obj.parent.remove(obj)
        })
      } catch (e) {
        console.error("Failed to load base model for baking", e)
      }
    }
  }

  const buildingGroup = new THREE.Group()
  buildingGroup.name = buildingNode.id
  buildingGroup.userData = { pascalId: buildingNode.id, kind: 'building' }
  threeScene.add(buildingGroup)

  function getLevelGroup(parentId?: string) {
    if (!parentId) return buildingGroup
    let levelG = threeScene.getObjectByName(parentId)
    if (!levelG) {
      levelG = new THREE.Group()
      levelG.name = parentId
      const lNode = levelNodes.find((l) => l.id === parentId)
      levelG.userData = { pascalId: parentId, kind: 'level' }
      if (lNode) levelG.position.y = Number(lNode.elevation || 0)
      buildingGroup.add(levelG)
    }
    return levelG
  }

  // 1. Slabs
  if (!isGuzeller) for (const node of allNodes) {
    if (node.type === 'slab' && Array.isArray(node.polygon) && node.polygon.length >= 3) {
      try {
        const poly = node.polygon
        const shape = new THREE.Shape()
        shape.moveTo(poly[0][0], poly[0][1])
        for (let i = 1; i < poly.length; i++) {
          shape.lineTo(poly[i][0], poly[i][1])
        }
        const geom = new THREE.ShapeGeometry(shape)
        const mat = new THREE.MeshStandardMaterial({ color: node.color || 0xd1d5db, roughness: 0.9 })
        const mesh = new THREE.Mesh(geom, mat)
        mesh.rotation.x = -Math.PI / 2
        mesh.position.y = -0.01 // slight offset to prevent z-fighting
        mesh.userData = { pascalId: node.id, kind: 'slab' }
        getLevelGroup(node.parentId).add(mesh)
      } catch (e) { }
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
        const thickness = Number(node.thickness || 0.2)
        const height = Number(node.height || 3.0)

        const geom = new THREE.BoxGeometry(length, height, thickness)
        const mat = new THREE.MeshStandardMaterial({ color: node.color || 0x9ca3af, roughness: 0.8 })
        const mesh = new THREE.Mesh(geom, mat)
        
        mesh.position.set(x1 + dx / 2, height / 2, z1 + dz / 2)
        mesh.rotation.y = -Math.atan2(dz, dx)
        mesh.userData = { pascalId: node.id, kind: 'wall' }
        getLevelGroup(node.parentId).add(mesh)
      } catch (e) {}
    }
  }

  // 3. Columns
  if (!isGuzeller) for (const node of allNodes) {
    if (node.type === 'column') {
      try {
        const pos = Array.isArray(node.position) ? node.position : [0, 0, 0]
        const w = Number(node.width || 0.4)
        const d = Number(node.depth || 0.4)
        const h = Number(node.height || 3.0)
        
        let geom: THREE.BufferGeometry
        if (node.shape === 'cylinder') {
          geom = new THREE.CylinderGeometry(w/2, w/2, h, 16)
        } else {
          geom = new THREE.BoxGeometry(w, h, d)
        }
        
        const mat = new THREE.MeshStandardMaterial({ color: node.color || 0x6b7280, roughness: 0.7 })
        const mesh = new THREE.Mesh(geom, mat)
        mesh.position.set(pos[0], h/2, pos[2])
        if (Array.isArray(node.rotation)) {
          mesh.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2])
        }
        mesh.userData = { pascalId: node.id, kind: 'column' }
        getLevelGroup(node.parentId).add(mesh)
      } catch (e) {}
    }
  }

  // 4. Doors
  if (!isGuzeller) for (const node of allNodes) {
    if (node.type === 'door') {
      try {
        const pos = Array.isArray(node.position) ? node.position : [0, 0, 0]
        const w = Number(node.width || 1.0)
        const h = Number(node.height || 2.1)
        const geom = new THREE.BoxGeometry(w, h, 0.1)
        const mat = new THREE.MeshStandardMaterial({ color: node.color || 0x4b5563, roughness: 0.5 })
        const mesh = new THREE.Mesh(geom, mat)
        mesh.position.set(pos[0], h/2, pos[2])
        if (Array.isArray(node.rotation)) {
          mesh.rotation.set(node.rotation[0], node.rotation[1], node.rotation[2])
        }
        mesh.userData = { pascalId: node.id, kind: 'door' }
        getLevelGroup(node.parentId).add(mesh)
      } catch (e) {}
    }
  }

  // 5. Racks via InstancedMesh
  const racks = allNodes.filter(n => n.type === 'warehouse:pallet-rack' || (n.type === 'item' && (n.name?.toLowerCase().includes('rack') || n.name?.toLowerCase().includes('shelf'))))
  
  if (racks.length > 0) {
    let totalPosts = 0
    let totalBeams = 0
    
    for (const node of racks) {
      const levels = Math.max(2, Math.min(8, Number(node.levels || 5)))
      totalPosts += 4
      totalBeams += levels * 2
    }

    const sharedUprightGeom = new THREE.BoxGeometry(0.1, 1, 0.1)
    const sharedBeamGeom = new THREE.BoxGeometry(1, 0.12, 0.08)
    const rackUprightMat = new THREE.MeshStandardMaterial({ roughness: 0.5 })
    const rackBeamMat = new THREE.MeshStandardMaterial({ roughness: 0.5 })

    const instancedPosts = new THREE.InstancedMesh(sharedUprightGeom, rackUprightMat, totalPosts)
    const instancedBeams = new THREE.InstancedMesh(sharedBeamGeom, rackBeamMat, totalBeams)
    
    instancedPosts.userData = { kind: 'upright', isAsset: true }
    instancedBeams.userData = { kind: 'beam', isAsset: true }

    const tempObj = new THREE.Object3D()
    const rackPos = new THREE.Vector3()
    const rackQuat = new THREE.Quaternion()
    const c = new THREE.Color()

    let postIdx = 0
    let beamIdx = 0

    for (const node of racks) {
      try {
        const pos = Array.isArray(node.position) ? node.position : [0, 0, 0]
        const h = Math.max(4.0, Number(node.uprightHeight || node.height || 10.0))
        const d = Math.max(0.8, Number(node.depth || 1.1))
        const bw = Math.max(1.5, Number(node.bayClearWidth || node.width || 2.7))
        const levels = Math.max(2, Math.min(8, Number(node.levels || 5)))

        rackPos.set(pos[0], pos[1], pos[2])
        if (Array.isArray(node.rotation)) {
          tempObj.rotation.set(node.rotation[0] || 0, node.rotation[1] || 0, node.rotation[2] || 0)
          rackQuat.copy(tempObj.quaternion)
        } else {
          rackQuat.identity()
        }

        const upColor = c.set(node.uprightColor || 0x1e40af)
        const bmColor = c.set(node.beamColor || 0xf97316)

        const halfW = bw / 2
        const halfD = d / 2
        const postOffsets = [
          [-halfW, h / 2, -halfD],
          [-halfW, h / 2, halfD],
          [halfW, h / 2, -halfD],
          [halfW, h / 2, halfD],
        ]

        for (const offset of postOffsets) {
          tempObj.position.set(offset[0] as number, offset[1] as number, offset[2] as number)
          tempObj.position.applyQuaternion(rackQuat)
          tempObj.position.add(rackPos)
          tempObj.quaternion.copy(rackQuat)
          tempObj.scale.set(1, h, 1)
          tempObj.updateMatrix()
          
          instancedPosts.setMatrixAt(postIdx, tempObj.matrix)
          instancedPosts.setColorAt(postIdx, upColor)
          postIdx++
        }

        const levelSpacing = (h - 0.5) / levels
        for (let l = 1; l <= levels; l++) {
          const beamY = l * levelSpacing
          
          tempObj.position.set(0, beamY, halfD)
          tempObj.position.applyQuaternion(rackQuat)
          tempObj.position.add(rackPos)
          tempObj.quaternion.copy(rackQuat)
          tempObj.scale.set(bw, 1, 1)
          tempObj.updateMatrix()
          instancedBeams.setMatrixAt(beamIdx, tempObj.matrix)
          instancedBeams.setColorAt(beamIdx, bmColor)
          beamIdx++
          
          tempObj.position.set(0, beamY, -halfD)
          tempObj.position.applyQuaternion(rackQuat)
          tempObj.position.add(rackPos)
          tempObj.quaternion.copy(rackQuat)
          tempObj.scale.set(bw, 1, 1)
          tempObj.updateMatrix()
          instancedBeams.setMatrixAt(beamIdx, tempObj.matrix)
          instancedBeams.setColorAt(beamIdx, bmColor)
          beamIdx++
        }
      } catch (e) {}
    }
    
    instancedPosts.instanceMatrix.needsUpdate = true
    if(instancedPosts.instanceColor) instancedPosts.instanceColor.needsUpdate = true
    instancedBeams.instanceMatrix.needsUpdate = true
    if(instancedBeams.instanceColor) instancedBeams.instanceColor.needsUpdate = true

    buildingGroup.add(instancedPosts)
    buildingGroup.add(instancedBeams)
  }

  return new Promise((resolve) => {
    const exporter = new GLTFExporter()
    exporter.parse(
      threeScene,
      (gltf: any) => {
        try {
          const outDir = path.join(process.cwd(), '.next/cache/baked-scenes')
          if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true })
          }
          const outPath = path.join(outDir, `scene_${sceneId}.glb`)
          
          if (gltf instanceof ArrayBuffer) {
            fs.writeFileSync(outPath, Buffer.from(gltf))
          } else {
            const jsonStr = JSON.stringify(gltf)
            fs.writeFileSync(outPath, jsonStr)
          }
          resolve(outPath)
        } catch (e) {
          console.error("File write error:", e)
          resolve(null)
        }
      },
      (err: any) => {
        console.error("GLTFExport error:", err)
        resolve(null)
      },
      { binary: true } // Request .glb format
    )
  })
}
