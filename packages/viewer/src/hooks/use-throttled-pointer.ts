'use client'

import type { EventManager, RootStore } from '@react-three/fiber'
import { events as createPointerEvents } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export interface PointerState {
  screenX: number
  screenY: number
  ndc: THREE.Vector2
  isDirty: boolean
  rawEvent: PointerEvent | null
}

export interface UseThrottledPointerOptions {
  /** When true, listens to pointermove on window instead of the canvas element. */
  global?: boolean
}

export const safeRequestAnimationFrame = (callback: FrameRequestCallback): number => {
  if (typeof requestAnimationFrame !== 'undefined') {
    return requestAnimationFrame(callback)
  }
  return setTimeout(() => callback(performance.now()), 16) as unknown as number
}

export const safeCancelAnimationFrame = (id: number): void => {
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(id)
  } else {
    clearTimeout(id)
  }
}

/**
 * Single-Slot RAF Pointer Coalescing Hook.
 * Inspired by upstream `pascalorg/editor`.
 *
 * Coalesces high-frequency (120Hz-1000Hz) pointer events into a single requestAnimationFrame
 * callback per display frame, eliminating main thread starvation and unthrottled raycasting floods.
 * Viewport dimensions are cached via ResizeObserver to completely prevent forced synchronous layouts (getBoundingClientRect).
 */
export function useThrottledPointer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  onFrameTick: (state: PointerState) => void,
  options: UseThrottledPointerOptions = {},
) {
  const pointerState = useRef<PointerState>({
    screenX: 0,
    screenY: 0,
    ndc: new THREE.Vector2(),
    isDirty: false,
    rawEvent: null,
  })

  const rafId = useRef<number | null>(null)
  const onFrameTickRef = useRef(onFrameTick)
  onFrameTickRef.current = onFrameTick

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Cache canvas rect on resize/scroll via ResizeObserver (Zero getBoundingClientRect in mousemove)
    let cachedRect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 }
    let resizeObserver: ResizeObserver | null = null

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === canvas) {
            cachedRect = canvas.getBoundingClientRect()
          }
        }
      })
      resizeObserver.observe(canvas)
    }

    const tick = () => {
      rafId.current = null
      if (pointerState.current.isDirty) {
        pointerState.current.isDirty = false
        onFrameTickRef.current(pointerState.current)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const state = pointerState.current
      state.screenX = e.clientX
      state.screenY = e.clientY
      state.rawEvent = e

      const width = cachedRect.width || 1
      const height = cachedRect.height || 1
      state.ndc.x = ((e.clientX - cachedRect.left) / width) * 2 - 1
      state.ndc.y = -((e.clientY - cachedRect.top) / height) * 2 + 1
      state.isDirty = true

      if (rafId.current === null) {
        rafId.current = safeRequestAnimationFrame(tick)
      }
    }

    const target = options.global && typeof window !== 'undefined' ? window : canvas
    target.addEventListener('pointermove', onPointerMove as EventListener, { passive: true })

    return () => {
      target.removeEventListener('pointermove', onPointerMove as EventListener)
      resizeObserver?.disconnect()
      if (rafId.current !== null) {
        safeCancelAnimationFrame(rafId.current)
        rafId.current = null
      }
    }
  }, [canvasRef, options.global])
}

/**
 * Creates a single-slot RAF coalesced pointermove handler wrapper.
 * Ideal for wrapping imperative or local pointer event listeners.
 */
export function createThrottledPointerMoveHandler<E extends { clientX?: number; clientY?: number }>(
  handler: (event: E) => void,
): {
  handlePointerMove: (event: E) => void
  flush: () => void
  cancel: () => void
} {
  let rafId: number | null = null
  let latestEvent: E | null = null

  const handlePointerMove = (event: E) => {
    latestEvent = event
    if (rafId === null) {
      rafId = safeRequestAnimationFrame(() => {
        rafId = null
        if (latestEvent) {
          handler(latestEvent)
        }
      })
    }
  }

  const flush = () => {
    if (rafId !== null) {
      safeCancelAnimationFrame(rafId)
      rafId = null
    }
    if (latestEvent) {
      handler(latestEvent)
      latestEvent = null
    }
  }

  const cancel = () => {
    if (rafId !== null) {
      safeCancelAnimationFrame(rafId)
      rafId = null
    }
    latestEvent = null
  }

  return { handlePointerMove, flush, cancel }
}

/**
 * R3F Custom Event Manager Factory that applies single-slot RAF pointer coalescing
 * to R3F's Canvas event manager.
 *
 * All pointermove raycasting passes are coalesced into a single RAF evaluation per frame,
 * while click, pointerdown, pointerup, and wheel events execute immediately with zero latency.
 */
export function createThrottledPointerEvents(store: RootStore): EventManager<HTMLElement> {
  const base = createPointerEvents(store)
  const baseHandlers = base.handlers
  if (!baseHandlers) return base

  let rafId: number | null = null
  let latestEvent: PointerEvent | null = null

  const rawPointerMove = baseHandlers.onPointerMove

  const throttledPointerMove = (event: Event) => {
    latestEvent = event as PointerEvent
    if (rafId === null) {
      rafId = safeRequestAnimationFrame(() => {
        rafId = null
        if (latestEvent && rawPointerMove) {
          rawPointerMove(latestEvent)
        }
      })
    }
  }

  const flush = () => {
    if (rafId !== null) {
      safeCancelAnimationFrame(rafId)
      rafId = null
    }
    if (latestEvent && rawPointerMove) {
      rawPointerMove(latestEvent)
      latestEvent = null
    }
  }

  const wrappedHandlers = {
    ...baseHandlers,
    onPointerMove: throttledPointerMove as unknown as EventListener,
    onPointerDown: (event: Event) => {
      flush()
      baseHandlers.onPointerDown?.(event)
    },
    onPointerUp: (event: Event) => {
      flush()
      baseHandlers.onPointerUp?.(event)
    },
    onClick: (event: Event) => {
      flush()
      baseHandlers.onClick?.(event)
    },
    onContextMenu: (event: Event) => {
      flush()
      baseHandlers.onContextMenu?.(event)
    },
    onDoubleClick: (event: Event) => {
      flush()
      baseHandlers.onDoubleClick?.(event)
    },
    onPointerCancel: (event: Event) => {
      if (rafId !== null) {
        safeCancelAnimationFrame(rafId)
        rafId = null
      }
      latestEvent = null
      baseHandlers.onPointerCancel?.(event)
    },
    onPointerLeave: (event: Event) => {
      if (rafId !== null) {
        safeCancelAnimationFrame(rafId)
        rafId = null
      }
      latestEvent = null
      baseHandlers.onPointerLeave?.(event)
    },
  }

  const baseDisconnect = base.disconnect
  return {
    ...base,
    handlers: wrappedHandlers,
    disconnect: () => {
      if (rafId !== null) {
        safeCancelAnimationFrame(rafId)
        rafId = null
      }
      latestEvent = null
      baseDisconnect?.()
    },
  }
}
