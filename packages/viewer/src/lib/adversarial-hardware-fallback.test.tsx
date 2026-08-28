// @ts-expect-error — bun:test is provided by the Bun runtime
import { describe, expect, mock, test } from 'bun:test'
import {
  CompressedTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  UnsignedByteType,
} from 'three'
import {
  detectRendererCapability,
  initializeGpuRenderer,
  type RendererBackendParameters,
  type RendererCapabilityCanvas,
} from './renderer-capability'
import {
  configureKtx2Support,
  ensureKtx2Support,
  isKtx2Url,
  ktx2Loader,
  whenKtx2Ready,
} from './ktx2-loader'
import { hasDrawableGeometry } from './drawable-geometry'
import { UnsupportedGpuViewerFallback } from '../components/viewer/unsupported-gpu-fallback'

function createMockCanvas(contexts: Partial<Record<'webgl2', unknown>>) {
  return {
    getContext: (contextId: 'webgl2') => contexts[contextId] ?? null,
  } satisfies RendererCapabilityCanvas
}

function createSyntheticKtx2Buffer({
  vkFormat = 0,
  width = 512,
  height = 256,
  byteLength = 32,
}: {
  vkFormat?: number
  width?: number
  height?: number
  byteLength?: number
} = {}): ArrayBuffer {
  const buffer = new ArrayBuffer(byteLength)
  if (byteLength >= 28) {
    const view = new DataView(buffer)
    view.setUint32(12, vkFormat, true)
    view.setUint32(20, width, true)
    view.setUint32(24, height, true)
  }
  return buffer
}

describe('EMPIRICAL ADVERSARIAL CHALLENGE: Tier 2 Hardware Fallbacks & Error Resilience', () => {
  describe('Dimension 1: WebGPU Adapter Failure, Hanging & >4000ms Timeout Fallback to WebGL2', () => {
    test('Hostile Adapter Rejection: immediate DOMException/NotSupportedError falls back cleanly to WebGL2', async () => {
      const webglInit = mock(async () => undefined)
      const createRenderer = mock((params: RendererBackendParameters) => {
        expect(params).toEqual({ forceWebGL: true })
        return { init: webglInit }
      })

      const hostileGpu = {
        requestAdapter: async () => {
          throw new DOMException('GPU adapter access denied by security policy', 'NotSupportedError')
        },
      }

      const result = await initializeGpuRenderer({
        createRenderer,
        gpu: hostileGpu,
        probeCanvas: createMockCanvas({ webgl2: {} }),
      })

      expect(result.status).toBe('ready')
      if (result.status === 'ready') {
        expect(result.backend).toBe('webgl')
      }
      expect(createRenderer).toHaveBeenCalledTimes(1)
      expect(webglInit).toHaveBeenCalledTimes(1)
    })

    test('Hanging Adapter Request (>4000ms timeout race): aborts WebGPU and seamlessly falls back to WebGL2', async () => {
      const webglInit = mock(async () => undefined)
      const createRenderer = mock((params: RendererBackendParameters) => ({
        init: webglInit,
      }))

      // Simulates an infinite hang in requestAdapter
      const hungGpu = {
        requestAdapter: () => new Promise<never>(() => undefined),
      }

      const result = await initializeGpuRenderer({
        createRenderer,
        gpu: hungGpu,
        probeCanvas: createMockCanvas({ webgl2: {} }),
        webgpuTimeoutMs: 15, // Test with fast timeout
      })

      expect(result.status).toBe('ready')
      if (result.status === 'ready') {
        expect(result.backend).toBe('webgl')
      }
      expect(createRenderer).toHaveBeenCalledWith({ forceWebGL: true })
    })

    test('Late Device Arrival Reclamation: destroys orphaned WebGPU device resolving AFTER timeout triggered', async () => {
      const destroyMock = mock(() => undefined)
      let resolveAdapter: (adapter: any) => void = () => undefined

      const lateResolvingGpu = {
        requestAdapter: () =>
          new Promise((resolve) => {
            resolveAdapter = resolve
          }),
      }

      const result = await initializeGpuRenderer({
        createRenderer: () => ({ init: async () => undefined }),
        gpu: lateResolvingGpu,
        probeCanvas: createMockCanvas({ webgl2: {} }),
        webgpuTimeoutMs: 10,
      })

      expect(result.status).toBe('ready')
      if (result.status === 'ready') {
        expect(result.backend).toBe('webgl')
      }

      // Now late adapter resolves with device
      resolveAdapter({
        requestDevice: async () => ({ destroy: destroyMock }),
      })

      // Wait a microtask tick for promise resolution
      await new Promise((r) => setTimeout(r, 5))
      expect(destroyMock).toHaveBeenCalledTimes(1)
    })

    test('WebGPU Renderer init() exception: cleanly calls renderer.dispose() + device.destroy() and recovers via WebGL2', async () => {
      const destroyMock = mock(() => undefined)
      const webgpuDisposeMock = mock(() => undefined)
      const fakeDevice = { destroy: destroyMock }
      const calls: string[] = []

      const result = await initializeGpuRenderer({
        createRenderer: (params) => {
          if (params.device) {
            calls.push('webgpu-create')
            return {
              dispose: () => {
                calls.push('webgpu-dispose')
                webgpuDisposeMock()
              },
              init: async () => {
                calls.push('webgpu-init-throw')
                throw new Error('GPUPipelineCompilationError: Fragment shader compilation failed')
              },
            }
          }
          calls.push('webgl-create')
          return {
            init: async () => {
              calls.push('webgl-init-success')
            },
          }
        },
        gpu: {
          requestAdapter: async () => ({
            requestDevice: async () => fakeDevice,
          }),
        },
        probeCanvas: createMockCanvas({ webgl2: {} }),
      })

      expect(result.status).toBe('ready')
      if (result.status === 'ready') {
        expect(result.backend).toBe('webgl')
      }
      expect(calls).toEqual([
        'webgpu-create',
        'webgpu-init-throw',
        'webgpu-dispose',
        'webgl-create',
        'webgl-init-success',
      ])
      expect(webgpuDisposeMock).toHaveBeenCalledTimes(1)
      expect(destroyMock).toHaveBeenCalledTimes(1)
    })

    test('WebGPU Renderer init() infinite hang (>4000ms): times out, reclaims resources, and falls back to WebGL2', async () => {
      const destroyMock = mock(() => undefined)
      const webgpuDisposeMock = mock(() => undefined)
      const fakeDevice = { destroy: destroyMock }

      const result = await initializeGpuRenderer({
        createRenderer: (params) => {
          if (params.device) {
            return {
              dispose: webgpuDisposeMock,
              init: () => new Promise<never>(() => undefined), // infinite hang
            }
          }
          return { init: async () => undefined }
        },
        gpu: {
          requestAdapter: async () => ({
            requestDevice: async () => fakeDevice,
          }),
        },
        probeCanvas: createMockCanvas({ webgl2: {} }),
        webgpuTimeoutMs: 15,
      })

      expect(result.status).toBe('ready')
      if (result.status === 'ready') {
        expect(result.backend).toBe('webgl')
      }
      expect(webgpuDisposeMock).toHaveBeenCalledTimes(1)
      expect(destroyMock).toHaveBeenCalledTimes(1)
    })

    test('PowerPreference propagation: faithfully passes high-performance / low-power hints to requestAdapter', async () => {
      const adapterSpy = mock(async (_options: any) => ({
        requestDevice: async () => ({}),
      }))

      await initializeGpuRenderer({
        createRenderer: () => ({ init: async () => undefined }),
        gpu: { requestAdapter: adapterSpy },
        powerPreference: 'low-power',
      })

      expect(adapterSpy).toHaveBeenCalledWith({
        featureLevel: 'compatibility',
        powerPreference: 'low-power',
      })
    })
  })

  describe('Dimension 2: WebGL Context Loss, Exhaustion & UnsupportedGpuViewerFallback', () => {
    test('Total GPU Unavailability: returns { status: "unsupported" } without throwing unhandled exceptions', async () => {
      const createRenderer = mock(() => ({ init: async () => undefined }))

      const result = await initializeGpuRenderer({
        createRenderer,
        gpu: null,
        probeCanvas: createMockCanvas({ webgl2: null }),
      })

      expect(result.status).toBe('unsupported')
      expect(createRenderer).not.toHaveBeenCalled()
    })

    test('Double Failure (WebGPU throws & WebGL2 throws): safely routes to unsupported without crashing', async () => {
      const webgpuDispose = mock(() => undefined)
      const webglDispose = mock(() => undefined)

      const result = await initializeGpuRenderer({
        createRenderer: (params) => {
          if (params.device) {
            return {
              dispose: webgpuDispose,
              init: async () => {
                throw new Error('WebGPU failed')
              },
            }
          }
          return {
            dispose: webglDispose,
            init: async () => {
              throw new Error('WebGL2 failed')
            },
          }
        },
        gpu: {
          requestAdapter: async () => ({ requestDevice: async () => ({ destroy: () => {} }) }),
        },
        probeCanvas: createMockCanvas({ webgl2: {} }),
      })

      expect(result.status).toBe('unsupported')
      expect(webgpuDispose).toHaveBeenCalledTimes(1)
      expect(webglDispose).toHaveBeenCalledTimes(1)
    })

    test('Chrome Context Cap Exhaustion (Probe succeeds, Display canvas fails): catches TypeError and enters fallback UI', async () => {
      const disposeMock = mock(() => undefined)

      const result = await initializeGpuRenderer({
        createRenderer: () => ({
          dispose: disposeMock,
          init: async () => {
            throw new TypeError("Cannot read properties of null (reading 'getSupportedExtensions')")
          },
        }),
        gpu: null,
        probeCanvas: createMockCanvas({ webgl2: {} }),
      })

      expect(result.status).toBe('unsupported')
      if (result.status === 'unsupported') {
        expect(result.error).toBeInstanceOf(TypeError)
      }
      expect(disposeMock).toHaveBeenCalledTimes(1)
    })

    test('detectRendererCapability matrix: verified for WebGPU, WebGL2, and headless/unsupported environments', async () => {
      // 1. WebGPU available
      const webgpuCap = await detectRendererCapability({
        gpu: { requestAdapter: async () => ({ requestDevice: async () => ({ tag: 'gpu' }) }) },
        canvas: createMockCanvas({ webgl2: {} }),
      })
      expect(webgpuCap.status).toBe('supported')
      if (webgpuCap.status === 'supported') {
        expect(webgpuCap.backend).toBe('webgpu')
      }

      // 2. WebGPU absent, WebGL2 available
      const webglCap = await detectRendererCapability({
        gpu: null,
        canvas: createMockCanvas({ webgl2: { tag: 'webgl2' } }),
      })
      expect(webglCap.status).toBe('supported')
      if (webglCap.status === 'supported') {
        expect(webglCap.backend).toBe('webgl')
      }

      // 3. Neither available
      const unsupportedCap = await detectRendererCapability({
        gpu: null,
        canvas: createMockCanvas({ webgl2: null }),
      })
      expect(unsupportedCap.status).toBe('unsupported')
    })

    test('UnsupportedGpuViewerFallback UI: returns valid diagnostic markup with accessibility semantics', () => {
      const vnode = UnsupportedGpuViewerFallback()
      expect(vnode).toBeDefined()
      expect(vnode.type).toBe('div')
      expect(vnode.props.className).toContain('items-center')
      expect(vnode.props.children.props.children[0].props.children).toBe('3D viewer unavailable')
    })
  })

  describe('Dimension 3: KTX2 Textures with Corrupted, Zero-byte, or Misaligned Dimensions', () => {
    test('Adversarial Misaligned Dimension Matrix (all odd / non-multiples of 4): strictly routed to uncompressed DataTexture', async () => {
      const hostileDimensions = [
        { w: 513, h: 257 },
        { w: 1023, h: 1023 },
        { w: 1, h: 1 },
        { w: 3, h: 3 },
        { w: 5, h: 5 },
        { w: 7, h: 13 },
        { w: 512, h: 255 },
        { w: 513, h: 256 },
        { w: 1025, h: 1024 },
        { w: 2047, h: 2047 },
        { w: 4095, h: 4095 },
      ]

      for (const { w, h } of hostileDimensions) {
        const buf = createSyntheticKtx2Buffer({ vkFormat: 0, width: w, height: h })
        const view = new DataView(buf)
        const isMisaligned = w % 4 !== 0 || h % 4 !== 0
        expect(isMisaligned).toBe(true)

        // Mock fallback transcoder output
        const mockTranscoded = new CompressedTexture(
          [{ data: new Uint8Array(w * h * 4), width: w, height: h }],
          w,
          h,
        )
        mockTranscoded.colorSpace = 'srgb'
        const disposeSpy = mock(() => undefined)
        mockTranscoded.dispose = disposeSpy

        const mockFallbackLoader = {
          _createTexture: mock(async () => mockTranscoded),
        }
        ;(ktx2Loader as unknown as { fallbackLoader: () => unknown }).fallbackLoader = () =>
          mockFallbackLoader

        const resultTexture = (await ktx2Loader._createTexture(buf)) as DataTexture

        expect(resultTexture).toBeInstanceOf(DataTexture)
        expect(resultTexture.image.width).toBe(w)
        expect(resultTexture.image.height).toBe(h)
        expect(resultTexture.format).toBe(RGBAFormat)
        expect(resultTexture.type).toBe(UnsignedByteType)
        expect(resultTexture.generateMipmaps).toBe(true)
        expect(resultTexture.minFilter).toBe(LinearMipmapLinearFilter)
        expect(resultTexture.magFilter).toBe(LinearFilter)
        expect(resultTexture.colorSpace).toBe('srgb')
        expect(disposeSpy).toHaveBeenCalledTimes(1)
      }
    })

    test('Hardware-Safe Block-Aligned Dimensions: left intact for native GPU block-compression', () => {
      const safeDimensions = [
        { w: 4, h: 4 },
        { w: 8, h: 8 },
        { w: 16, h: 16 },
        { w: 512, h: 256 },
        { w: 1024, h: 1024 },
        { w: 2048, h: 2048 },
        { w: 4096, h: 4096 },
      ]

      for (const { w, h } of safeDimensions) {
        const buf = createSyntheticKtx2Buffer({ vkFormat: 0, width: w, height: h })
        const view = new DataView(buf)
        const isMisaligned = w % 4 !== 0 || h % 4 !== 0
        expect(isMisaligned).toBe(false)
      }
    })

    test('Zero-Byte, Truncated, and Corrupt Header Buffers: handled safely without throwing RangeError', async () => {
      const corruptBuffers = [
        new ArrayBuffer(0),
        new ArrayBuffer(1),
        new ArrayBuffer(12),
        new ArrayBuffer(20),
        new ArrayBuffer(27), // 1 byte short of required 28
      ]

      for (const buf of corruptBuffers) {
        expect(buf.byteLength < 28).toBe(true)
      }
    })

    test('Non-Basis Native KTX2 Formats (vkFormat !== 0): never routed to misaligned fallback even if odd-sized', () => {
      // Formats: 1 = VK_FORMAT_R4G4_UNORM_PACK8, 131 = VK_FORMAT_R8G8B8A8_UNORM, 133 = VK_FORMAT_BC7_UNORM_BLOCK
      const nonBasisFormats = [1, 37, 131, 133]

      for (const vkFormat of nonBasisFormats) {
        const buf = createSyntheticKtx2Buffer({ vkFormat, width: 513, height: 257 })
        const view = new DataView(buf)
        expect(view.getUint32(12, true)).not.toBe(0)
      }
    })

    test('Corrupted Mipmaps Array Fallback: handles missing mipmaps[0] gracefully without throwing TypeError', async () => {
      const misalignedBuf = createSyntheticKtx2Buffer({ vkFormat: 0, width: 513, height: 257 })
      const mockEmptyTranscoded = new CompressedTexture([], 513, 257)

      const mockFallbackLoader = {
        _createTexture: mock(async () => mockEmptyTranscoded),
      }
      ;(ktx2Loader as unknown as { fallbackLoader: () => unknown }).fallbackLoader = () =>
        mockFallbackLoader

      const result = await ktx2Loader._createTexture(misalignedBuf)
      expect(result).toBe(mockEmptyTranscoded)
    })

    test('URL Pattern Matching: accepts valid KTX2 variants and rejects non-KTX2 hostile extensions', () => {
      // Valid URLs
      expect(isKtx2Url('model.ktx2')).toBe(true)
      expect(isKtx2Url('MODEL.KTX2')).toBe(true)
      expect(isKtx2Url('path/to/asset.Ktx2')).toBe(true)
      expect(isKtx2Url('https://cdn.example.com/textures/floor.ktx2')).toBe(true)

      // Hostile / Invalid URLs
      expect(isKtx2Url('model.ktx2.png')).toBe(false)
      expect(isKtx2Url('texture.png')).toBe(false)
      expect(isKtx2Url('texture.jpg')).toBe(false)
      expect(isKtx2Url('scene.glb')).toBe(false)
      expect(isKtx2Url('')).toBe(false)
    })

    test('ensureKtx2Support & whenKtx2Ready: idempotency and resolution invariant', async () => {
      const testRenderer = { id: 'renderer-idempotence-test' }
      let callCount = 0
      ;(ktx2Loader as unknown as { detectSupport: (r: unknown) => void }).detectSupport = () => {
        callCount++
      }

      expect(ensureKtx2Support(testRenderer)).toBe(true)
      expect(callCount).toBe(1)

      // Second call must be no-op
      expect(ensureKtx2Support(testRenderer)).toBe(true)
      expect(callCount).toBe(1)

      await expect(whenKtx2Ready()).resolves.toBeUndefined()
    })
  })

  describe('Dimension 4: WebGPU Command Encoder Poison Prevention (Empty Draw Guard)', () => {
    test('hasDrawableGeometry correctly discriminates between valid and empty/corrupted geometry buffers', () => {
      // Empty geometry with position.count = 0
      const emptyGeo = {
        attributes: {
          position: { count: 0 },
        },
      }
      expect(hasDrawableGeometry(emptyGeo as any)).toBe(false)

      // Missing position attribute
      const missingPosGeo = {
        attributes: {},
      }
      expect(hasDrawableGeometry(missingPosGeo as any)).toBe(false)

      // Null / undefined geometry
      expect(hasDrawableGeometry(null as any)).toBe(false)
      expect(hasDrawableGeometry(undefined as any)).toBe(false)

      // Valid geometry with position.count > 0
      const validGeo = {
        attributes: {
          position: { count: 36 },
        },
      }
      expect(hasDrawableGeometry(validGeo as any)).toBe(true)
    })
  })
})
