// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { stepZoneOpacity } from './zone-opacity'

describe('stepZoneOpacity', () => {
  test('a long frame lands exactly on the target instead of overshooting', () => {
    for (const delta of [0.1, 0.25, 1]) {
      expect(stepZoneOpacity(0, 1, delta)).toBe(1)
      expect(stepZoneOpacity(1, 0, delta)).toBe(0)
    }
  })

  test('a 60 fps frame moves partway toward the target', () => {
    const next = stepZoneOpacity(0, 1, 1 / 60)
    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThan(1)
    expect(next).toBeCloseTo(10 / 60)
  })

  test('slow frames across the transition window stay within 0..1', () => {
    let opacity = 0
    for (let elapsed = 0; elapsed < 0.4; elapsed += 0.3) {
      opacity = stepZoneOpacity(opacity, 1, 0.3)
      expect(opacity).toBeGreaterThanOrEqual(0)
      expect(opacity).toBeLessThanOrEqual(1)
    }
    expect(opacity).toBe(1)
  })
})
