import * as THREE from 'three'

/**
 * Pre-allocated static scratchpads for zero-allocation reuse across hot paths.
 * Eliminates transient Vector3/Matrix4/Quaternion/Plane/Ray allocations and minor GC churn.
 */
export const _v1 = new THREE.Vector3()
export const _v2 = new THREE.Vector3()
export const _v3 = new THREE.Vector3()
export const _v4 = new THREE.Vector3()

export const _v2_1 = new THREE.Vector2()
export const _v2_2 = new THREE.Vector2()

export const _m1 = new THREE.Matrix4()
export const _m2 = new THREE.Matrix4()
export const _mInv = new THREE.Matrix4()
export const _m3_1 = new THREE.Matrix3()

export const _q1 = new THREE.Quaternion()
export const _q2 = new THREE.Quaternion()
export const _invQuat = new THREE.Quaternion()
export const _e1 = new THREE.Euler()

export const _ray = new THREE.Ray()
export const _box = new THREE.Box3()
export const _box3 = _box
export const _plane = new THREE.Plane()
export const _sphere = new THREE.Sphere()
export const _tri = new THREE.Triangle()
export const _triangle = _tri
export const _line = new THREE.Line3()

export const MathAllocPool = {
  // Vector3 registers
  v1: _v1,
  v2: _v2,
  v3: _v3,
  v4: _v4,
  _v1,
  _v2,
  _v3,
  _v4,

  // Vector2 registers
  v2_1: _v2_1,
  v2_2: _v2_2,
  _v2_1,
  _v2_2,

  // Matrix4 registers
  m1: _m1,
  m2: _m2,
  mInv: _mInv,
  _m1,
  _m2,
  _mInv,

  // Matrix3 registers
  m3_1: _m3_1,
  _m3_1,

  // Spatial primitives
  ray: _ray,
  _ray,
  box: _box,
  _box,
  box3: _box3,
  _box3,
  sphere: _sphere,
  _sphere,
  plane: _plane,
  _plane,
  tri: _tri,
  _tri,
  triangle: _tri,
  _triangle,
  line: _line,
  _line,

  // Quaternions & Euler
  q1: _q1,
  _q1,
  q2: _q2,
  _q2,
  invQuat: _invQuat,
  _invQuat,
  e1: _e1,
  _e1,

  // Reset scratchpad state to default identities
  reset() {
    _v1.set(0, 0, 0)
    _v2.set(0, 0, 0)
    _v3.set(0, 0, 0)
    _v4.set(0, 0, 0)
    _v2_1.set(0, 0)
    _v2_2.set(0, 0)
    _m1.identity()
    _m2.identity()
    _mInv.identity()
    _m3_1.identity()
    _q1.identity()
    _q2.identity()
    _invQuat.identity()
    _e1.set(0, 0, 0)
    _ray.origin.set(0, 0, 0)
    _ray.direction.set(0, 0, 0)
    _box.makeEmpty()
    _plane.normal.set(0, 1, 0)
    _plane.constant = 0
    _sphere.center.set(0, 0, 0)
    _sphere.radius = -1
    _tri.a.set(0, 0, 0)
    _tri.b.set(0, 0, 0)
    _tri.c.set(0, 0, 0)
    _line.start.set(0, 0, 0)
    _line.end.set(0, 0, 0)
  },
} as const
