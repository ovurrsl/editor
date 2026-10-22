import { describe, expect, it } from 'bun:test'
import { smoothToward } from './smooth-toward'

describe('smoothToward', () => {
  it('lands exactly on the target when a frame is long', () => {
    expect(smoothToward(0, 7.5, 0.5, 12)).toBe(7.5)
    expect(smoothToward(-3, 7.5, 5, 12)).toBe(7.5)
  })

  it('lands exactly on the target at the delta = 1/speed boundary', () => {
    expect(smoothToward(0, 7.5, 1 / 12, 12)).toBe(7.5)
  })

  it('moves partway without overshooting on a normal frame', () => {
    const next = smoothToward(0, 7.5, 1 / 60, 12)
    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThan(7.5)
  })

  it('stays on the target across repeated long frames instead of oscillating', () => {
    let y = 0
    for (let i = 0; i < 20; i++) y = smoothToward(y, 7.5, 0.25, 12)
    expect(y).toBe(7.5)
  })
})
