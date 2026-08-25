import { describe, expect, test } from 'bun:test'
import {
  resolveCaptureSize,
  SNAPSHOT_MAX_RENDER_EDGE,
  SNAPSHOT_SUPERSAMPLE,
} from './snapshot-pipeline'

/**
 * These assert the WRONG answers are not produced. Every one of them looks
 * fine on screen: the snapshot still appears, still carries the requested
 * number in its metadata, and only the sharpness — or the lack of it — says
 * anything is off.
 */
describe('resolveCaptureSize', () => {
  /**
   * The reported defect. A 1920x1080 request in a 1200x700 window was rendered
   * at 1200x700 and stretched to reach the number.
   */
  test('renders ABOVE the window when the request is larger', () => {
    const size = resolveCaptureSize({ w: 1200, h: 700 }, { w: 1920, h: 1080 })
    expect(size.w).toBeGreaterThanOrEqual(1920)
    expect(size.h).toBeGreaterThan(700)
  })

  /**
   * The trap in fixing it. The camera's aspect comes from the canvas, so
   * raising one axis alone renders a STRETCHED picture — sharper and wrong,
   * which is worse than soft and right.
   */
  test('scales both axes by one factor, keeping the canvas aspect', () => {
    const canvas = { w: 1200, h: 700 }
    const size = resolveCaptureSize(canvas, { w: 1920, h: 1080 })
    expect(size.w / size.h).toBeCloseTo(canvas.w / canvas.h, 2)
  })

  /**
   * Rendering below the window trades a soft picture for a smaller one. A small
   * request off a large canvas still supersamples — it just must never come out
   * under what the window already had.
   */
  test('never renders below the window', () => {
    const size = resolveCaptureSize({ w: 2000, h: 1200 }, { w: 640, h: 360 })
    expect(size.w).toBeGreaterThanOrEqual(2000)
    expect(size.h).toBeGreaterThanOrEqual(1200)
    expect(size.w / size.h).toBeCloseTo(2000 / 1200, 2)
  })

  /** The GPU cap still binds; asking for more cannot exceed it. */
  test('stays within the render cap', () => {
    const size = resolveCaptureSize({ w: 1200, h: 700 }, { w: 8000, h: 6000 })
    expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(SNAPSHOT_MAX_RENDER_EDGE)
  })

  /**
   * The point of the whole change: the render carries more samples than the
   * saved file. Without this the downscale has nothing to average and FXAA's
   * blur lands directly on the output — which is the soft picture that was
   * reported.
   */
  test('renders above the saved size, so the downscale has samples to average', () => {
    const size = resolveCaptureSize({ w: 1200, h: 700 }, { w: 1920, h: 1080 })
    expect(size.w).toBeGreaterThanOrEqual(1920 * SNAPSHOT_SUPERSAMPLE)
  })

  /**
   * `viewport` and `area` are readings of what is on screen. Re-rendering them
   * larger would silently change what the user framed.
   */
  test.each(['viewport', 'area'] as const)('leaves %s at the canvas', (mode) => {
    expect(resolveCaptureSize({ w: 1200, h: 700 }, { w: 1920, h: 1080 }, mode)).toEqual({
      w: 1200,
      h: 700,
    })
  })

  /** A zero-sized canvas (unmounted, hidden tab) must not divide by zero. */
  test('survives a zero-sized canvas', () => {
    const size = resolveCaptureSize({ w: 0, h: 0 }, { w: 1920, h: 1080 })
    expect(Number.isFinite(size.w) && Number.isFinite(size.h)).toBe(true)
  })
})
