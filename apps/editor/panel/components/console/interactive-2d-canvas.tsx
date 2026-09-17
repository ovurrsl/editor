'use client'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import {
  type AnyNode,
  type FloorplanGeometry,
  type FloorplanPalette,
  type GeometryContext,
  nodeRegistry,
} from '@pascal-app/core'
import { FloorplanGeometryRenderer, type FloorplanPreviewScene } from '@pascal-app/editor'
import { Maximize2, Minus, Plus } from 'lucide-react'
import { type PalletRackNode, palletRackDefinition } from '@ovurrsl/plugin-warehouse'
import type { WarehouseLocation } from '@panel/lib/types'

// ── Types ───────────────────────────────────────────────────────────────────

export interface Interactive2DCanvasProps {
  /**
   * Warehouse scene containing nodes (pallet racks, walls, slabs, levels).
   */
  scene?: FloorplanPreviewScene | null

  /**
   * The ID of the currently selected rack (PalletRackNode.id).
   */
  selectedRackId?: string | null

  /**
   * Dispatched when a rack node is clicked. Passes null on background click (deselect).
   */
  onSelectRack?: (rack: PalletRackNode | null) => void

  /**
   * The ID of the currently hovered rack.
   */
  hoveredRackId?: string | null

  /**
   * Dispatched on pointer enter/leave of a rack node.
   */
  onHoverRack?: (rackId: string | null) => void

  /**
   * Container width.
   */
  width?: number | string

  /**
   * Container height.
   */
  height?: number | string

  /**
   * Additional container CSS classes.
   */
  className?: string

  /**
   * Site name for the header badge (e.g. 'Bursa Depo').
   */
  siteName?: string

  /**
   * Active level filter for warehouse slot addressing (e.g. 'Kat A', 'Kat B').
   */
  activeLevelFilter?: string | null

  /**
   * Optional warehouse locations associated with the site.
   */
  locations?: WarehouseLocation[]
}

interface FloorplanViewBox {
  x: number
  y: number
  width: number
  height: number
}

interface FloorplanBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface RenderableRackEntry {
  id: string
  node: PalletRackNode
  geometry: FloorplanGeometry
  bounds: FloorplanBounds
}

interface RenderableBackgroundEntry {
  id: string
  node: AnyNode
  geometry: FloorplanGeometry | null
}

const READ_ONLY_PALETTE: FloorplanPalette = {
  selectedStroke: '#DC2626', // Crimson red for selected rack
  selectedFill: '#FEE2E2',   // Light red tint for selected rack
  selectedHatch: '#EF4444',
  wallHoverStroke: '#64748b',
  endpointHandleFill: '#ffffff',
  endpointHandleStroke: '#f97316',
  endpointHandleHoverStroke: '#fb923c',
  endpointHandleActiveFill: '#fed7aa',
  endpointHandleActiveStroke: '#ea580c',
  curveHandleFill: '#ffffff',
  curveHandleStroke: '#0d9488',
  curveHandleHoverStroke: '#14b8a6',
  measurementStroke: '#475569',
  measurementLabelBackground: '#ffffff',
  measurementLabelText: '#0f172a',
}

const DEFAULT_VIEW_BOX: FloorplanViewBox = { x: -20, y: -20, width: 40, height: 40 }

// ── Math & Framing Helpers ──────────────────────────────────────────────────

function padBounds(b: FloorplanBounds, paddingPercent = 0.15): FloorplanBounds {
  const w = Math.max(b.maxX - b.minX, 4)
  const h = Math.max(b.maxY - b.minY, 4)
  const padX = w * paddingPercent
  const padY = h * paddingPercent
  return {
    minX: b.minX - padX,
    minY: b.minY - padY,
    maxX: b.maxX + padX,
    maxY: b.maxY + padY,
  }
}

function boundsToViewBox(b: FloorplanBounds): FloorplanViewBox {
  return {
    x: b.minX,
    y: b.minY,
    width: Math.max(b.maxX - b.minX, 1),
    height: Math.max(b.maxY - b.minY, 1),
  }
}

function computeNodeBounds(node: AnyNode): FloorplanBounds {
  const pos = (node as { position?: [number, number, number] }).position || [0, 0, 0]
  const width = (node as { bayClearWidth?: number }).bayClearWidth || 3
  const depth = (node as { depth?: number }).depth || 1.2
  return {
    minX: pos[0] - width / 2,
    minY: pos[2] - depth / 2,
    maxX: pos[0] + width / 2,
    maxY: pos[2] + depth / 2,
  }
}

// ── Component Definition ────────────────────────────────────────────────────

export function Interactive2DCanvas({
  scene,
  selectedRackId,
  onSelectRack,
  hoveredRackId,
  onHoverRack,
  width = '100%',
  height = '100%',
  className = '',
  siteName = 'Warehouse Plan',
  activeLevelFilter,
}: Interactive2DCanvasProps) {
  const nodes = useMemo(() => scene?.nodes ?? {}, [scene?.nodes])
  const gridPatternId = useId().replace(/:/g, '')

  // 1. Collect & Segregate Nodes
  const { rackEntries, backgroundEntries, combinedBounds } = useMemo(() => {
    const racks: RenderableRackEntry[] = []
    const backgrounds: RenderableBackgroundEntry[] = []
    let bounds: FloorplanBounds | null = null

    for (const [id, node] of Object.entries(nodes)) {
      if (!node) continue
      const isRack =
        (node.type as string) === 'warehouse:pallet-rack' ||
        (node as { kind?: string }).kind === 'warehouse:pallet-rack'
      const def = nodeRegistry.get(node.type)

      const isSelected = id === selectedRackId
      const isHovered = id === hoveredRackId

      // Build Floorplan Context
      const ctx = {
        nodes,
        parent: undefined as any,
        children: [],
        siblings: [],
        viewState: {
          selected: isSelected,
          hovered: isHovered,
          highlighted: isSelected,
          moving: false,
          unit: 'metric' as const,
          palette: READ_ONLY_PALETTE,
        },
        extensions: {
          activeFloorplanLevelFilter: activeLevelFilter,
        },
      } as unknown as GeometryContext

      let geometry: FloorplanGeometry | null = null

      if (isRack) {
        const rackNode = {
          ...palletRackDefinition.defaults(),
          ...(node as any),
        } as unknown as PalletRackNode

        if (def?.floorplan) {
          try {
            geometry = def.floorplan(rackNode as never, ctx)
          } catch {
            // Fallback handled below
          }
        }

        if (!geometry && palletRackDefinition.floorplan) {
          try {
            geometry = palletRackDefinition.floorplan(rackNode, ctx)
          } catch {
            // Fallback geometry
          }
        }

        if (!geometry) {
          const w = (node as { bayClearWidth?: number }).bayClearWidth || 2.7
          const d = (node as { depth?: number }).depth || 1.1
          const posX = (node as { position?: [number, number, number] }).position?.[0] ?? 0
          const posZ = (node as { position?: [number, number, number] }).position?.[2] ?? 0
          const rotY = (node as { rotation?: [number, number, number] }).rotation?.[1] ?? 0
          geometry = {
            kind: 'group',
            children: [
              {
                kind: 'rect',
                x: -w / 2,
                y: -d / 2,
                width: w,
                height: d,
                fill: isSelected ? '#FEE2E2' : '#ffffff',
                stroke: isSelected ? '#DC2626' : '#7c7468',
                strokeWidth: isSelected ? 0.03 : 0.022,
              },
            ],
            transform: {
              translate: [posX, posZ],
              rotate: -rotY,
            },
          }
        }

        const nodeBounds = computeNodeBounds(node)
        bounds = bounds
          ? {
              minX: Math.min(bounds.minX, nodeBounds.minX),
              minY: Math.min(bounds.minY, nodeBounds.minY),
              maxX: Math.max(bounds.maxX, nodeBounds.maxX),
              maxY: Math.max(bounds.maxY, nodeBounds.maxY),
            }
          : nodeBounds

        racks.push({
          id,
          node: node as unknown as PalletRackNode,
          geometry,
          bounds: nodeBounds,
        })
      } else {
        if (!geometry) {
          if (node.type === 'wall') {
            const wNode = node as { start?: [number, number]; end?: [number, number]; thickness?: number }
            geometry = {
              kind: 'line',
              x1: wNode.start?.[0] ?? 0,
              y1: wNode.start?.[1] ?? 0,
              x2: wNode.end?.[0] ?? 0,
              y2: wNode.end?.[1] ?? 0,
              stroke: '#64748b',
              strokeWidth: wNode.thickness ?? 0.2,
            }
          } else if (node.type === 'column') {
            const cNode = node as { position?: [number, number, number]; width?: number; depth?: number }
            const cx = cNode.position?.[0] ?? 0
            const cz = cNode.position?.[2] ?? 0
            const cw = cNode.width ?? 0.6
            const cd = cNode.depth ?? 0.6
            geometry = {
              kind: 'rect',
              x: cx - cw / 2,
              y: cz - cd / 2,
              width: cw,
              height: cd,
              fill: '#64748b',
            }
          } else if (node.type === 'slab') {
            const sNode = node as { polygon?: [number, number][] }
            geometry = {
              kind: 'polygon',
              points: sNode.polygon ?? [],
              fill: '#334155',
              stroke: '#475569',
              strokeWidth: 0.05,
            }
          }
        }

        backgrounds.push({
          id,
          node,
          geometry,
        })
      }
    }

    return {
      rackEntries: racks,
      backgroundEntries: backgrounds,
      combinedBounds: bounds ? padBounds(bounds) : null,
    }
  }, [nodes, selectedRackId, hoveredRackId, activeLevelFilter])

  // 2. Viewport & Pan/Zoom State
  const initialViewBox = useMemo(() => {
    return combinedBounds ? boundsToViewBox(combinedBounds) : DEFAULT_VIEW_BOX
  }, [combinedBounds])

  const [viewBox, setViewBox] = useState<FloorplanViewBox>(initialViewBox)
  const viewBoxRef = useRef(viewBox)
  viewBoxRef.current = viewBox

  // Fit view when bounds change significantly
  useEffect(() => {
    if (combinedBounds) {
      const vb = boundsToViewBox(combinedBounds)
      setViewBox(vb)
    }
  }, [combinedBounds])

  // Pan gesture tracking
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    initialViewBox: FloorplanViewBox
  } | null>(null)
  const hasMovedRef = useRef(false)
  const svgRef = useRef<SVGSVGElement | null>(null)

  // 3. Navigation Actions
  const zoom = useCallback((factor: number) => {
    setViewBox((current) => {
      const newWidth = current.width * factor
      const newHeight = current.height * factor
      const dx = (newWidth - current.width) / 2
      const dy = (newHeight - current.height) / 2
      return {
        x: current.x - dx,
        y: current.y - dy,
        width: newWidth,
        height: newHeight,
      }
    })
  }, [])

  const fitView = useCallback(() => {
    if (combinedBounds) {
      setViewBox(boundsToViewBox(combinedBounds))
    } else {
      setViewBox(DEFAULT_VIEW_BOX)
    }
  }, [combinedBounds])

  // 4. Mouse Wheel Zoom
  const handleWheel = useCallback(
    (e: ReactWheelEvent<SVGSVGElement>) => {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 1.15 : 0.85
      zoom(factor)
    },
    [zoom],
  )

  // 5. Pointer Events for Pan & Disambiguated Click
  const handlePointerDown = useCallback((e: ReactPointerEvent<SVGElement>) => {
    if (e.button !== 0 && e.button !== undefined) return
    hasMovedRef.current = false
    panStartRef.current = {
      pointerId: e.pointerId ?? 1,
      startX: e.clientX,
      startY: e.clientY,
      initialViewBox: viewBoxRef.current,
    }
    setIsPanning(true)
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Best effort pointer capture
    }
  }, [])

  const handlePointerMove = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panStartRef.current
    if (!pan || (e.pointerId !== undefined && pan.pointerId !== e.pointerId)) return

    const dx = e.clientX - pan.startX
    const dy = e.clientY - pan.startY

    if (Math.hypot(dx, dy) > 4) {
      hasMovedRef.current = true
    }

    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect?.() ?? { width: 800, height: 600 }
    const scaleX = pan.initialViewBox.width / Math.max(rect.width, 1)
    const scaleY = pan.initialViewBox.height / Math.max(rect.height, 1)

    setViewBox({
      ...pan.initialViewBox,
      x: pan.initialViewBox.x - dx * scaleX,
      y: pan.initialViewBox.y - dy * scaleY,
    })
  }, [])

  const handlePointerUp = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    const pan = panStartRef.current
    if (pan && (e.pointerId === undefined || pan.pointerId === e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId)
      } catch {
        // Best effort release
      }
      panStartRef.current = null
      setIsPanning(false)
    }
  }, [])

  // 6. Keyboard Navigation (Read-Only: No Deletion Handlers)
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const panStep = viewBoxRef.current.width * 0.08
      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault()
          zoom(0.85)
          break
        case '-':
        case '_':
          e.preventDefault()
          zoom(1.15)
          break
        case '0':
        case 'f':
        case 'F':
          e.preventDefault()
          fitView()
          break
        case 'Escape':
          e.preventDefault()
          onSelectRack?.(null)
          break
        case 'ArrowLeft':
          e.preventDefault()
          setViewBox((v) => ({ ...v, x: v.x - panStep }))
          break
        case 'ArrowRight':
          e.preventDefault()
          setViewBox((v) => ({ ...v, x: v.x + panStep }))
          break
        case 'ArrowUp':
          e.preventDefault()
          setViewBox((v) => ({ ...v, y: v.y - panStep }))
          break
        case 'ArrowDown':
          e.preventDefault()
          setViewBox((v) => ({ ...v, y: v.y + panStep }))
          break
        // Note: Delete and Backspace are deliberately omitted to guarantee zero mutation.
      }
    },
    [zoom, fitView, onSelectRack],
  )

  // Selected Rack Callout Details
  const selectedRackEntry = useMemo(() => {
    return rackEntries.find((r) => r.id === selectedRackId)
  }, [rackEntries, selectedRackId])

  return (
    <div
      className={`relative flex flex-col bg-slate-900 border border-slate-700/60 rounded-xl overflow-hidden select-none outline-none ${className}`}
      style={{ width, height, minHeight: 400 }}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      role="application"
      aria-label="Interactive 2D Warehouse Canvas"
      data-pascal-2d-canvas="pure-svg"
    >
      {/* Top Header HUD Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-950/80 border-b border-slate-800 z-10 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold tracking-wide text-slate-200 uppercase font-mono">
            {siteName} · 2B Etkileşimli Plan
          </span>
          {selectedRackEntry && (
            <span className="ml-2 px-2 py-0.5 text-[11px] font-mono font-bold rounded bg-red-950/80 border border-red-700/60 text-red-300">
              Raf: {selectedRackEntry.node.rowLabel || 'İsimsiz'} (Göz {selectedRackEntry.node.bayIndex})
            </span>
          )}
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-700/80 rounded-lg p-1 shadow-sm">
          <button
            type="button"
            onClick={() => zoom(0.85)}
            title="Yakınlaştır (+)"
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            onClick={() => zoom(1.15)}
            title="Uzaklaştır (-)"
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
          >
            <Minus size={14} />
          </button>
          <div className="w-px h-4 bg-slate-700 my-auto mx-0.5" />
          <button
            type="button"
            onClick={fitView}
            title="Sığdır (F)"
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div className="relative flex-1 w-full h-full overflow-hidden">
        <svg
          ref={svgRef}
          className="w-full h-full"
          style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          preserveAspectRatio="xMidYMid meet"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={() => {
            if (!hasMovedRef.current) {
              onSelectRack?.(null)
            }
          }}
        >
          <defs>
            {/* Blueprint Architectural Grid */}
            <pattern id={gridPatternId} width="1" height="1" patternUnits="userSpaceOnUse">
              <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#334155" strokeWidth="0.02" strokeOpacity="0.3" />
            </pattern>

            {/* Selected Rack Glow Filter */}
            <filter id="dt-rack-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="0.15" floodColor="#DC2626" floodOpacity="0.8" />
            </filter>
          </defs>

          {/* Grid Background */}
          <rect
            data-testid="canvas-background"
            x={viewBox.x}
            y={viewBox.y}
            width={viewBox.width}
            height={viewBox.height}
            fill={`url(#${gridPatternId})`}
            onClick={(e) => {
              if (!hasMovedRef.current) {
                e.stopPropagation?.()
                onSelectRack?.(null)
              }
            }}
          />

          {/* Main Scene Group */}
          <g>
            {/* 1. Background Geometry (Slabs, Walls, Columns) */}
            <g className="interactive-2d-background-layer" pointerEvents="none">
              {backgroundEntries.map((entry) => (
                <g
                  key={entry.id}
                  data-node-id={entry.id}
                  data-node-type={entry.node.type}
                  onClick={(e) => {
                    e?.stopPropagation?.()
                  }}
                >
                  {entry.geometry && (
                    <FloorplanGeometryRenderer
                      geometry={entry.geometry}
                      pointerEventsOverride="none"
                    />
                  )}
                </g>
              ))}
            </g>

            {/* 2. Interactive Pallet Rack Layer */}
            <g className="interactive-2d-rack-layer">
              {rackEntries.map(({ id, node, geometry }) => {
                const isSelected = id === selectedRackId
                const posX = node.position?.[0] ?? 0
                const posZ = node.position?.[2] ?? 0

                return (
                  <g
                    key={id}
                    data-node-id={id}
                    data-node-type={node.type}
                    data-testid={`rack-${id}`}
                    data-selected={isSelected ? 'true' : 'false'}
                    className="cursor-pointer transition-opacity"
                    style={{ cursor: 'pointer' }}
                    pointerEvents="all"
                    filter={isSelected ? 'url(#dt-rack-glow)' : undefined}
                    onPointerDown={handlePointerDown}
                    onPointerEnter={() => onHoverRack?.(id)}
                    onPointerLeave={() => onHoverRack?.(null)}
                    onDoubleClick={(e) => {
                      e?.stopPropagation?.()
                    }}
                    onClick={(e) => {
                      if (!hasMovedRef.current) {
                        e?.stopPropagation?.()
                        onSelectRack?.(node)
                      }
                    }}
                  >
                    <FloorplanGeometryRenderer
                      geometry={geometry}
                      pointerEventsOverride="all"
                    />

                    {/* Selection Indicator Badge & Callout */}
                    {isSelected && (
                      <g className="rack-selected-callout" pointerEvents="none">
                        <circle
                          cx={posX}
                          cy={posZ}
                          r={0.25}
                          fill="#DC2626"
                          stroke="#FFFFFF"
                          strokeWidth={0.04}
                        />
                      </g>
                    )}
                  </g>
                )
              })}
            </g>
          </g>
        </svg>
      </div>

      {/* Footer Info HUD */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-950/90 border-t border-slate-800 text-[11px] text-slate-400 font-medium">
        <div className="flex items-center gap-4">
          <span>Toplam Raf: {rackEntries.length}</span>
          {selectedRackEntry && (
            <span className="text-red-400 font-semibold font-mono">
              Seçili: SIRA {selectedRackEntry.node.rowLabel || '?'} · GÖZ {selectedRackEntry.node.bayIndex} (ID: {selectedRackEntry.id})
            </span>
          )}
        </div>
        <span className="text-[10px] text-slate-500 font-mono">
          Saf 2B Vektör SVG · 0% WebGL / Canvas Yükü
        </span>
      </div>
    </div>
  )
}
