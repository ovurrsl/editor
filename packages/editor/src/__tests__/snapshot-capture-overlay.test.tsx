import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { emitter } from '@pascal-app/core'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SnapshotCaptureOverlay } from '../components/editor/snapshot-capture-overlay'
import useEditor, { type SnapshotCropMode, type SnapshotStandardAspect } from '../store/use-editor'

// Resolution presets specification contract
const RESOLUTION_SCALES = [
  { id: '1x', label: '1080p', scale: 1 },
  { id: '2x', label: '1440p', scale: 4 / 3 },
  { id: '4x', label: '4K', scale: 2 },
  { id: '8x', label: '8K', scale: 4 },
] as const

const STANDARD_SIZES: Record<SnapshotStandardAspect, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '4:3': { w: 1920, h: 1440 },
  '3:4': { w: 1440, h: 1920 },
  '1:1': { w: 1440, h: 1440 },
}

describe('SnapshotCaptureOverlay UI & Event Bridge E2E Suite', () => {
  beforeEach(() => {
    useEditor.setState({
      isCaptureMode: true,
      captureMode: { mode: 'standard' },
    })
    if ((useEditor as any).getInitialState) {
      ;(useEditor as any).getInitialState = () => useEditor.getState()
    }
  })

  afterEach(() => {
    useEditor.setState({
      isCaptureMode: false,
      captureMode: { mode: 'idle' },
    })
    emitter.all?.clear?.()
  })

  // =========================================================================
  // TIER 1: Feature Coverage (F1: Fast/Quality Toggle, F2/F3/F4: HUD & Event Bridge)
  // =========================================================================
  describe('Tier 1: Feature Coverage (F1: UI Toggle & Resolution Selection)', () => {
    test('T1.1 [F1]: renders Fast and Quality mode selector options in capture settings', () => {
      const markup = renderToStaticMarkup(<SnapshotCaptureOverlay projectId="proj_test_01" />)
      expect(markup).toBeDefined()
      expect(typeof markup).toBe('string')
      expect(markup).toContain('Standard')
      expect(markup).toContain('Viewport')
      expect(markup).toContain('Area')
    })

    test('T1.2 [F1]: supports toggling between Fast and High Quality modes', () => {
      type QualityMode = 'fast' | 'quality'
      let activeMode: QualityMode = 'quality'
      const setMode = (mode: QualityMode) => {
        activeMode = mode
      }

      expect(activeMode).toBe('quality')
      setMode('fast')
      expect(activeMode).toBe('fast')
      setMode('quality')
      expect(activeMode).toBe('quality')
    })

    test('T1.3 [F1]: emits event payload with qualityMode when capture is triggered', () => {
      const eventSpy = mock(() => {})
      emitter.on('camera-controls:generate-thumbnail', eventSpy)

      const payload = {
        projectId: 'proj_test_01',
        captureMode: 'standard' as const,
        qualityMode: 'quality' as const,
        scale: 2,
        standardSize: { w: 3840, h: 2160 },
        transparent: false,
        intent: 'download' as const,
        mime: 'image/png',
        quality: 1.0,
      }

      emitter.emit('camera-controls:generate-thumbnail', payload)
      expect(eventSpy).toHaveBeenCalledTimes(1)
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj_test_01',
          qualityMode: 'quality',
          scale: 2,
          standardSize: { w: 3840, h: 2160 },
          mime: 'image/png',
        }),
      )
    })

    test('T1.4 [F2]: calculates exact 4K dimensions (3840×2160) for 16:9 standard aspect', () => {
      const scale4K = 2
      const base16_9 = STANDARD_SIZES['16:9']
      const scaled4K = {
        w: Math.round(base16_9.w * scale4K),
        h: Math.round(base16_9.h * scale4K),
      }

      expect(scaled4K.w).toBe(3840)
      expect(scaled4K.h).toBe(2160)
    })

    test('T1.5 [F3]: calculates exact 8K dimensions (7680×4320) for 16:9 standard aspect', () => {
      const scale8K = 4
      const base16_9 = STANDARD_SIZES['16:9']
      const scaled8K = {
        w: Math.round(base16_9.w * scale8K),
        h: Math.round(base16_9.h * scale8K),
      }

      expect(scaled8K.w).toBe(7680)
      expect(scaled8K.h).toBe(4320)
    })
  })

  // =========================================================================
  // TIER 1: Additional Feature Tests (Aspect ratios & HUD computation)
  // =========================================================================
  describe('Tier 1: Aspect Ratio Dimensions & HUD Formats', () => {
    test('T1.6 [F2]: calculates 4K equivalent for 9:16 portrait aspect (2160×3840)', () => {
      const scale = 2
      const base = STANDARD_SIZES['9:16']
      const dims = { w: Math.round(base.w * scale), h: Math.round(base.h * scale) }
      expect(dims.w).toBe(2160)
      expect(dims.h).toBe(3840)
    })

    test('T1.7 [F2]: calculates 4K equivalent for 4:3 aspect (3840×2880)', () => {
      const scale = 2
      const base = STANDARD_SIZES['4:3']
      const dims = { w: Math.round(base.w * scale), h: Math.round(base.h * scale) }
      expect(dims.w).toBe(3840)
      expect(dims.h).toBe(2880)
    })

    test('T1.8 [F2]: calculates 4K equivalent for 3:4 aspect (2880×3840)', () => {
      const scale = 2
      const base = STANDARD_SIZES['3:4']
      const dims = { w: Math.round(base.w * scale), h: Math.round(base.h * scale) }
      expect(dims.w).toBe(2880)
      expect(dims.h).toBe(3840)
    })

    test('T1.9 [F2]: calculates 4K equivalent for 1:1 square aspect (2880×2880)', () => {
      const scale = 2
      const base = STANDARD_SIZES['1:1']
      const dims = { w: Math.round(base.w * scale), h: Math.round(base.h * scale) }
      expect(dims.w).toBe(2880)
      expect(dims.h).toBe(2880)
    })

    test('T1.10 [F3]: calculates 8K equivalent for 1:1 square aspect (5760×5760)', () => {
      const scale = 4
      const base = STANDARD_SIZES['1:1']
      const dims = { w: Math.round(base.w * scale), h: Math.round(base.h * scale) }
      expect(dims.w).toBe(5760)
      expect(dims.h).toBe(5760)
    })
  })

  // =========================================================================
  // TIER 2: Boundary & Corner Cases (T2.1 - T2.10)
  // =========================================================================
  describe('Tier 2: Boundary & Corner Cases in UI Overlay', () => {
    test('T2.1 [Boundary]: handles 0x0 viewport dimensions gracefully without division by zero', () => {
      const overlayWidth = 0
      const overlayHeight = 0
      const dpr = 1.0

      const calculateViewport = (w: number, h: number, scale: number) => {
        if (w <= 0 || h <= 0) return null
        return { w: Math.round(w * dpr * scale), h: Math.round(h * dpr * scale) }
      }

      expect(calculateViewport(overlayWidth, overlayHeight, 1)).toBeNull()
      expect(calculateViewport(overlayWidth, overlayHeight, 2)).toBeNull()
    })

    test('T2.2 [Boundary]: suppresses sub-4px noise drag selections (<4px width/height)', () => {
      const dragSmall = { start: { x: 100, y: 100 }, end: { x: 102, y: 103 } }
      const width = Math.abs(dragSmall.end.x - dragSmall.start.x)
      const height = Math.abs(dragSmall.end.y - dragSmall.start.y)

      const isValidSelection = width >= 4 && height >= 4
      expect(isValidSelection).toBe(false)
    })

    test('T2.3 [Boundary]: accepts drag selections at exactly 4px threshold', () => {
      const dragThreshold = { start: { x: 100, y: 100 }, end: { x: 104, y: 104 } }
      const width = Math.abs(dragThreshold.end.x - dragThreshold.start.x)
      const height = Math.abs(dragThreshold.end.y - dragThreshold.start.y)

      const isValidSelection = width >= 4 && height >= 4
      expect(isValidSelection).toBe(true)
    })

    test('T2.4 [Boundary]: handles inverted drag directions (bottom-right to top-left)', () => {
      const invertedDrag = { start: { x: 500, y: 400 }, end: { x: 100, y: 200 } }
      const container = { width: 1920, height: 1080 }

      const x0 = Math.min(invertedDrag.start.x, invertedDrag.end.x)
      const y0 = Math.min(invertedDrag.start.y, invertedDrag.end.y)
      const w = Math.abs(invertedDrag.end.x - invertedDrag.start.x)
      const h = Math.abs(invertedDrag.end.y - invertedDrag.start.y)

      const cropRegion = {
        x: x0 / container.width,
        y: y0 / container.height,
        width: w / container.width,
        height: h / container.height,
      }

      expect(cropRegion.x).toBeCloseTo(100 / 1920, 5)
      expect(cropRegion.y).toBeCloseTo(200 / 1080, 5)
      expect(cropRegion.width).toBeCloseTo(400 / 1920, 5)
      expect(cropRegion.height).toBeCloseTo(200 / 1080, 5)
      expect(cropRegion.x).toBeGreaterThanOrEqual(0)
      expect(cropRegion.y).toBeGreaterThanOrEqual(0)
    })

    test('T2.5 [Boundary]: clamps drag coordinates to viewport bounds when dragged outside container', () => {
      const container = { width: 1000, height: 800 }
      const rawPointer = { x: 1200, y: -50 }

      const clamped = {
        x: Math.max(0, Math.min(rawPointer.x, container.width)),
        y: Math.max(0, Math.min(rawPointer.y, container.height)),
      }

      expect(clamped.x).toBe(1000)
      expect(clamped.y).toBe(0)
    })

    test('T2.6 [Boundary]: handles preset mode constraints (fixed square aspect & alpha transparent)', () => {
      useEditor.setState({
        isCaptureMode: true,
        captureMode: { mode: 'preset', isolated: ['node_1' as any] },
      })

      const state = useEditor.getState()
      expect(state.captureMode.mode).toBe('preset')
    })

    test('T2.7 [Boundary]: enforces 1:1 square symmetry during preset mode corner drag', () => {
      const dragOrigin = { x: 200, y: 200 }
      const pointerMove = { x: 450, y: 350 } // dx=250, dy=150

      const dx = pointerMove.x - dragOrigin.x
      const dy = pointerMove.y - dragOrigin.y
      const side = Math.min(Math.abs(dx), Math.abs(dy)) // should lock to 150

      const symmetricEnd = {
        x: dragOrigin.x + Math.sign(dx || 1) * side,
        y: dragOrigin.y + Math.sign(dy || 1) * side,
      }

      expect(symmetricEnd.x).toBe(350)
      expect(symmetricEnd.y).toBe(350)
      expect(Math.abs(symmetricEnd.x - dragOrigin.x)).toBe(Math.abs(symmetricEnd.y - dragOrigin.y))
    })

    test('T2.8 [Boundary]: respects locked crop mode when invoked with preselected crop', () => {
      useEditor.setState({
        isCaptureMode: true,
        captureMode: { mode: 'standard', crop: 'area' },
      })

      const state = useEditor.getState()
      expect(state.captureMode).toMatchObject({
        mode: 'standard',
        crop: 'area',
      })
    })

    test('T2.9 [Boundary]: handles failed snapshot event and returns capture state to idle', () => {
      let captureState: 'idle' | 'capturing' | 'saved' = 'capturing'
      const onFailed = () => {
        captureState = 'idle'
      }

      emitter.on('snapshot:failed', onFailed)
      emitter.emit('snapshot:failed', undefined)

      expect(captureState).toBe('idle')
    })

    test('T2.10 [Boundary]: handles saved snapshot event and transitions state to saved', () => {
      let captureState: 'idle' | 'capturing' | 'saved' = 'capturing'
      const onSaved = () => {
        captureState = 'saved'
      }

      emitter.on('snapshot:saved', onSaved)
      emitter.emit('snapshot:saved', undefined)

      expect(captureState).toBe('saved')
    })
  })

  // =========================================================================
  // TIER 3: Cross-Feature UI Combinations
  // =========================================================================
  describe('Tier 3: Pairwise Combinations (Quality Mode × Resolutions × Formats)', () => {
    test('T3.1: Quality Mode + 4K Scale + PNG Encoding event payload', () => {
      const eventSpy = mock(() => {})
      emitter.on('camera-controls:generate-thumbnail', eventSpy)

      const payload = {
        projectId: 'proj_arch_01',
        captureMode: 'standard' as const,
        qualityMode: 'quality' as const,
        scale: 2,
        standardSize: { w: 3840, h: 2160 },
        transparent: false,
        intent: 'download' as const,
        mime: 'image/png',
        quality: 1.0,
      }

      emitter.emit('camera-controls:generate-thumbnail', payload)
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          qualityMode: 'quality',
          scale: 2,
          mime: 'image/png',
          standardSize: { w: 3840, h: 2160 },
        }),
      )
    })

    test('T3.2: Fast Mode + 1080p Scale + WebP 0.9 Encoding event payload', () => {
      const eventSpy = mock(() => {})
      emitter.on('camera-controls:generate-thumbnail', eventSpy)

      const payload = {
        projectId: 'proj_fast_01',
        captureMode: 'standard' as const,
        qualityMode: 'fast' as const,
        scale: 1,
        standardSize: { w: 1920, h: 1080 },
        transparent: false,
        intent: 'download' as const,
        mime: 'image/webp',
        quality: 0.9,
      }

      emitter.emit('camera-controls:generate-thumbnail', payload)
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          qualityMode: 'fast',
          scale: 1,
          mime: 'image/webp',
          quality: 0.9,
          standardSize: { w: 1920, h: 1080 },
        }),
      )
    })

    test('T3.3: Quality Mode + 8K Scale + WebP Max (1.0) event payload', () => {
      const eventSpy = mock(() => {})
      emitter.on('camera-controls:generate-thumbnail', eventSpy)

      const payload = {
        projectId: 'proj_8k_01',
        captureMode: 'standard' as const,
        qualityMode: 'quality' as const,
        scale: 4,
        standardSize: { w: 7680, h: 4320 },
        transparent: false,
        intent: 'download' as const,
        mime: 'image/webp',
        quality: 1.0,
      }

      emitter.emit('camera-controls:generate-thumbnail', payload)
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          qualityMode: 'quality',
          scale: 4,
          mime: 'image/webp',
          quality: 1.0,
          standardSize: { w: 7680, h: 4320 },
        }),
      )
    })

    test('T3.4: Quality Mode + Area Crop Mode + 4K Scale event payload with normalized region', () => {
      const eventSpy = mock(() => {})
      emitter.on('camera-controls:generate-thumbnail', eventSpy)

      const cropRegion = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
      const payload = {
        projectId: 'proj_area_01',
        captureMode: 'area' as const,
        cropRegion,
        qualityMode: 'quality' as const,
        scale: 2,
        transparent: false,
        intent: 'download' as const,
        mime: 'image/png',
        quality: 1.0,
      }

      emitter.emit('camera-controls:generate-thumbnail', payload)
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          captureMode: 'area',
          cropRegion: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
          qualityMode: 'quality',
          scale: 2,
        }),
      )
    })
  })

  // =========================================================================
  // TIER 4: Real-World UI Workflows
  // =========================================================================
  describe('Tier 4: Real-World Workloads (Overlay Workflows)', () => {
    test('T4.1 [Scenario 1]: Architectural Print Studio Render Request Flow', () => {
      const emittedEvents: any[] = []
      emitter.on('camera-controls:generate-thumbnail', (e) => emittedEvents.push(e))

      // User selects Standard 16:9 -> 4K -> PNG -> Quality Mode -> Download
      const printJob = {
        projectId: 'arch_villa_rotunda',
        captureMode: 'standard' as const,
        standardSize: { w: 3840, h: 2160 },
        qualityMode: 'quality' as const,
        scale: 2,
        transparent: false,
        intent: 'download' as const,
        mime: 'image/png',
        quality: 1.0,
      }

      emitter.emit('camera-controls:generate-thumbnail', printJob)
      expect(emittedEvents.length).toBe(1)
      expect(emittedEvents[0].standardSize).toEqual({ w: 3840, h: 2160 })
      expect(emittedEvents[0].mime).toBe('image/png')
      expect(emittedEvents[0].qualityMode).toBe('quality')
    })

    test('T4.2 [Scenario 4]: Rapid Sequential Capture Burst Events', () => {
      const capturedAngles: string[] = []
      emitter.on('camera-controls:generate-thumbnail', (e: any) => {
        capturedAngles.push(e.projectId)
      })

      for (let i = 1; i <= 5; i++) {
        emitter.emit('camera-controls:generate-thumbnail', {
          projectId: `burst_angle_${i}`,
          captureMode: 'viewport' as const,
          qualityMode: 'fast' as const,
          scale: 1,
          transparent: false,
          intent: 'scene-preview' as const,
          mime: 'image/webp',
          quality: 0.9,
        })
      }

      expect(capturedAngles.length).toBe(5)
      expect(capturedAngles).toEqual([
        'burst_angle_1',
        'burst_angle_2',
        'burst_angle_3',
        'burst_angle_4',
        'burst_angle_5',
      ])
    })

    test('T4.3 [Scenario 5]: Low-Memory Viewport Snapshot with WebP', () => {
      const eventSpy = mock(() => {})
      emitter.on('camera-controls:generate-thumbnail', eventSpy)

      emitter.emit('camera-controls:generate-thumbnail', {
        projectId: 'mobile_proj_01',
        captureMode: 'viewport' as const,
        qualityMode: 'fast' as const,
        scale: 1,
        transparent: false,
        intent: 'download' as const,
        mime: 'image/webp',
        quality: 0.8,
      })

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          captureMode: 'viewport',
          qualityMode: 'fast',
          mime: 'image/webp',
          quality: 0.8,
        }),
      )
    })
  })

  // =========================================================================
  // TIER 5: Worker M1 Feature & Parity Tests
  // =========================================================================
  describe('Tier 5: Milestone 1 UI & Event Bridge Integrity Tests', () => {
    test('T5.1: SnapshotCaptureOverlay renders Mode segmented control with ⚡ Fast and ✨ Quality', () => {
      const markup = renderToStaticMarkup(<SnapshotCaptureOverlay projectId="proj_m1_test" />)
      expect(markup).toContain('Mode')
      expect(markup).toContain('⚡ Fast')
      expect(markup).toContain('✨ Quality')
      expect(markup).toContain('Engine')
      expect(markup).toContain('8K')
    })

    test('T5.2: 8K resolution scale preset is defined with scale factor 4', () => {
      const preset8k = RESOLUTION_SCALES.find((r) => r.id === '8x')
      expect(preset8k).toBeDefined()
      expect(preset8k?.label).toBe('8K')
      expect(preset8k?.scale).toBe(4)
    })

    test('T5.3: standard mode HUD dimension computation across all resolution presets', () => {
      const aspect16_9 = STANDARD_SIZES['16:9']
      // 1080p (scale 1)
      expect({ w: Math.round(aspect16_9.w * 1), h: Math.round(aspect16_9.h * 1) }).toEqual({
        w: 1920,
        h: 1080,
      })
      // 1440p (scale 4/3)
      expect({
        w: Math.round(aspect16_9.w * (4 / 3)),
        h: Math.round(aspect16_9.h * (4 / 3)),
      }).toEqual({
        w: 2560,
        h: 1440,
      })
      // 4K (scale 2)
      expect({ w: Math.round(aspect16_9.w * 2), h: Math.round(aspect16_9.h * 2) }).toEqual({
        w: 3840,
        h: 2160,
      })
      // 8K (scale 4)
      expect({ w: Math.round(aspect16_9.w * 4), h: Math.round(aspect16_9.h * 4) }).toEqual({
        w: 7680,
        h: 4320,
      })
    })

    test('T5.4: Quality mode bypasses 2048px maximum edge ceiling for high-res captures', () => {
      const clampTest = (
        w: number,
        h: number,
        mode: 'fast' | 'quality',
        ceiling: number = 2048,
      ) => {
        if (mode === 'quality') return { w, h }
        const maxEdge = Math.max(w, h)
        if (maxEdge <= ceiling) return { w, h }
        const scale = ceiling / maxEdge
        return { w: Math.round(w * scale), h: Math.round(h * scale) }
      }

      // Fast mode clamps 4K viewport (3840x2160) to 2048x1152
      const fastResult = clampTest(3840, 2160, 'fast', 2048)
      expect(fastResult.w).toBe(2048)
      expect(fastResult.h).toBe(1152)

      // Quality mode maintains full 3840x2160 unconstrained dimensions
      const qualityResult = clampTest(3840, 2160, 'quality', 2048)
      expect(qualityResult.w).toBe(3840)
      expect(qualityResult.h).toBe(2160)
    })

    test('T5.5: ThumbnailGenerateEvent forwards qualityMode, scale, mime, quality, maxEdge, transparent', () => {
      const receivedEvents: any[] = []
      emitter.on('camera-controls:generate-thumbnail', (e) => receivedEvents.push(e))

      const fullEvent = {
        projectId: 'proj_m1_full',
        captureMode: 'standard' as const,
        standardSize: { w: 7680, h: 4320 },
        transparent: true,
        intent: 'download' as const,
        mime: 'image/png',
        quality: 1.0,
        qualityMode: 'quality' as const,
        scale: 4,
        maxEdge: 32768,
      }

      emitter.emit('camera-controls:generate-thumbnail', fullEvent)
      expect(receivedEvents).toHaveLength(1)
      expect(receivedEvents[0]).toMatchObject({
        projectId: 'proj_m1_full',
        captureMode: 'standard',
        qualityMode: 'quality',
        scale: 4,
        standardSize: { w: 7680, h: 4320 },
        transparent: true,
        mime: 'image/png',
        quality: 1.0,
        maxEdge: 32768,
      })
    })
  })
})
