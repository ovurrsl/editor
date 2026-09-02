import { type Camera, Color, Matrix4, type Scene, UnsignedByteType } from 'three'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js'
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js'
import {
  convertToTexture,
  diffuseColor,
  float,
  mix,
  mrt,
  normalView,
  output,
  pass,
  sample,
  saturation,
  screenUV,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import { RenderPipeline, RenderTarget, type WebGPURenderer } from 'three/webgpu'
import { GRADE_PARAMS, SSGI_PARAMS } from '../components/viewer/post-processing'
import { backdropGradient, deepSkyColor, horizonHazeColor } from './backdrop'
import { type EdgeMode, edgeColorFor, edgeOpacityScaleFor } from './edge-style'
import { inkedEdges } from './ink-edges'
import { getSceneTheme } from './scene-themes'
import {
  encodeSnapshot,
  type SnapshotEncodeRequest,
} from './snapshot-encoder-client'
import { packNormalToRGB, unpackRGBToNormal } from './tsl-compat'

export const THUMBNAIL_WIDTH = 1920
export const THUMBNAIL_HEIGHT = 1080

/**
 * Captures are re-renderable artifacts, not user originals, so they default to
 * webp: a 1920×1080 hero shot lands roughly an order of magnitude under PNG,
 * which is what listings and the catalog actually ship over the wire. Alpha
 * survives, so transparent item/preset captures keep working.
 */
export const SNAPSHOT_MIME = 'image/webp'
export const SNAPSHOT_QUALITY = 0.9
// Retina canvases make viewport/area captures multi-MB; 2048 keeps them near the 1920 presets in Fast mode.
export const SNAPSHOT_MAX_EDGE = 2048

export type SnapshotQualityMode = 'fast' | 'quality'
export type SnapshotAntiAliasing = 'fxaa' | 'ssaa' | 'taa' | 'none'
export type SnapshotCaptureMode = 'standard' | 'viewport' | 'area'

export type SnapshotCropRegion = {
  x: number
  y: number
  width: number
  height: number
}

export type SnapshotSize = {
  w: number
  h: number
}

export type SnapshotCaptureResult = {
  blob: Blob
  outW: number
  outH: number
}

export interface SnapshotCaptureOptions {
  captureMode?: SnapshotCaptureMode
  cropRegion?: SnapshotCropRegion
  standardSize?: SnapshotSize
  transparent?: boolean
  mime?: string
  quality?: number
  qualityMode?: SnapshotQualityMode
  antiAliasing?: SnapshotAntiAliasing
  scale?: number
  maxEdge?: number
}

export function clampSnapshotSize(
  width: number,
  height: number,
  qualityMode: SnapshotQualityMode = 'fast',
  ceiling = SNAPSHOT_MAX_EDGE,
): { w: number; h: number } {
  // In Quality mode, bypass the 2048px ceiling completely (up to hardware limits)
  if (qualityMode === 'quality') return { w: width, h: height }

  const maxEdge = Math.max(width, height)
  if (maxEdge <= ceiling) return { w: width, h: height }

  const scale = ceiling / maxEdge
  return { w: Math.round(width * scale), h: Math.round(height * scale) }
}

export type SnapshotPipeline = {
  applyEnvironment: ({
    theme,
    transparent,
    grade,
    edges,
    camera,
  }: {
    theme: string
    transparent: boolean
    grade: boolean
    edges: EdgeMode
    camera: Camera
  }) => void
  capture: (options?: SnapshotCaptureOptions) => Promise<SnapshotCaptureResult>
  dispose: () => void
}

export async function createSnapshotPipeline({
  renderer,
  scene,
  camera,
}: {
  renderer: WebGPURenderer
  scene: Scene
  camera: Camera
}): Promise<SnapshotPipeline | null> {
  try {
    if ((renderer as any).init) await (renderer as any).init()

    // Backdrop compositing for scene snapshots (studio renders, project
    // thumbnails): theme background + sky gradient, same world-ray math as the
    // viewport backdrop in viewer's post-processing. Uniform-driven so the one
    // cached pipeline serves both opaque and transparent (preset/item) captures.
    const bgColorUniform = uniform(new Color('#ffffff'))
    const bgSkyUniform = uniform(new Color('#ffffff'))
    const bgSkyDeepUniform = uniform(new Color('#ffffff'))
    const bgHazeUniform = uniform(new Color('#ffffff'))
    const bgProjInvUniform = uniform(new Matrix4())
    const bgCamWorldUniform = uniform(new Matrix4())
    const bgMixUniform = uniform(1)
    const gradeMixUniform = uniform(0)
    const inkMixUniform = uniform(0)
    const inkColorUniform = uniform(new Color('#1a1d24'))
    const inkOpacityUniform = uniform(0.5)
    const inkOpacityScaleUniform = uniform(1)
    const inkRadiusUniform = uniform(1)

    // pass() handles MRT internally for all material types, including custom
    // shaders — unlike renderer.setMRT() which crashes on non-NodeMaterials.
    // pass() also respects camera.layers, so caller-disabled objects are filtered.
    const scenePass = pass(scene, camera)
    scenePass.setMRT(
      mrt({
        output,
        diffuseColor,
        normal: packNormalToRGB(normalView),
      }),
    )

    const scenePassColor = scenePass.getTextureNode('output')
    const scenePassDepth = scenePass.getTextureNode('depth')
    const scenePassNormal = scenePass.getTextureNode('normal')

    scenePass.getTexture('diffuseColor').type = UnsignedByteType
    scenePass.getTexture('normal').type = UnsignedByteType

    const sceneNormal = sample((uv) => unpackRGBToNormal(scenePassNormal.sample(uv)))

    const giPass = ssgi(scenePassColor, scenePassDepth, sceneNormal, camera as any)
    giPass.sliceCount.value = SSGI_PARAMS.sliceCount
    giPass.stepCount.value = SSGI_PARAMS.stepCount
    giPass.radius.value = SSGI_PARAMS.radius
    giPass.expFactor.value = SSGI_PARAMS.expFactor
    giPass.thickness.value = SSGI_PARAMS.thickness
    giPass.backfaceLighting.value = SSGI_PARAMS.backfaceLighting
    giPass.aoIntensity.value = SSGI_PARAMS.aoIntensity
    giPass.giIntensity.value = SSGI_PARAMS.giIntensity
    giPass.useLinearThickness.value = SSGI_PARAMS.useLinearThickness
    giPass.useScreenSpaceSampling.value = SSGI_PARAMS.useScreenSpaceSampling
    giPass.useTemporalFiltering = SSGI_PARAMS.useTemporalFiltering

    // r185: SSGI's AO lives in its own single-channel texture (getAONode)
    // rather than the alpha of one packed rgba texture.
    const aoTexture = (giPass as any).getAONode()
    const aoAsRgb = vec4(aoTexture.r, aoTexture.r, aoTexture.r, float(1))
    const denoisePass = denoise(aoAsRgb, scenePassDepth, sceneNormal, camera)
    denoisePass.index.value = 0
    denoisePass.radius.value = 4

    // Same far-field AO fade as the viewport pipeline — without it the
    // horizon picks up a visible AO line in captures.
    const aoFarFade = smoothstep(float(0.9994), float(0.9998), scenePassDepth.sample(screenUV).r)
    const ao = mix((denoisePass as any).r, float(1), aoFarFade)
    const aoRgb = scenePassColor.rgb.mul(ao)

    // Ink edges, mirroring the viewport pipeline (AO → ink → grade) so
    // captures carry the same soft/strong edge look the canvas shows.
    // Dynamic uniform radius scales with render target height.
    const inkedRgb = inkedEdges({
      sceneRgb: aoRgb,
      depthTex: scenePassDepth,
      normalTex: scenePassNormal,
      inkColor: inkColorUniform,
      radius: inkRadiusUniform as any,
      opacity: float(inkOpacityUniform).mul(inkOpacityScaleUniform),
    })
    const ungradedSceneRgb = mix(aoRgb, inkedRgb, inkMixUniform)
    const gradeRgb = (rgb: any) =>
      saturation(rgb.div(0.18).pow(vec3(GRADE_PARAMS.contrast)).mul(0.18), GRADE_PARAMS.saturation)
    const sceneRgb = mix(ungradedSceneRgb, gradeRgb(ungradedSceneRgb), gradeMixUniform)

    // Per-pixel world ray from the capture camera → sky gradient above the
    // horizon (dir.y = 0), flat background below — mirrors the viewport
    // backdrop. bgMix 0 bypasses it and keeps the capture transparent.
    const ndc = vec4(screenUV.x.mul(2).sub(1), float(1).sub(screenUV.y).mul(2).sub(1), 1, 1) as any
    const viewRay = (bgProjInvUniform as any).mul(ndc)
    const worldDir = (bgCamWorldUniform as any).mul(vec4(viewRay.xyz, 0)).xyz.normalize()
    const ungradedBgGradient = backdropGradient({
      dirY: worldDir.y,
      background: bgColorUniform,
      haze: bgHazeUniform,
      sky: bgSkyUniform,
      skyDeep: bgSkyDeepUniform,
    })
    const bgGradient = mix(ungradedBgGradient, gradeRgb(ungradedBgGradient), gradeMixUniform)
    const alpha = scenePassColor.a
    const finalOutput = vec4(
      mix(sceneRgb, mix(bgGradient, sceneRgb, alpha), bgMixUniform),
      mix(alpha, float(1), bgMixUniform),
    )

    // FXAA node for Fast Mode: requires a texture node as input
    const fxaaOutput = fxaa(convertToTexture(finalOutput))

    const pipeline = new RenderPipeline(renderer)
    pipeline.outputNode = fxaaOutput

    // Dedicated render target — dynamically resized per capture call
    const initialWidth = renderer.domElement.width || 1920
    const initialHeight = renderer.domElement.height || 1080
    const renderTarget = new RenderTarget(initialWidth, initialHeight, { depthBuffer: true })

    return {
      applyEnvironment: ({ theme, transparent, grade, edges, camera: captureCamera }) => {
        const sceneTheme = getSceneTheme(theme)
        inkMixUniform.value = edges === 'off' ? 0 : 1
        inkOpacityUniform.value = edges === 'strong' ? 1 : 0.5
        inkColorUniform.value.set(edgeColorFor(sceneTheme.background))
        inkOpacityScaleUniform.value = edgeOpacityScaleFor(sceneTheme.background)
        bgColorUniform.value.set(sceneTheme.background)
        bgSkyUniform.value.set(sceneTheme.backgroundSky ?? sceneTheme.background)
        bgSkyDeepUniform.value.set(deepSkyColor(sceneTheme.backgroundSky ?? sceneTheme.background))
        bgHazeUniform.value.set(
          horizonHazeColor(
            sceneTheme.backgroundSky ?? sceneTheme.background,
            sceneTheme.appearance,
          ),
        )
        bgMixUniform.value = transparent ? 0 : 1
        gradeMixUniform.value = grade ? 1 : 0

        // The capture camera never joins the scene graph, so its matrixWorld
        // is only refreshed by the render itself — too late for the backdrop
        // uniforms below.
        captureCamera.updateMatrixWorld()
        bgProjInvUniform.value.copy(captureCamera.projectionMatrixInverse)
        bgCamWorldUniform.value.copy(captureCamera.matrixWorld)
      },
      capture: async (options?: SnapshotCaptureOptions) => {
        const {
          captureMode = 'standard',
          cropRegion,
          standardSize,
          mime = SNAPSHOT_MIME,
          quality = SNAPSHOT_QUALITY,
          qualityMode = 'fast',
          antiAliasing = qualityMode === 'quality' ? 'ssaa' : 'fxaa',
          scale = 1,
          maxEdge = qualityMode === 'quality' ? 8192 : SNAPSHOT_MAX_EDGE,
        } = options ?? {}

        const standardW = standardSize?.w ?? THUMBNAIL_WIDTH
        const standardH = standardSize?.h ?? THUMBNAIL_HEIGHT
        const domWidth = renderer.domElement.width || 1920
        const domHeight = renderer.domElement.height || 1080

        let targetWidth: number
        let targetHeight: number

        if (captureMode === 'viewport') {
          const baseW = Math.round(domWidth * scale)
          const baseH = Math.round(domHeight * scale)
          ;({ w: targetWidth, h: targetHeight } = clampSnapshotSize(
            baseW,
            baseH,
            qualityMode,
            maxEdge,
          ))
        } else if (captureMode === 'area' && cropRegion) {
          const baseW = Math.round(cropRegion.width * domWidth * scale)
          const baseH = Math.round(cropRegion.height * domHeight * scale)
          ;({ w: targetWidth, h: targetHeight } = clampSnapshotSize(
            baseW,
            baseH,
            qualityMode,
            maxEdge,
          ))
        } else {
          // Standard mode
          targetWidth = standardW
          targetHeight = standardH
        }

        // Determine SSAA scale factor
        // In Quality mode with SSAA/TAA, render at 2x resolution and downsample in worker
        const ssaaScale =
          qualityMode === 'quality' &&
          (antiAliasing === 'ssaa' || antiAliasing === 'taa') &&
          targetWidth * 2 <= 8192 &&
          targetHeight * 2 <= 8192
            ? 2
            : 1

        const renderWidth = targetWidth * ssaaScale
        const renderHeight = targetHeight * ssaaScale

        // Switch anti-aliasing output node:
        // In Quality mode, bypass FXAA node to maintain crisp ink lines and fine geometric detail
        if (qualityMode === 'quality' && antiAliasing !== 'fxaa') {
          pipeline.outputNode = finalOutput
        } else {
          pipeline.outputNode = fxaaOutput
        }

        // Dynamically scale ink radius proportional to render target height
        inkRadiusUniform.value = Math.max(1, Math.round(renderHeight / 1080))

        // Resize RenderTarget to match exact render dimensions
        if (renderTarget.width !== renderWidth || renderTarget.height !== renderHeight) {
          renderTarget.setSize(renderWidth, renderHeight)
        }

        try {
          ;(renderer as any).setClearAlpha(0)
          renderer.setRenderTarget(renderTarget)
          pipeline.render()
        } finally {
          renderer.setRenderTarget(null)
        }

        // Let callers restore visibility and other capture policy immediately
        // after the render, before the asynchronous GPU readback begins.
        await Promise.resolve()

        // Read pixels from the RT asynchronously via WebGPU buffer mapping
        const pixels = (await (renderer as any).readRenderTargetPixelsAsync(
          renderTarget,
          0,
          0,
          renderWidth,
          renderHeight,
        )) as Uint8Array

        const actualBytesPerRow = renderWidth * 4
        const paddedBytesPerRow = Math.ceil(actualBytesPerRow / 256) * 256

        const backend = (renderer as any).backend
        const isWebGPU =
          !!backend?.device ||
          backend?.isWebGPUBackend === true ||
          backend?.constructor?.name === 'WebGPUBackend'

        const encodeRequest: SnapshotEncodeRequest = {
          id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          pixels,
          srcWidth: renderWidth,
          srcHeight: renderHeight,
          bytesPerRow: isWebGPU ? paddedBytesPerRow : actualBytesPerRow,
          targetWidth,
          targetHeight,
          cropRegion: captureMode === 'area' ? cropRegion : undefined,
          ssaaScale,
          isWebGPU,
          mime,
          quality,
          captureMode,
        }

        // Offload image processing & encoding to Web Worker
        const response = await encodeSnapshot(encodeRequest)
        if (!response.success || !response.blob) {
          throw new Error(response.error || 'Failed to encode snapshot in worker')
        }

        return {
          blob: response.blob,
          outW: response.width ?? targetWidth,
          outH: response.height ?? targetHeight,
        }
      },
      dispose: () => {
        pipeline.dispose()
        renderTarget.dispose()
      },
    }
  } catch (error) {
    console.error(
      '[thumbnail] Failed to build post-processing pipeline, will use fallback render.',
      error,
    )
    return null
  }
}
