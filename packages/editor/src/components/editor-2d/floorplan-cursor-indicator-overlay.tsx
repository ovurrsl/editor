'use client'

import { Icon } from '@iconify/react'
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import useEditor, { type FloorplanSelectionTool } from '../../store/use-editor'
import { useFloorplanDraftPreview } from '../../store/use-floorplan-draft-preview'
import { furnishTools } from '../ui/action-menu/furnish-tools'
import { tools as structureTools } from '../ui/action-menu/structure-tools'
import {
  type FloorplanCursorPoint,
  projectFloorplanCursorPoint,
  resolveFloorplanCursorIndicatorPosition,
} from './floorplan-cursor-indicator-position'

type FloorplanCursorIndicator =
  | {
      kind: 'asset'
      iconSrc: string
    }
  | {
      kind: 'icon'
      icon: string
    }

type FloorplanCursorIndicatorOverlayProps = {
  cursorPosition: FloorplanCursorPoint | null
  floorplanSelectionTool: FloorplanSelectionTool
  movingOpeningType: 'door' | 'window' | null
  isPanning: boolean
  cursorColor: string
  indicatorLineHeight?: number
  indicatorBadgeOffsetX?: number
  indicatorBadgeOffsetY?: number
}

export const FloorplanCursorIndicatorOverlay = memo(function FloorplanCursorIndicatorOverlay({
  cursorPosition,
  floorplanSelectionTool,
  movingOpeningType,
  isPanning,
  cursorColor,
  indicatorLineHeight = 18,
  indicatorBadgeOffsetX = 14,
  indicatorBadgeOffsetY = 14,
}: FloorplanCursorIndicatorOverlayProps) {
  const mode = useEditor((state) => state.mode)
  const tool = useEditor((state) => state.tool)
  const structureLayer = useEditor((state) => state.structureLayer)
  const catalogCategory = useEditor((state) => state.catalogCategory)
  const cursorPoint = useFloorplanDraftPreview((state) => state.cursorPoint)
  const anchorRef = useRef<HTMLDivElement>(null)
  const [projectedCursorPosition, setProjectedCursorPosition] =
    useState<FloorplanCursorPoint | null>(null)

  const activeFloorplanToolConfig = useMemo(() => {
    if (movingOpeningType) {
      return structureTools.find((entry) => entry.id === movingOpeningType) ?? null
    }

    if (mode !== 'build' || !tool) {
      return null
    }

    if (tool === 'item' && catalogCategory) {
      return furnishTools.find((entry) => entry.catalogCategory === catalogCategory) ?? null
    }

    return structureTools.find((entry) => entry.id === tool) ?? null
  }, [catalogCategory, mode, movingOpeningType, tool])

  const indicator = useMemo<FloorplanCursorIndicator | null>(() => {
    if (activeFloorplanToolConfig) {
      return { kind: 'asset', iconSrc: activeFloorplanToolConfig.iconSrc }
    }

    if (mode === 'select' && floorplanSelectionTool === 'marquee' && structureLayer !== 'zones') {
      return { kind: 'icon', icon: 'mdi:select-drag' }
    }

    if (mode === 'delete') {
      return { kind: 'icon', icon: 'mdi:trash-can-outline' }
    }

    if (mode === 'material-paint') {
      return { kind: 'asset', iconSrc: '/icons/paint.webp' }
    }

    return null
  }, [activeFloorplanToolConfig, floorplanSelectionTool, mode, structureLayer])

  const cachedOverlayRectRef = useRef<{ left: number; top: number; width: number; height: number }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  })

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const overlayHost = anchor?.parentElement
    if (!overlayHost) return

    const updateRect = () => {
      const rect = overlayHost.getBoundingClientRect()
      cachedOverlayRectRef.current = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }
    }
    updateRect()
    const observer = new ResizeObserver(updateRect)
    observer.observe(overlayHost)
    window.addEventListener('resize', updateRect)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateRect)
    }
  }, [])

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const overlayHost = anchor?.parentElement
    const scene = overlayHost?.querySelector<SVGGElement>('[data-floorplan-scene]')
    const sceneToViewport = scene?.getScreenCTM()

    if (!(cursorPoint && cursorPosition && overlayHost && sceneToViewport)) {
      setProjectedCursorPosition(null)
      return
    }

    const overlayRect = cachedOverlayRectRef.current
    const nextPosition = projectFloorplanCursorPoint(cursorPoint, sceneToViewport, {
      x: overlayRect.left,
      y: overlayRect.top,
    })
    setProjectedCursorPosition((currentPosition) =>
      currentPosition &&
      currentPosition.x === nextPosition.x &&
      currentPosition.y === nextPosition.y
        ? currentPosition
        : nextPosition,
    )
  }, [cursorPoint, cursorPosition])

  const position = resolveFloorplanCursorIndicatorPosition(cursorPosition, projectedCursorPosition)

  if (!(indicator && position) || isPanning) {
    return null
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-20 will-change-transform"
      ref={anchorRef}
      style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
    >
      {mode === 'delete' ? (
        <div
          className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/95 shadow-[0_8px_16px_-4px_rgba(0,0,0,0.3),0_4px_8px_-4px_rgba(0,0,0,0.2)]"
          style={{
            boxShadow: `0 8px 16px -4px rgba(0,0,0,0.3), 0 4px 8px -4px rgba(0,0,0,0.2), 0 0 18px ${cursorColor}22`,
            transform: `translate(${indicatorBadgeOffsetX}px, ${indicatorBadgeOffsetY}px)`,
          }}
        >
          {indicator.kind === 'asset' ? (
            <img
              alt=""
              aria-hidden="true"
              className="h-5 w-5 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
              src={indicator.iconSrc}
            />
          ) : (
            <Icon
              aria-hidden="true"
              className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
              color={cursorColor}
              height={18}
              icon={indicator.icon}
              width={18}
            />
          )}
        </div>
      ) : (
        <>
          <div
            className="absolute top-0 left-1/2 w-px -translate-x-1/2 -translate-y-full"
            style={{
              backgroundColor: cursorColor,
              boxShadow: `0 0 12px ${cursorColor}55`,
              height: indicatorLineHeight,
            }}
          />
          <div
            className="absolute top-0 left-1/2 flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/95 shadow-[0_8px_16px_-4px_rgba(0,0,0,0.3),0_4px_8px_-4px_rgba(0,0,0,0.2)]"
            style={{
              transform: `translate(-50%, calc(-100% - ${indicatorLineHeight}px))`,
            }}
          >
            {indicator.kind === 'asset' ? (
              <img
                alt=""
                aria-hidden="true"
                className="h-5 w-5 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                src={indicator.iconSrc}
              />
            ) : (
              <Icon
                aria-hidden="true"
                className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
                color="white"
                height={18}
                icon={indicator.icon}
                width={18}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
})
