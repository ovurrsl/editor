import { describe, expect, test } from 'bun:test'
import { createFrameClock } from './frame-limiter'

describe('createFrameClock Monotonic Clock & Frame Limiting', () => {
  test('uses the first rAF sample only as a wall-time baseline without advancing time', () => {
    const clock = createFrameClock(12)

    // First sample establishes baseline, returns null
    expect(clock.sample(60_000, 20)).toBeNull()
    // Second sample 20ms later returns advanced frameTime
    expect(clock.sample(60_020, 20)).toBeCloseTo(12.02)
  })

  test('preserves the synthetic time across limiter restarts', () => {
    const firstLimiter = createFrameClock(0)
    firstLimiter.sample(1_000, 20)
    const priorTime = firstLimiter.sample(2_000, 20)
    if (priorTime === null) throw new Error('frame expected')

    const restartedLimiter = createFrameClock(priorTime)
    expect(restartedLimiter.sample(75_000, 1000 / 30)).toBeNull()
    expect(restartedLimiter.sample(75_034, 1000 / 30)).toBeCloseTo(priorTime + 1 / 30)
  })

  test('carries sub-frame remainder into the next sample', () => {
    const clock = createFrameClock()
    clock.sample(100, 20)

    // Elapsed 45ms (2 intervals of 20ms + 5ms remainder) -> 2 * 20ms = 40ms advanced
    expect(clock.sample(145, 20)).toBeCloseTo(0.04)
    // Elapsed from 140ms to 160ms = 20ms -> 1 interval of 20ms = 20ms advanced -> total 60ms
    expect(clock.sample(160, 20)).toBeCloseTo(0.06)
  })

  test('supports monotonic timer and resume kicks for instant wakeup', () => {
    const clock = createFrameClock(2)

    // Instant step advances monotonic frame time directly
    expect(clock.step(0.02)).toBeCloseTo(2.02)
    expect(clock.step(0.001)).toBeCloseTo(2.021)
    expect(clock.step(1 / 1000)).toBeCloseTo(2.022)
  })

  test('regulates steady frame intervals across standard FPS targets', () => {
    const targets = [
      { fps: 30, interval: 1000 / 30 },
      { fps: 50, interval: 1000 / 50 },
      { fps: 60, interval: 1000 / 60 },
      { fps: 120, interval: 1000 / 120 },
    ]

    for (const { fps, interval } of targets) {
      const clock = createFrameClock(0)
      let wallTime = 10_000
      expect(clock.sample(wallTime, interval)).toBeNull()

      for (let frame = 1; frame <= 10; frame++) {
        wallTime += interval + 0.001
        const result = clock.sample(wallTime, interval)
        expect(result).not.toBeNull()
        expect(result!).toBeCloseTo(frame * (interval / 1000), 4)
      }
    }
  })

  test('ignores samples that arrive before the target interval expires', () => {
    const clock = createFrameClock(0)
    const interval = 20 // 50 FPS

    expect(clock.sample(1000, interval)).toBeNull() // baseline
    expect(clock.sample(1005, interval)).toBeNull() // 5ms elapsed < 20ms
    expect(clock.sample(1010, interval)).toBeNull() // 10ms elapsed < 20ms
    expect(clock.sample(1019, interval)).toBeNull() // 19ms elapsed < 20ms

    // Finally 20ms elapsed
    const result = clock.sample(1020, interval)
    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(0.02)
  })

  test('handles large frame gaps (e.g. background tab throttling) accurately without runaway', () => {
    const clock = createFrameClock(0)
    const interval = 20 // 50 FPS

    expect(clock.sample(1000, interval)).toBeNull() // baseline

    // Background tab sleeps for 2000ms (2 seconds = 100 frames)
    const afterSleep = clock.sample(3000, interval)
    expect(afterSleep).not.toBeNull()
    expect(afterSleep!).toBeCloseTo(2.0)
  })

  test('effectiveFps fallback handles invalid, negative, or zero FPS values', () => {
    const resolveEffectiveFps = (fps?: number) =>
      Number.isFinite(fps) && (fps as number) > 0 ? (fps as number) : 50

    expect(resolveEffectiveFps(undefined)).toBe(50)
    expect(resolveEffectiveFps(0)).toBe(50)
    expect(resolveEffectiveFps(-30)).toBe(50)
    expect(resolveEffectiveFps(Number.NaN)).toBe(50)
    expect(resolveEffectiveFps(Number.POSITIVE_INFINITY)).toBe(50)
    expect(resolveEffectiveFps(60)).toBe(60)
    expect(resolveEffectiveFps(120)).toBe(120)
  })
})
