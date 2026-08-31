import { describe, expect, test } from 'bun:test'
import { swallowNextClick } from './use-handle-drag'

describe('swallowNextClick lifecycle and event cleanup', () => {
  test('attaches and removes capture click listener cleanly when clicked', () => {
    let clickListeners = 0
    type ListenerEntry = { fn: Function; once?: boolean; capture?: boolean }
    const listeners = new Map<string, Set<ListenerEntry>>()

    const mockWindow = {
      addEventListener: (type: string, listener: any, options: any) => {
        if (type === 'click' && options?.capture === true) {
          clickListeners++
        }
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add({ fn: listener, once: options?.once, capture: options?.capture })
      },
      removeEventListener: (type: string, listener: any, options: any) => {
        if (type === 'click' && options?.capture === true) {
          clickListeners = Math.max(0, clickListeners - 1)
        }
        const set = listeners.get(type)
        if (set) {
          for (const entry of Array.from(set)) {
            if (entry.fn === listener) {
              set.delete(entry)
            }
          }
        }
      },
      dispatchEvent: (event: { type: string; preventDefault: () => void; stopPropagation: () => void }) => {
        const set = listeners.get(event.type)
        if (set) {
          for (const entry of Array.from(set)) {
            entry.fn(event)
            if (entry.once) {
              set.delete(entry)
              if (event.type === 'click' && entry.capture) {
                clickListeners = Math.max(0, clickListeners - 1)
              }
            }
          }
        }
      },
    }

    const prevWindow = (globalThis as any).window
    ;(globalThis as any).window = mockWindow

    try {
      swallowNextClick()
      expect(clickListeners).toBe(1)

      // Simulate a click event
      mockWindow.dispatchEvent({
        type: 'click',
        preventDefault: () => {},
        stopPropagation: () => {},
      })

      // Listener should be cleaned up immediately after one click
      expect(clickListeners).toBe(0)
    } finally {
      ;(globalThis as any).window = prevWindow
    }
  })

  test('subsequent calls clear previous timer without accumulating listeners', () => {
    let clickListeners = 0
    type ListenerEntry = { fn: Function; once?: boolean; capture?: boolean }
    const listeners = new Map<string, Set<ListenerEntry>>()

    const mockWindow = {
      addEventListener: (type: string, listener: any, options: any) => {
        if (type === 'click' && options?.capture === true) {
          clickListeners++
        }
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add({ fn: listener, once: options?.once, capture: options?.capture })
      },
      removeEventListener: (type: string, listener: any, options: any) => {
        if (type === 'click' && options?.capture === true) {
          clickListeners = Math.max(0, clickListeners - 1)
        }
        const set = listeners.get(type)
        if (set) {
          for (const entry of Array.from(set)) {
            if (entry.fn === listener) {
              set.delete(entry)
            }
          }
        }
      },
      dispatchEvent: (event: { type: string; preventDefault: () => void; stopPropagation: () => void }) => {
        const set = listeners.get(event.type)
        if (set) {
          for (const entry of Array.from(set)) {
            entry.fn(event)
            if (entry.once) {
              set.delete(entry)
              if (event.type === 'click' && entry.capture) {
                clickListeners = Math.max(0, clickListeners - 1)
              }
            }
          }
        }
      },
    }

    const prevWindow = (globalThis as any).window
    ;(globalThis as any).window = mockWindow

    try {
      // Call swallowNextClick multiple times rapidly
      swallowNextClick()
      swallowNextClick()
      swallowNextClick()

      // Should have cleared previous and maintained at most 1 active listener
      expect(clickListeners).toBe(1)

      // Dispatch click to finish
      mockWindow.dispatchEvent({
        type: 'click',
        preventDefault: () => {},
        stopPropagation: () => {},
      })
      expect(clickListeners).toBe(0)
    } finally {
      ;(globalThis as any).window = prevWindow
    }
  })
})
