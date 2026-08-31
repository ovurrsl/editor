import { describe, expect, it } from 'bun:test'
import {
  MathAllocPool,
  _box,
  _box3,
  _e1,
  _invQuat,
  _line,
  _m1,
  _m2,
  _m3_1,
  _mInv,
  _plane,
  _q1,
  _q2,
  _ray,
  _sphere,
  _tri,
  _triangle,
  _v1,
  _v2,
  _v2_1,
  _v2_2,
  _v3,
  _v4,
} from './math-pool'

describe('Viewer MathAllocPool', () => {
  it('provides pre-allocated singletons of standard Three.js math types', () => {
    expect(_v1).toBeDefined()
    expect(_v2).toBeDefined()
    expect(_v3).toBeDefined()
    expect(_v4).toBeDefined()
    expect(_v2_1).toBeDefined()
    expect(_v2_2).toBeDefined()
    expect(_m1).toBeDefined()
    expect(_m2).toBeDefined()
    expect(_mInv).toBeDefined()
    expect(_m3_1).toBeDefined()
    expect(_q1).toBeDefined()
    expect(_q2).toBeDefined()
    expect(_invQuat).toBeDefined()
    expect(_e1).toBeDefined()
    expect(_ray).toBeDefined()
    expect(_box).toBeDefined()
    expect(_box3).toBeDefined()
    expect(_plane).toBeDefined()
    expect(_sphere).toBeDefined()
    expect(_tri).toBeDefined()
    expect(_triangle).toBeDefined()
    expect(_line).toBeDefined()
  })

  it('exposes namespaced pool getters on MathAllocPool', () => {
    expect(MathAllocPool.v1).toBe(_v1)
    expect(MathAllocPool.v2).toBe(_v2)
    expect(MathAllocPool.v3).toBe(_v3)
    expect(MathAllocPool.v4).toBe(_v4)
    expect(MathAllocPool.v2_1).toBe(_v2_1)
    expect(MathAllocPool.v2_2).toBe(_v2_2)
    expect(MathAllocPool.m1).toBe(_m1)
    expect(MathAllocPool.m2).toBe(_m2)
    expect(MathAllocPool.mInv).toBe(_mInv)
    expect(MathAllocPool.m3_1).toBe(_m3_1)
    expect(MathAllocPool.q1).toBe(_q1)
    expect(MathAllocPool.q2).toBe(_q2)
    expect(MathAllocPool.invQuat).toBe(_invQuat)
    expect(MathAllocPool.e1).toBe(_e1)
    expect(MathAllocPool.ray).toBe(_ray)
    expect(MathAllocPool.box).toBe(_box)
    expect(MathAllocPool.box3).toBe(_box3)
    expect(MathAllocPool.plane).toBe(_plane)
    expect(MathAllocPool.sphere).toBe(_sphere)
    expect(MathAllocPool.tri).toBe(_tri)
    expect(MathAllocPool.triangle).toBe(_triangle)
    expect(MathAllocPool.line).toBe(_line)
  })

  it('allows zero-allocation scratch math operations across vector and matrix registers', () => {
    _v1.set(1, 2, 3)
    _v2.set(4, 5, 6)
    _v3.addVectors(_v1, _v2)
    expect(_v3.x).toBe(5)
    expect(_v3.y).toBe(7)
    expect(_v3.z).toBe(9)

    _m1.makeTranslation(10, 20, 30)
    _v4.copy(_v3).applyMatrix4(_m1)
    expect(_v4.x).toBe(15)
    expect(_v4.y).toBe(27)
    expect(_v4.z).toBe(39)

    _q1.setFromAxisAngle(_v1.set(0, 1, 0), Math.PI / 2)
    _invQuat.copy(_q1).invert()
    _v2.set(1, 0, 0).applyQuaternion(_q1)
    expect(Math.abs(_v2.x)).toBeLessThan(1e-6)
    expect(Math.abs(_v2.z - -1)).toBeLessThan(1e-6)
  })

  it('resets all scratchpad registers to default identities when reset() is called', () => {
    _v1.set(99, 99, 99)
    _v2_1.set(88, 88)
    _m1.makeTranslation(1, 2, 3)
    _q1.set(0.5, 0.5, 0.5, 0.5)

    MathAllocPool.reset()

    expect(_v1.x).toBe(0)
    expect(_v1.y).toBe(0)
    expect(_v1.z).toBe(0)
    expect(_v2_1.x).toBe(0)
    expect(_v2_1.y).toBe(0)
    expect(_m1.elements[12]).toBe(0)
    expect(_m1.elements[13]).toBe(0)
    expect(_m1.elements[14]).toBe(0)
    expect(_q1.x).toBe(0)
    expect(_q1.y).toBe(0)
    expect(_q1.z).toBe(0)
    expect(_q1.w).toBe(1)
  })
})
