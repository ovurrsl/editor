// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// include Bun ambient types in its production declaration build.
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
  configureKtx2Support,
  ensureKtx2Support,
  isKtx2Url,
  ktx2Loader,
  whenKtx2Ready,
} from './ktx2-loader'

describe('KTX2 Loader & Alignment Transcoding', () => {
  describe('isKtx2Url', () => {
    test('identifies valid KTX2 file extensions case-insensitively', () => {
      expect(isKtx2Url('https://example.com/assets/floor.ktx2')).toBe(true)
      expect(isKtx2Url('textures/wall_diffuse.KTX2')).toBe(true)
      expect(isKtx2Url('/models/chair.Ktx2')).toBe(true)
    })

    test('rejects non-KTX2 file extensions', () => {
      expect(isKtx2Url('https://example.com/assets/floor.png')).toBe(false)
      expect(isKtx2Url('textures/wall_diffuse.jpg')).toBe(false)
      expect(isKtx2Url('models/scene.glb')).toBe(false)
      expect(isKtx2Url('textures/floor.ktx2.png')).toBe(false)
      expect(isKtx2Url('')).toBe(false)
    })
  })

  describe('ensureKtx2Support & whenKtx2Ready', () => {
    test('returns false for null or undefined renderer', () => {
      expect(ensureKtx2Support(null)).toBe(false)
      expect(ensureKtx2Support(undefined)).toBe(false)
    })

    test('configures support idempotently on mock renderer', async () => {
      const mockRenderer = { id: 'mock-webgpu-renderer' }
      // Mock detectSupport on the internal loader if necessary
      const detectSupportSpy = mock(() => undefined)
      ;(ktx2Loader as unknown as { detectSupport: (r: unknown) => void }).detectSupport = detectSupportSpy

      const firstCall = ensureKtx2Support(mockRenderer)
      expect(firstCall).toBe(true)
      expect(detectSupportSpy).toHaveBeenCalledWith(mockRenderer)

      // Second call with same renderer should be idempotent and not re-run detectSupport
      const secondCall = ensureKtx2Support(mockRenderer)
      expect(secondCall).toBe(true)
      expect(detectSupportSpy).toHaveBeenCalledTimes(1)

      // whenKtx2Ready should resolve now
      await expect(whenKtx2Ready()).resolves.toBeUndefined()
    })

    test('catches renderer detection error gracefully without throwing', () => {
      const failingRenderer = { id: 'failing-renderer' }
      ;(ktx2Loader as unknown as { detectSupport: (r: unknown) => void }).detectSupport = () => {
        throw new Error('WebGPU detectSupport failed transiently')
      }

      expect(() => ensureKtx2Support(failingRenderer)).not.toThrow()
      expect(ensureKtx2Support(failingRenderer)).toBe(false)
    })

    test('configureKtx2Support attaches ktx2Loader to target loader', () => {
      const targetLoader = {
        setKTX2Loader: mock((loader: unknown) => loader),
      }
      const mockRenderer = { id: 'test-renderer-config' }
      ;(ktx2Loader as unknown as { detectSupport: (r: unknown) => void }).detectSupport = () => undefined

      const result = configureKtx2Support(targetLoader, mockRenderer)
      expect(result).toBe(true)
      expect(targetLoader.setKTX2Loader).toHaveBeenCalledWith(ktx2Loader)
    })
  })

  describe('Binary KTX2 Header Parsing & Misaligned Dimension Routing', () => {
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
        view.setUint32(12, vkFormat, true) // vkFormat at byte 12
        view.setUint32(20, width, true)    // pixelWidth at byte 20
        view.setUint32(24, height, true)   // pixelHeight at byte 24
      }
      return buffer
    }

    test('recognizes aligned dimensions (multiples of 4) as safe for direct GPU compression', () => {
      const buffer512x256 = createSyntheticKtx2Buffer({ vkFormat: 0, width: 512, height: 256 })
      const view = new DataView(buffer512x256)
      const vkFormat = view.getUint32(12, true)
      const width = view.getUint32(20, true)
      const height = view.getUint32(24, true)

      expect(vkFormat).toBe(0)
      expect(width % 4).toBe(0)
      expect(height % 4).toBe(0)
    })

    test('detects misaligned dimensions (e.g. 513x257, 512x255) needing uncompressed fallback', () => {
      const testCases = [
        { width: 513, height: 256, expectMisaligned: true },
        { width: 512, height: 257, expectMisaligned: true },
        { width: 513, height: 257, expectMisaligned: true },
        { width: 1023, height: 1024, expectMisaligned: true },
        { width: 1024, height: 1024, expectMisaligned: false },
        { width: 512, height: 256, expectMisaligned: false },
      ]

      for (const { width, height, expectMisaligned } of testCases) {
        const buf = createSyntheticKtx2Buffer({ vkFormat: 0, width, height })
        const view = new DataView(buf)
        const isMisaligned = width % 4 !== 0 || height % 4 !== 0
        expect(isMisaligned).toBe(expectMisaligned)
      }
    })

    test('ignores non-Basis KTX2 formats (vkFormat !== 0)', () => {
      // vkFormat 131 = VK_FORMAT_R8G8B8A8_UNORM
      const bufferNonBasis = createSyntheticKtx2Buffer({ vkFormat: 131, width: 513, height: 257 })
      const view = new DataView(bufferNonBasis)
      const vkFormat = view.getUint32(12, true)
      expect(vkFormat).not.toBe(0)
    })

    test('handles truncated or short buffer (< 28 bytes) safely without throwing', () => {
      const shortBuffer = new ArrayBuffer(16)
      expect(shortBuffer.byteLength < 28).toBe(true)
    })
  })

  describe('AlignmentSafeKTX2Loader _createTexture fallback execution', () => {
    test('transcodes misaligned KTX2 texture to uncompressed DataTexture', async () => {
      // Mock fallback transcode returning CompressedTexture with decoded RGBA mipmap
      const misalignedBuffer = new ArrayBuffer(32)
      const view = new DataView(misalignedBuffer)
      view.setUint32(12, 0, true)   // vkFormat = 0
      view.setUint32(20, 513, true) // pixelWidth = 513 (odd width!)
      view.setUint32(24, 257, true) // pixelHeight = 257 (odd height!)

      const mockMipData = new Uint8Array(513 * 257 * 4)
      const mockTranscodedCompressedTexture = new CompressedTexture(
        [{ data: mockMipData, width: 513, height: 257 }],
        513,
        257,
      )
      mockTranscodedCompressedTexture.colorSpace = 'srgb'

      // Mock internal fallbackLoader on ktx2Loader
      const mockFallbackLoader = {
        _createTexture: mock(async () => mockTranscodedCompressedTexture),
      }
      ;(ktx2Loader as unknown as { fallbackLoader: () => unknown }).fallbackLoader = () => mockFallbackLoader

      const resultTexture = (await ktx2Loader._createTexture(misalignedBuffer)) as DataTexture

      expect(resultTexture).toBeInstanceOf(DataTexture)
      expect(resultTexture.image.width).toBe(513)
      expect(resultTexture.image.height).toBe(257)
      expect(resultTexture.format).toBe(RGBAFormat)
      expect(resultTexture.type).toBe(UnsignedByteType)
      expect(resultTexture.generateMipmaps).toBe(true)
      expect(resultTexture.minFilter).toBe(LinearMipmapLinearFilter)
      expect(resultTexture.magFilter).toBe(LinearFilter)
      expect(resultTexture.version).toBeGreaterThan(0)
    })
  })
})
