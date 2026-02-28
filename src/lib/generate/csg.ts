import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ManifoldToplevel, Manifold as ManifoldType } from 'manifold-3d'
import { createKeycapMaterial, KEYCAP_BODY_COLOR } from './materials'

let _module: ManifoldToplevel | null = null
let _initPromise: Promise<ManifoldToplevel> | null = null

async function getManifold(): Promise<ManifoldToplevel> {
  if (_module) return _module
  if (!_initPromise) {
    _initPromise = (async () => {
      const { default: ManifoldModule } = await import('manifold-3d')
      const wasmUrl = new URL('manifold-3d/manifold.wasm', import.meta.url).href
      const m = await ManifoldModule({ locateFile: () => wasmUrl })
      m.setup()
      _module = m
      return m
    })()
  }
  return _initPromise
}

function toManifold(module: ManifoldToplevel, geometry: THREE.BufferGeometry): ManifoldType {
  const indexed: THREE.BufferGeometry = geometry.index ? geometry : mergeVertices(geometry)

  const posAttr = indexed.attributes.position
  const vertProperties: Float32Array =
    posAttr.array instanceof Float32Array ? posAttr.array : new Float32Array(posAttr.array)

  const src = indexed.index!.array
  const triVerts: Uint32Array = src instanceof Uint32Array ? src : new Uint32Array(src)

  const mesh = new module.Mesh({ numProp: 3, vertProperties, triVerts })
  mesh.merge()
  return new module.Manifold(mesh)
}

function fromManifold(manifold: ManifoldType, material: THREE.Material): THREE.Mesh {
  const m = manifold.getMesh()
  const numProp = m.numProp
  const numVerts = m.numVert

  const positions = new Float32Array(numVerts * 3)
  for (let i = 0; i < numVerts; i++) {
    positions[i * 3] = m.vertProperties[i * numProp]
    positions[i * 3 + 1] = m.vertProperties[i * numProp + 1]
    positions[i * 3 + 2] = m.vertProperties[i * numProp + 2]
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setIndex(new THREE.BufferAttribute(new Uint32Array(m.triVerts), 1))

  const flat = geom.toNonIndexed()
  flat.computeVertexNormals()
  flat.computeBoundingBox()

  const mesh = new THREE.Mesh(flat, material)
  mesh.updateMatrix()
  mesh.matrixAutoUpdate = false
  return mesh
}

export function makeMesh(geometry: THREE.BufferGeometry, color = KEYCAP_BODY_COLOR): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, createKeycapMaterial(color))
  mesh.updateMatrix()
  mesh.matrixAutoUpdate = false
  return mesh
}

export async function csgIntersect(meshA: THREE.Mesh, meshB: THREE.Mesh): Promise<THREE.Mesh> {
  const module = await getManifold()
  const mA = toManifold(module, meshA.geometry as THREE.BufferGeometry)
  const mB = toManifold(module, meshB.geometry as THREE.BufferGeometry)
  const result = mA.intersect(mB)
  mA.delete()
  mB.delete()
  const out = fromManifold(result, meshB.material as THREE.Material)
  result.delete()
  return out
}

export async function csgSubtract(meshA: THREE.Mesh, meshB: THREE.Mesh): Promise<THREE.Mesh> {
  const module = await getManifold()
  const mA = toManifold(module, meshA.geometry as THREE.BufferGeometry)
  const mB = toManifold(module, meshB.geometry as THREE.BufferGeometry)
  const result = mA.subtract(mB)
  mA.delete()
  mB.delete()
  const out = fromManifold(result, meshA.material as THREE.Material)
  result.delete()
  return out
}

export async function csgUnionMeshes(
  meshes: THREE.Mesh[],
  yieldAndCheck?: () => Promise<void>
): Promise<THREE.Mesh | null> {
  if (!meshes || meshes.length === 0) return null

  const module = await getManifold()

  if (yieldAndCheck) await yieldAndCheck()

  const manifolds = meshes.map(m => toManifold(module, m.geometry as THREE.BufferGeometry))

  const result = module.Manifold.union(manifolds)
  manifolds.forEach(m => m.delete())

  const out = fromManifold(result, meshes[0].material as THREE.Material)
  result.delete()
  return out
}
