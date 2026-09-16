import { describe, expect, test } from 'bun:test'
import { OrthographicCamera, PerspectiveCamera } from 'three'
import {
  createFrameClock,
  hasCameraTransformChanged,
  shouldPauseForIdle,
} from './frame-limiter'

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

  test('resetBaseline clears wall-time anchor to prevent delta warp after long idle sleep', () => {
    const clock = createFrameClock(0)
    clock.sample(1000, 20) // baseline at 1000ms
    expect(clock.sample(1020, 20)).toBeCloseTo(0.02)

    // Idle sleep occurs for 10 seconds
    clock.resetBaseline()

    // First tick after waking up re-baselines without advancing time
    expect(clock.sample(11020, 20)).toBeNull()
    // Next frame advances by 20ms delta only
    expect(clock.sample(11040, 20)).toBeCloseTo(0.04)
  })

  test('hasCameraTransformChanged detects position changes exceeding epsilon', () => {
    const cam = new PerspectiveCamera()
    cam.position.set(0, 0, 0)
    cam.quaternion.set(0, 0, 0, 1)
    const prev = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, zoom: 1 }

    expect(hasCameraTransformChanged(cam, prev)).toBe(false)

    // Sub-epsilon jitter ignored
    cam.position.set(1e-7, 0, 0)
    expect(hasCameraTransformChanged(cam, prev)).toBe(false)

    // Position change detected
    cam.position.set(0.01, 0, 0)
    expect(hasCameraTransformChanged(cam, prev)).toBe(true)

    cam.position.set(0, 0.01, 0)
    expect(hasCameraTransformChanged(cam, prev)).toBe(true)

    cam.position.set(0, 0, 0.01)
    expect(hasCameraTransformChanged(cam, prev)).toBe(true)
  })

  test('hasCameraTransformChanged detects rotation changes exceeding epsilon', () => {
    const cam = new PerspectiveCamera()
    cam.position.set(0, 0, 0)
    cam.quaternion.set(0, 0, 0, 1)
    const prev = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, zoom: 1 }

    // Sub-epsilon rotation jitter ignored
    cam.quaternion.set(1e-7, 0, 0, 1)
    expect(hasCameraTransformChanged(cam, prev)).toBe(false)

    // Meaningful rotation change detected
    cam.quaternion.set(0.1, 0, 0, 0.995)
    expect(hasCameraTransformChanged(cam, prev)).toBe(true)
  })

  test('hasCameraTransformChanged detects zoom changes in orthographic camera', () => {
    const cam = new OrthographicCamera()
    cam.zoom = 1
    const prev = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, zoom: 1 }

    expect(hasCameraTransformChanged(cam, prev)).toBe(false)

    // Sub-epsilon zoom jitter ignored
    cam.zoom = 1 + 1e-7
    expect(hasCameraTransformChanged(cam, prev)).toBe(false)

    // Zoom change detected
    cam.zoom = 1.05
    expect(hasCameraTransformChanged(cam, prev)).toBe(true)
  })

  test('shouldPauseForIdle enforces 1.5s dampening window and pauses rAF when static', () => {
    const lastActive = 1000
    const idleWindow = 1500

    // Within dampening window (active/camera damping in progress)
    expect(shouldPauseForIdle(lastActive, 1500, idleWindow, false)).toBe(false) // 500ms elapsed
    expect(shouldPauseForIdle(lastActive, 2000, idleWindow, false)).toBe(false) // 1000ms elapsed
    expect(shouldPauseForIdle(lastActive, 2499, idleWindow, false)).toBe(false) // 1499ms elapsed

    // At or past 1.5s window -> pauses
    expect(shouldPauseForIdle(lastActive, 2500, idleWindow, false)).toBe(true) // exactly 1500ms
    expect(shouldPauseForIdle(lastActive, 5000, idleWindow, false)).toBe(true) // 4000ms elapsed
  })

  test('shouldPauseForIdle preserves DRAW_DISABLED for headless bake passes', () => {
    const lastActive = 1000
    const idleWindow = 1500

    // Even after 100 seconds of no user interaction, DRAW_DISABLED never pauses
    expect(shouldPauseForIdle(lastActive, 100_000, idleWindow, true)).toBe(false)
  })

  test('shouldPauseForIdle respects custom or disabled idle windows', () => {
    const lastActive = 1000

    // Custom 3000ms window
    expect(shouldPauseForIdle(lastActive, 3000, 3000, false)).toBe(false) // 2000ms < 3000ms
    expect(shouldPauseForIdle(lastActive, 4000, 3000, false)).toBe(true) // 3000ms >= 3000ms

    // Disabled window (<= 0 or non-finite) never pauses
    expect(shouldPauseForIdle(lastActive, 100_000, 0, false)).toBe(false)
    expect(shouldPauseForIdle(lastActive, 100_000, -1, false)).toBe(false)
    expect(shouldPauseForIdle(lastActive, 100_000, Number.NaN, false)).toBe(false)
  })
})

