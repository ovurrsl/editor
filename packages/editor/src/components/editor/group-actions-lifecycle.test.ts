import { describe, expect, test } from 'bun:test'
import { cancelActiveGroupPickUp, startGroupPickUp } from './group-actions'
import { cancelActiveGroupMove3D } from './group-move-3d'

describe('Group actions gesture lifecycle and cleanup', () => {
  test('cancelActiveGroupPickUp is safely callable when no gesture is active', () => {
    expect(() => cancelActiveGroupPickUp()).not.toThrow()
  })

  test('cancelActiveGroupMove3D is safely callable when no gesture is active', () => {
    expect(() => cancelActiveGroupMove3D()).not.toThrow()
  })
})
