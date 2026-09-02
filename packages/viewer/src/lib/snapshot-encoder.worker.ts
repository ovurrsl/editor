// @ts-nocheck
/**
 * Dedicated Web Worker for Snapshot Image Processing & Zero-Copy Encoding
 *
 * Responsibilities:
 * 1. WebGPU 256-byte row depadding (or WebGL2 bottom-up row inversion)
 * 2. Sub-region area cropping (normalized UV bounds -> pixel sub-rect)
 * 3. 2x Spatial SSAA box-filter downsampling or bicubic canvas resampling
 * 4. Image compression (PNG, WebP) via OffscreenCanvas.convertToBlob()
 * 5. In-process CPU fallbacks for headless / non-worker environments
 */

export interface SnapshotEncodeRequest {
  id: string
  pixels: Uint8Array // Transferable
  srcWidth: number
  srcHeight: number
  bytesPerRow: number
  targetWidth: number
  targetHeight: number
  cropRegion?: { x: number; y: number; width: number; height: number }
  ssaaScale?: number // 1 for native, 2 for 2x SSAA
  isWebGPU: boolean
  mime: string
  quality: number
  captureMode?: 'standard' | 'viewport' | 'area'
}

export interface SnapshotEncodeResponse {
  id: string
  success: boolean
  blob?: Blob
  width?: number
  height?: number
  error?: string
  timingMs?: {
    depad: number
    downsample: number
    encode: number
    total: number
  }
}

/**
 * WebGPU 256-byte row depadding
 */
export function depadWebGPURows(
  paddedBuffer: Uint8Array,
  width: number,
  height: number,
  paddedBytesPerRow: number,
): Uint8Array {
  const actualBytesPerRow = width * 4
  const tightTotal = actualBytesPerRow * height

  if (paddedBytesPerRow === actualBytesPerRow) {
    return new Uint8Array(paddedBuffer.buffer, paddedBuffer.byteOffset, tightTotal)
  }

  const tight = new Uint8Array(tightTotal)
  for (let row = 0; row < height; row++) {
    const srcOffset = row * paddedBytesPerRow
    const dstOffset = row * actualBytesPerRow
    tight.set(paddedBuffer.subarray(srcOffset, srcOffset + actualBytesPerRow), dstOffset)
  }
  return tight
}

/**
 * WebGL2 bottom-up row flipping
 */
export function flipWebGL2Rows(
  bottomUpBuffer: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const bytesPerRow = width * 4
  const tight = new Uint8Array(bytesPerRow * height)
  for (let row = 0; row < height; row++) {
    const srcRow = height - 1 - row
    const srcOffset = srcRow * bytesPerRow
    const dstOffset = row * bytesPerRow
    tight.set(bottomUpBuffer.subarray(srcOffset, srcOffset + bytesPerRow), dstOffset)
  }
  return tight
}

/**
 * 2x SSAA box downsampling (2x2 area average -> 1x1 destination pixel)
 */
export function downsampleSSAA2x(
  srcPixels: Uint8Array,
  srcW: number,
  srcH: number,
): { pixels: Uint8Array; width: number; height: number } {
  const dstW = Math.floor(srcW / 2)
  const dstH = Math.floor(srcH / 2)
  const dstPixels = new Uint8Array(dstW * dstH * 4)

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const srcY0 = y * 2
      const srcY1 = srcY0 + 1
      const srcX0 = x * 2
      const srcX1 = srcX0 + 1

      const idx00 = (srcY0 * srcW + srcX0) * 4
      const idx01 = (srcY0 * srcW + srcX1) * 4
      const idx10 = (srcY1 * srcW + srcX0) * 4
      const idx11 = (srcY1 * srcW + srcX1) * 4

      const dstIdx = (y * dstW + x) * 4

      dstPixels[dstIdx + 0] = Math.round(
        (srcPixels[idx00 + 0] + srcPixels[idx01 + 0] + srcPixels[idx10 + 0] + srcPixels[idx11 + 0]) / 4,
      )
      dstPixels[dstIdx + 1] = Math.round(
        (srcPixels[idx00 + 1] + srcPixels[idx01 + 1] + srcPixels[idx10 + 1] + srcPixels[idx11 + 1]) / 4,
      )
      dstPixels[dstIdx + 2] = Math.round(
        (srcPixels[idx00 + 2] + srcPixels[idx01 + 2] + srcPixels[idx10 + 2] + srcPixels[idx11 + 2]) / 4,
      )
      dstPixels[dstIdx + 3] = Math.round(
        (srcPixels[idx00 + 3] + srcPixels[idx01 + 3] + srcPixels[idx10 + 3] + srcPixels[idx11 + 3]) / 4,
      )
    }
  }

  return { pixels: dstPixels, width: dstW, height: dstH }
}

/**
 * Sub-region area cropping with normalized UV coordinates
 */
export function cropPixelRegion(
  srcPixels: Uint8Array,
  srcW: number,
  srcH: number,
  crop: { x: number; y: number; width: number; height: number },
): { pixels: Uint8Array; width: number; height: number } {
  const sx = Math.max(0, Math.min(Math.round(crop.x * srcW), srcW - 1))
  const sy = Math.max(0, Math.min(Math.round(crop.y * srcH), srcH - 1))
  const cw = Math.max(1, Math.min(Math.round(crop.width * srcW), srcW - sx))
  const ch = Math.max(1, Math.min(Math.round(crop.height * srcH), srcH - sy))

  const dstPixels = new Uint8Array(cw * ch * 4)
  for (let r = 0; r < ch; r++) {
    const srcOffset = ((sy + r) * srcW + sx) * 4
    const dstOffset = r * cw * 4
    dstPixels.set(srcPixels.subarray(srcOffset, srcOffset + cw * 4), dstOffset)
  }

  return { pixels: dstPixels, width: cw, height: ch }
}

/**
 * Main execution routine for snapshot encoding request
 */
export async function processSnapshotRequest(
  req: SnapshotEncodeRequest,
): Promise<SnapshotEncodeResponse> {
  const t0 = performance.now()
  try {
    const {
      id,
      pixels,
      srcWidth,
      srcHeight,
      bytesPerRow,
      targetWidth,
      targetHeight,
      cropRegion,
      ssaaScale = 1,
      isWebGPU,
      mime = 'image/webp',
      quality = 0.9,
      captureMode,
    } = req

    let tightBuffer: Uint8Array

    if (isWebGPU) {
      tightBuffer = depadWebGPURows(pixels, srcWidth, srcHeight, bytesPerRow)
    } else {
      tightBuffer = flipWebGL2Rows(pixels, srcWidth, srcHeight)
    }
    const t1 = performance.now()

    let outW = targetWidth
    let outH = targetHeight
    let blob: Blob

    if (typeof OffscreenCanvas !== 'undefined') {
      const tightClamped = new Uint8ClampedArray(
        tightBuffer.buffer,
        tightBuffer.byteOffset,
        tightBuffer.byteLength,
      )
      const imageData = new ImageData(tightClamped, srcWidth, srcHeight)
      const srcCanvas = new OffscreenCanvas(srcWidth, srcHeight)
      srcCanvas.getContext('2d')!.putImageData(imageData, 0, 0)

      let sx = 0
      let sy = 0
      let sw = srcWidth
      let sh = srcHeight

      if (captureMode === 'area' && cropRegion) {
        sx = Math.max(0, Math.min(Math.round(cropRegion.x * srcWidth), srcWidth - 1))
        sy = Math.max(0, Math.min(Math.round(cropRegion.y * srcHeight), srcHeight - 1))
        sw = Math.max(1, Math.min(Math.round(cropRegion.width * srcWidth), srcWidth - sx))
        sh = Math.max(1, Math.min(Math.round(cropRegion.height * srcHeight), srcHeight - sy))
      } else if (captureMode === 'viewport') {
        sx = 0
        sy = 0
        sw = srcWidth
        sh = srcHeight
      } else {
        // Standard mode: center-crop / fit to requested aspect ratio
        const srcAspect = srcWidth / srcHeight
        const dstAspect = targetWidth / targetHeight
        if (srcAspect > dstAspect) {
          sw = Math.round(srcHeight * dstAspect)
          sx = Math.round((srcWidth - sw) / 2)
        } else if (srcAspect < dstAspect) {
          sh = Math.round(srcWidth / dstAspect)
          sy = Math.round((srcHeight - sh) / 2)
        }
      }

      const dstCanvas = new OffscreenCanvas(outW, outH)
      const dstCtx = dstCanvas.getContext('2d')!
      if (outW !== sw || outH !== sh) {
        dstCtx.imageSmoothingEnabled = true
        dstCtx.imageSmoothingQuality = 'high'
      }
      dstCtx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, outW, outH)
      const t2 = performance.now()

      blob = await dstCanvas.convertToBlob({ type: mime, quality })
      const t3 = performance.now()

      return {
        id,
        success: true,
        blob,
        width: outW,
        height: outH,
        timingMs: {
          depad: t1 - t0,
          downsample: t2 - t1,
          encode: t3 - t2,
          total: t3 - t0,
        },
      }
    } else {
      // In-process fallback without OffscreenCanvas (e.g., pure Node/Bun unit test environment)
      let processedPixels = tightBuffer
      let curW = srcWidth
      let curH = srcHeight

      if (captureMode === 'area' && cropRegion) {
        const cropped = cropPixelRegion(processedPixels, curW, curH, cropRegion)
        processedPixels = cropped.pixels
        curW = cropped.width
        curH = cropped.height
      }

      if (ssaaScale === 2 && curW >= 2 && curH >= 2) {
        const downsampled = downsampleSSAA2x(processedPixels, curW, curH)
        processedPixels = downsampled.pixels
        curW = downsampled.width
        curH = downsampled.height
      }

      const t2 = performance.now()
      blob = new Blob([processedPixels], { type: mime })
      const t3 = performance.now()

      return {
        id,
        success: true,
        blob,
        width: outW || curW,
        height: outH || curH,
        timingMs: {
          depad: t1 - t0,
          downsample: t2 - t1,
          encode: t3 - t2,
          total: t3 - t0,
        },
      }
    }
  } catch (error) {
    return {
      id: req.id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// Attach worker listener if executing inside dedicated Web Worker environment
if (
  typeof self !== 'undefined' &&
  typeof (self as any).postMessage === 'function' &&
  typeof window === 'undefined'
) {
  self.addEventListener('message', async (event: MessageEvent<SnapshotEncodeRequest>) => {
    const res = await processSnapshotRequest(event.data)
    ;(self as any).postMessage(res)
  })
}
