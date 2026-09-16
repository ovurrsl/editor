import { useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import type { Camera } from 'three'
import { useScene } from '@pascal-app/core'
import useViewer from '../../store/use-viewer'

export type FrameLimiterProps = {
  fps?: number
  paused?: boolean
  /** Time in ms before pausing/throttling when scene is static. Defaults to 1500 (1.5s). */
  idleWindowMs?: number
  /** Target FPS when idle. Defaults to 0 (pauses requestAnimationFrame completely). */
  idleFps?: number
}

export type FrameClock = {
  sample: (wallTimeMs: number, intervalMs: number) => number | null
  step: (seconds: number) => number
  resetBaseline: () => void
}

/**
 * Keeps R3F's manual clock monotonic while each limiter effect owns a fresh
 * wall-time baseline. The first rAF sample establishes that baseline instead
 * of treating the browser's process uptime as elapsed frame time.
 */
export function createFrameClock(initialTime = 0): FrameClock {
  let frameTime = initialTime
  let previousWallTime: number | null = null

  return {
    sample(wallTimeMs, intervalMs) {
      if (previousWallTime === null) {
        previousWallTime = wallTimeMs
        return null
      }

      const elapsedMs = wallTimeMs - previousWallTime
      if (elapsedMs < intervalMs) return null

      const remainderMs = elapsedMs % intervalMs
      frameTime += (elapsedMs - remainderMs) / 1000
      previousWallTime = wallTimeMs - remainderMs
      return frameTime
    },
    step(seconds) {
      frameTime += seconds
      return frameTime
    },
    resetBaseline() {
      previousWallTime = null
    },
  }
}

export function hasCameraTransformChanged(
  camera: Camera,
  prev: {
    x: number
    y: number
    z: number
    qx: number
    qy: number
    qz: number
    qw: number
    zoom: number
  },
  epsilon = 1e-5,
): boolean {
  const pos = camera.position
  const quat = camera.quaternion
  const zoom =
    'zoom' in camera && typeof (camera as any).zoom === 'number' ? (camera as any).zoom : 1

  const dx = pos.x - prev.x
  const dy = pos.y - prev.y
  const dz = pos.z - prev.z
  if (dx * dx + dy * dy + dz * dz > epsilon * epsilon) return true

  const dqx = quat.x - prev.qx
  const dqy = quat.y - prev.qy
  const dqz = quat.z - prev.qz
  const dqw = quat.w - prev.qw
  if (dqx * dqx + dqy * dqy + dqz * dqz + dqw * dqw > epsilon * epsilon) return true

  if (Math.abs(zoom - prev.zoom) > epsilon) return true

  return false
}

export function shouldPauseForIdle(
  lastActiveTime: number,
  currentTime: number,
  idleWindowMs: number,
  drawDisabled: boolean,
): boolean {
  if (drawDisabled) return false
  if (!Number.isFinite(idleWindowMs) || idleWindowMs <= 0) return false
  return currentTime - lastActiveTime >= idleWindowMs
}

// `?disable=draw` (see post-processing.tsx): the page renders no real frames,
// and Chromium's no-damage scheduler then throttles requestAnimationFrame to
// 1Hz on Linux (measured in the headless bake worker — every useFrame system
// ticked once per second and a heavy scene took 300+ seconds to settle). A
// plain timer is never throttled on a visible page, so drive the loop with
// setInterval instead of rAF when nothing is drawn.
export const DRAW_DISABLED =
  typeof window !== 'undefined' &&
  typeof window.location !== 'undefined' &&
  new Set(
    (new URLSearchParams(window.location.search ?? '').get('disable') ?? '')
      .split(',')
      .map((s) => s.trim()),
  ).has('draw')

const FrameLimiter: React.FC<FrameLimiterProps> = ({
  fps = 50,
  paused = false,
  idleWindowMs = 1500,
  idleFps = 0,
}) => {
  const { advance, set, frameloop: initFrameloop } = useThree()
  const nextFrameTimeRef = useRef(0)
  const renderer = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const dpr = useThree((state) => state.viewport.dpr)
  // Fully covered canvas (e.g. studio gallery) → stop advancing frames
  const renderPaused = useViewer((s) => s.renderPaused)

  useLayoutEffect(() => {
    if (renderPaused || paused) return
    const clock = createFrameClock(nextFrameTimeRef.current)
    let raf: number | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let sizeSynced = false
    const effectiveFps = Number.isFinite(fps) && fps > 0 ? fps : 50
    const interval = 1000 / effectiveFps
    const idleInterval = idleFps > 0 ? 1000 / idleFps : 0

    let lastActiveTime = performance.now()
    let isIdle = false

    const prevCam = {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      qx: camera.quaternion.x,
      qy: camera.quaternion.y,
      qz: camera.quaternion.z,
      qw: camera.quaternion.w,
      zoom:
        'zoom' in camera && typeof (camera as any).zoom === 'number' ? (camera as any).zoom : 1,
    }

    function syncSize() {
      if (sizeSynced) return
      renderer.setPixelRatio(dpr)
      renderer.setSize(size.width, size.height, false)
      sizeSynced = true
    }

    function wake(now = performance.now()) {
      lastActiveTime = now
      if (isIdle) {
        isIdle = false
        clock.resetBaseline()
        if (raf === null && !DRAW_DISABLED) {
          syncSize()
          const frameTime = clock.step(1 / 1000)
          nextFrameTimeRef.current = frameTime
          advance(frameTime)
          raf = requestAnimationFrame(tick)
        }
      }
    }

    function tick(t: DOMHighResTimeStamp) {
      syncSize()

      // Detect camera movement (including inertial damping)
      if (hasCameraTransformChanged(camera, prevCam)) {
        prevCam.x = camera.position.x
        prevCam.y = camera.position.y
        prevCam.z = camera.position.z
        prevCam.qx = camera.quaternion.x
        prevCam.qy = camera.quaternion.y
        prevCam.qz = camera.quaternion.z
        prevCam.qw = camera.quaternion.w
        prevCam.zoom =
          'zoom' in camera && typeof (camera as any).zoom === 'number' ? (camera as any).zoom : 1
        lastActiveTime = t
      }

      const activeElapsed = t - lastActiveTime
      const sceneIsIdle = shouldPauseForIdle(lastActiveTime, t, idleWindowMs, DRAW_DISABLED)

      if (sceneIsIdle) {
        if (idleFps <= 0) {
          // Pause rAF loop completely when static
          isIdle = true
          raf = null
          return
        }
        // Throttled idle rate
        raf = requestAnimationFrame(tick)
        const frameTime = clock.sample(t, idleInterval)
        if (frameTime === null) return
        nextFrameTimeRef.current = frameTime
        advance(frameTime)
        return
      }

      // Active / dampening window: full target FPS
      raf = requestAnimationFrame(tick)
      const frameTime = clock.sample(t, interval)
      if (frameTime === null) return
      nextFrameTimeRef.current = frameTime
      advance(frameTime)
    }

    function kick() {
      wake()
      syncSize()
      const frameTime = clock.step(1 / 1000)
      nextFrameTimeRef.current = frameTime
      advance(frameTime)
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        wake()
        kick()
      }
    }

    // Set frameloop to never, it will shut down the default render loop
    set({ frameloop: 'never' })

    if (DRAW_DISABLED) {
      timer = setInterval(() => {
        const frameTime = clock.step(interval / 1000)
        nextFrameTimeRef.current = frameTime
        advance(frameTime)
      }, interval)
    } else {
      // Kick off custom render loop
      raf = requestAnimationFrame(tick)

      // rAF can stall while a tab is hidden, unfocused, or occluded. With the
      // default loop disabled, force one current frame as soon as it resumes.
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', onVisibilityChange)
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('focus', kick)
        window.addEventListener('pageshow', kick)
      }

      // Event listeners to detect interaction and wake loop
      const dom = renderer?.domElement
      const handleActivity = () => wake()

      if (dom && typeof dom.addEventListener === 'function') {
        dom.addEventListener('pointerdown', handleActivity, { passive: true })
        dom.addEventListener('pointermove', handleActivity, { passive: true })
        dom.addEventListener('pointerup', handleActivity, { passive: true })
        dom.addEventListener('wheel', handleActivity, { passive: true })
        dom.addEventListener('touchstart', handleActivity, { passive: true })
        dom.addEventListener('touchmove', handleActivity, { passive: true })
        dom.addEventListener('touchend', handleActivity, { passive: true })
      }

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('pointermove', handleActivity, { passive: true })
        window.addEventListener('pointerup', handleActivity, { passive: true })
        window.addEventListener('keydown', handleActivity, { passive: true })
        window.addEventListener('keyup', handleActivity, { passive: true })
      }

      // Store subscriptions for reactive state changes
      const unsubViewer =
        typeof useViewer?.subscribe === 'function' ? useViewer.subscribe(() => wake()) : () => {}
      const unsubScene =
        typeof useScene?.subscribe === 'function' ? useScene.subscribe(() => wake()) : () => {}

      // Restore initial setting
      return () => {
        if (raf) {
          cancelAnimationFrame(raf)
        }
        if (timer) {
          clearInterval(timer)
        }

        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
          document.removeEventListener('visibilitychange', onVisibilityChange)
        }
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
          window.removeEventListener('focus', kick)
          window.removeEventListener('pageshow', kick)
          window.removeEventListener('pointermove', handleActivity)
          window.removeEventListener('pointerup', handleActivity)
          window.removeEventListener('keydown', handleActivity)
          window.removeEventListener('keyup', handleActivity)
        }

        if (dom && typeof dom.removeEventListener === 'function') {
          dom.removeEventListener('pointerdown', handleActivity)
          dom.removeEventListener('pointermove', handleActivity)
          dom.removeEventListener('pointerup', handleActivity)
          dom.removeEventListener('wheel', handleActivity)
          dom.removeEventListener('touchstart', handleActivity)
          dom.removeEventListener('touchmove', handleActivity)
          dom.removeEventListener('touchend', handleActivity)
        }

        unsubViewer()
        unsubScene()

        set({ frameloop: initFrameloop })
      }
    }

    return () => {
      if (timer) {
        clearInterval(timer)
      }
      set({ frameloop: initFrameloop })
    }
  }, [
    advance,
    camera,
    dpr,
    fps,
    idleFps,
    idleWindowMs,
    initFrameloop,
    paused,
    renderPaused,
    renderer,
    set,
    size.height,
    size.width,
  ])

  return null
}

export default FrameLimiter

