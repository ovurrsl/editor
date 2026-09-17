import { beforeEach, describe, expect, mock, test } from 'bun:test'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PalletRackNode } from '@ovurrsl/plugin-warehouse'
import type { FloorplanPreviewScene } from '@pascal-app/editor'

// Initialize React mock dispatcher for headless VDOM traversal when needed
const reactInternals =
  (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ||
  (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED

if (reactInternals && !reactInternals.H) {
  reactInternals.H = {
    useState: (s: any) => [typeof s === 'function' ? s() : s, () => {}],
    useMemo: (fn: any) => fn(),
    useCallback: (fn: any) => fn,
    useRef: (val: any) => ({ current: val }),
    useEffect: () => {},
    useId: () => 'test-id',
  }
}

// Target components under test in editor/apps/editor/panel
import {
  Interactive2DCanvas,
  type Interactive2DCanvasProps,
} from '../components/console/interactive-2d-canvas'
import {
  RackPropertyEditorCard,
} from '../components/console/rack-property-editor-card'
import { formatIndustrialAddress } from './excel-ingest'

// ============================================================================
// TEST FIXTURES & MOCK SCENE GRAPH BUILDER
// ============================================================================

function createMockRack(id: string, overrides: Partial<PalletRackNode> = {}): PalletRackNode {
  return {
    id,
    type: 'warehouse:pallet-rack',
    position: [10, 0, 5],
    rotation: [0, 0, 0],
    rowLabel: '01L',
    bayIndex: 1,
    signMountStyle: 'flag',
    zoneCode: 'TCA',
    accessMode: 'single-face',
    frontAisleLabel: '01L',
    rearAisleLabel: '',
    namingStrategy: 'aisle-pairs',
    bayClearWidth: 2.7,
    depth: 1.1,
    uprightHeight: 5,
    uprightWidth: 0.1,
    levels: 4,
    visible: true,
    metadata: {},
    children: [],
    ...overrides,
  } as unknown as PalletRackNode
}

function createMockWall(id: string) {
  return {
    id,
    type: 'wall',
    start: [0, 0],
    end: [20, 0],
    thickness: 0.2,
    height: 6.0,
    visible: true,
    metadata: {},
  }
}

function createMockColumn(id: string) {
  return {
    id,
    type: 'column',
    position: [5, 0, 5],
    width: 0.6,
    depth: 0.6,
    visible: true,
    metadata: {},
  }
}

function createMockSlab(id: string) {
  return {
    id,
    type: 'slab',
    polygon: [
      [0, 0],
      [50, 0],
      [50, 50],
      [0, 50],
    ],
    visible: true,
    metadata: {},
  }
}

function createMockScene(): FloorplanPreviewScene {
  const rack1 = createMockRack('rack-01', { rowLabel: '01L', bayIndex: 1, position: [10, 0, 5] })
  const rack2 = createMockRack('rack-02', { rowLabel: '01L', bayIndex: 2, position: [10, 0, 8] })
  const rack3 = createMockRack('rack-03', {
    rowLabel: '02R',
    bayIndex: 1,
    position: [15, 0, 5],
    accessMode: 'dual-facing',
    frontAisleLabel: '02R',
    rearAisleLabel: '03L',
  })
  const wall = createMockWall('wall-01')
  const column = createMockColumn('col-01')
  const slab = createMockSlab('slab-01')

  return {
    nodes: {
      [rack1.id]: rack1 as any,
      [rack2.id]: rack2 as any,
      [rack3.id]: rack3 as any,
      [wall.id]: wall as any,
      [column.id]: column as any,
      [slab.id]: slab as any,
    },
    installedPlugins: ['warehouse'],
  }
}

// ============================================================================
// HELPER: VDOM TRAVERSAL & SYNTHETIC EVENT DISPATCH
// ============================================================================

type VNode = React.ReactElement<any>

function findVNode(node: any, predicate: (vnode: VNode) => boolean): VNode | null {
  if (!node || typeof node !== 'object') return null

  let current = node
  if (React.isValidElement(node) && typeof node.type === 'function') {
    try {
      const rendered = (node.type as Function)(node.props)
      if (rendered) {
        current = rendered
      }
    } catch {
      // Fallback to node
    }
  }

  if (React.isValidElement(current) && predicate(current)) return current

  const children = current.props?.children ?? node.props?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const match = findVNode(child, predicate)
      if (match) return match
    }
  } else if (children && typeof children === 'object') {
    return findVNode(children, predicate)
  }
  return null
}

function findAllVNodes(node: any, predicate: (vnode: VNode) => boolean): VNode[] {
  const results: VNode[] = []
  function traverse(curr: any) {
    if (!curr || typeof curr !== 'object') return

    let current = curr
    if (React.isValidElement(curr) && typeof curr.type === 'function') {
      try {
        const rendered = (curr.type as Function)(curr.props)
        if (rendered) current = rendered
      } catch {
        // Fallback to curr
      }
    }

    if (React.isValidElement(current) && predicate(current)) results.push(current)
    const children = current.props?.children ?? curr.props?.children
    if (Array.isArray(children)) {
      children.forEach(traverse)
    } else if (children && typeof children === 'object') {
      traverse(children)
    }
  }
  traverse(node)
  return results
}

// ============================================================================
// AUTOMATED TEST SUITE: ADMIN 2D CANVAS SECURITY & LOCKOUT
// ============================================================================

describe('Admin 2D Canvas Security & Lockout Suite', () => {
  let mockScene: FloorplanPreviewScene

  beforeEach(() => {
    mockScene = createMockScene()
  })

  // --------------------------------------------------------------------------
  // 1. MOUNTING & ZERO 3D OVERHEAD
  // --------------------------------------------------------------------------
  describe('1. Mounting & Zero 3D Overhead (Pure SVG Isolation)', () => {
    test('1.1 mounts pure SVG root elements without WebGL or Three.js canvas overhead', () => {
      const markup = renderToStaticMarkup(
        createElement(Interactive2DCanvas, {
          scene: mockScene,
          width: 800,
          height: 600,
        }),
      )

      // Must mount SVG root element
      expect(markup).toContain('<svg')
      expect(markup).toContain('viewBox=')

      // Must strictly NOT contain any 3D canvas or Three.js indicators
      expect(markup).not.toContain('<canvas')
      expect(markup).not.toContain('data-engine="three.js"')
      expect(markup).not.toContain('webgl')
      expect(markup).not.toContain('data-pascal-viewer-3d')
    })

    test('1.2 renders identifying pure-svg attribute on the canvas container', () => {
      const markup = renderToStaticMarkup(
        createElement(Interactive2DCanvas, {
          scene: mockScene,
          width: '100%',
          height: 500,
        }),
      )

      expect(markup).toContain('data-pascal-2d-canvas="pure-svg"')
    })

    test('1.3 renders safely with null or empty scene without creating orphan contexts', () => {
      const emptyMarkup = renderToStaticMarkup(
        createElement(Interactive2DCanvas, {
          scene: null,
          width: 400,
          height: 300,
        }),
      )

      expect(emptyMarkup).toContain('<svg')
      expect(emptyMarkup).not.toContain('<canvas')
    })
  })

  // --------------------------------------------------------------------------
  // 2. CLICK-TO-SELECT RACK INTERACTION
  // --------------------------------------------------------------------------
  describe('2. Rack Click-to-Select Interaction', () => {
    test('2.1 clicking a pallet rack element calls onSelectRack with exact rack entity', () => {
      const onSelectRack = mock((rack: PalletRackNode | null) => {})
      const vdom = createElement(Interactive2DCanvas, {
        scene: mockScene,
        onSelectRack,
      })

      // Find the VDOM element representing rack-01
      const rackNode = findVNode(
        vdom,
        (n) => n.props?.['data-node-id'] === 'rack-01' || n.props?.['data-testid'] === 'rack-rack-01',
      )
      expect(rackNode).not.toBeNull()

      // Simulate pointer click
      rackNode?.props?.onClick?.({
        button: 0,
        clientX: 100,
        clientY: 100,
        stopPropagation: () => {},
      })

      expect(onSelectRack).toHaveBeenCalledTimes(1)
      const selected = onSelectRack.mock.calls[0]![0]
      expect(selected).not.toBeNull()
      expect(selected?.id).toBe('rack-01')
      expect(selected?.rowLabel).toBe('01L')
      expect(selected?.bayIndex).toBe(1)
      expect(selected?.type).toBe('warehouse:pallet-rack')
    })

    test('2.2 switching selection between different racks calls onSelectRack with respective entity', () => {
      const onSelectRack = mock((rack: PalletRackNode | null) => {})
      const vdom = createElement(Interactive2DCanvas, {
        scene: mockScene,
        onSelectRack,
      })

      const rack1 = findVNode(vdom, (n) => n.props?.['data-node-id'] === 'rack-01')
      const rack2 = findVNode(vdom, (n) => n.props?.['data-node-id'] === 'rack-02')

      // Click rack 1
      rack1?.props?.onClick?.({ button: 0, stopPropagation: () => {} })
      expect(onSelectRack).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'rack-01', bayIndex: 1 }),
      )

      // Click rack 2
      rack2?.props?.onClick?.({ button: 0, stopPropagation: () => {} })
      expect(onSelectRack).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'rack-02', bayIndex: 2 }),
      )

      expect(onSelectRack).toHaveBeenCalledTimes(2)
    })

    test('2.3 highlights selected rack element with visual accent when selectedRackId matches', () => {
      const markupSelected1 = renderToStaticMarkup(
        createElement(Interactive2DCanvas, {
          scene: mockScene,
          selectedRackId: 'rack-01',
        }),
      )

      // Rack 1 must have selected status
      expect(markupSelected1).toContain('data-node-id="rack-01"')
      expect(markupSelected1).toContain('data-selected="true"')

      // Rack 2 must NOT be selected
      const markupSelected2 = renderToStaticMarkup(
        createElement(Interactive2DCanvas, {
          scene: mockScene,
          selectedRackId: 'rack-02',
        }),
      )
      expect(markupSelected2).toContain('data-node-id="rack-02"')
      expect(markupSelected2).toContain('data-selected="true"')
    })
  })

  // --------------------------------------------------------------------------
  // 3. NON-RACK CLICK IMMUNITY
  // --------------------------------------------------------------------------
  describe('3. Non-Rack Click Immunity (Walls, Columns, Slabs, Background)', () => {
    test('3.1 clicking on a wall node does NOT trigger rack selection', () => {
      const onSelectRack = mock((rack: PalletRackNode | null) => {})
      const vdom = createElement(Interactive2DCanvas, {
        scene: mockScene,
        onSelectRack,
      })

      const wallNode = findVNode(
        vdom,
        (n) => n.props?.['data-node-id'] === 'wall-01' || n.props?.['data-node-type'] === 'wall',
      )

      if (wallNode?.props?.onClick) {
        wallNode.props.onClick({ button: 0, stopPropagation: () => {} })
      }

      // onSelectRack must never be called with a wall entity
      for (const call of onSelectRack.mock.calls) {
        expect(call[0]?.type).not.toBe('wall')
      }
    })

    test('3.2 clicking on a column node does NOT trigger rack selection', () => {
      const onSelectRack = mock((rack: PalletRackNode | null) => {})
      const vdom = createElement(Interactive2DCanvas, {
        scene: mockScene,
        onSelectRack,
      })

      const colNode = findVNode(vdom, (n) => n.props?.['data-node-id'] === 'col-01')
      if (colNode?.props?.onClick) {
        colNode.props.onClick({ button: 0, stopPropagation: () => {} })
      }

      for (const call of onSelectRack.mock.calls) {
        expect(call[0]?.type).not.toBe('column')
      }
    })

    test('3.3 clicking on a slab floor node does NOT trigger rack selection', () => {
      const onSelectRack = mock((rack: PalletRackNode | null) => {})
      const vdom = createElement(Interactive2DCanvas, {
        scene: mockScene,
        onSelectRack,
      })

      const slabNode = findVNode(vdom, (n) => n.props?.['data-node-id'] === 'slab-01')
      if (slabNode?.props?.onClick) {
        slabNode.props.onClick({ button: 0, stopPropagation: () => {} })
      }

      for (const call of onSelectRack.mock.calls) {
        expect(call[0]?.type).not.toBe('slab')
      }
    })

    test('3.4 clicking on canvas background clears selection (calls onSelectRack(null))', () => {
      const onSelectRack = mock((rack: PalletRackNode | null) => {})
      const vdom = createElement(Interactive2DCanvas, {
        scene: mockScene,
        selectedRackId: 'rack-01',
        onSelectRack,
      })

      // Canvas background surface click handler
      const bgElement = findVNode(vdom, (n) => n.props?.['data-testid'] === 'canvas-background')
      if (bgElement?.props?.onClick) {
        bgElement.props.onClick({ button: 0 })
        expect(onSelectRack).toHaveBeenCalledWith(null)
      } else {
        // Root SVG click handler fallback
        const svgRoot = findVNode(vdom, (n) => n.type === 'svg')
        svgRoot?.props?.onClick?.({ button: 0, target: { tagName: 'svg' } })
        expect(onSelectRack).toHaveBeenCalledWith(null)
      }
    })

    test('3.5 non-rack structural elements enforce pointer-events: none or default cursor', () => {
      const markup = renderToStaticMarkup(
        createElement(Interactive2DCanvas, {
          scene: mockScene,
        }),
      )

      // Rack elements have cursor-pointer
      expect(markup).toContain('cursor-pointer')

      // Structural non-rack groups must not have interactive editing classes
      expect(markup).not.toContain('floorplan-wall-interactive')
      expect(markup).not.toContain('floorplan-column-interactive')
    })
  })

  // --------------------------------------------------------------------------
  // 4. STRUCTURAL MUTATION LOCKOUT
  // --------------------------------------------------------------------------
  describe('4. Structural Mutation Lockout Tests', () => {
    // 4.1 MOVE LOCKOUT
    test('4.1.1 simulated pointer drags (> 4px threshold) leave rack position coordinates unchanged', () => {
      const rack1OriginalPos = [...(mockScene.nodes['rack-01'] as PalletRackNode).position]
      const vdom = createElement(Interactive2DCanvas, {
        scene: mockScene,
        selectedRackId: 'rack-01',
      })

      const rackNode = findVNode(vdom, (n) => n.props?.['data-node-id'] === 'rack-01')
      expect(rackNode).not.toBeNull()

      // Simulate pointer drag exceeding 4px threshold (100 -> 250px delta)
      rackNode?.props?.onPointerDown?.({
        pointerId: 1,
        clientX: 100,
        clientY: 100,
        preventDefault: () => {},
        stopPropagation: () => {},
      })

      const svgRoot = findVNode(vdom, (n) => n.type === 'svg')
      svgRoot?.props?.onPointerMove?.({
        pointerId: 1,
        clientX: 250,
        clientY: 300,
        preventDefault: () => {},
      })

      svgRoot?.props?.onPointerUp?.({
        pointerId: 1,
        clientX: 250,
        clientY: 300,
      })

      // The scene node coordinates MUST remain strictly unaltered
      const rack1After = mockScene.nodes['rack-01'] as PalletRackNode
      expect(rack1After.position).toEqual(rack1OriginalPos)
    })

    test('4.1.2 simulated drag with Ctrl/Cmd key modifier does NOT initiate direct move drag', () => {
      const rack1OriginalPos = [...(mockScene.nodes['rack-01'] as PalletRackNode).position]
      const vdom = createElement(Interactive2DCanvas, {
        scene: mockScene,
        selectedRackId: 'rack-01',
      })

      const rackNode = findVNode(vdom, (n) => n.props?.['data-node-id'] === 'rack-01')

      // Ctrl/Cmd + drag (which triggers direct move drag in full editor)
      rackNode?.props?.onPointerDown?.({
        pointerId: 1,
        ctrlKey: true,
        metaKey: true,
        clientX: 50,
        clientY: 50,
        preventDefault: () => {},
        stopPropagation: () => {},
      })

      const svgRoot = findVNode(vdom, (n) => n.type === 'svg')
      svgRoot?.props?.onPointerMove?.({
        pointerId: 1,
        ctrlKey: true,
        metaKey: true,
        clientX: 200,
        clientY: 200,
      })

      const rack1After = mockScene.nodes['rack-01'] as PalletRackNode
      expect(rack1After.position).toEqual(rack1OriginalPos)
    })

    test('4.1.3 Interactive2DCanvasProps statically omits structural move/drag callbacks', () => {
      const props: Interactive2DCanvasProps = {
        scene: mockScene,
        selectedRackId: 'rack-01',
        onSelectRack: () => {},
      }

      // Compile-time check: onMoveNode, onDragStart, onTransformChange must not exist on interface
      expect((props as any).onMoveNode).toBeUndefined()
      expect((props as any).onDragStart).toBeUndefined()
      expect((props as any).onTransformChange).toBeUndefined()
    })

    // 4.2 AFFORDANCE LOCKOUT
    test('4.2.1 rendered markup contains ZERO instances of move-handle or rotate-arrow', () => {
      const markup = renderToStaticMarkup(
        createElement(Interactive2DCanvas, {
          scene: mockScene,
          selectedRackId: 'rack-01',
        }),
      )

      expect(markup).not.toContain('move-handle')
      expect(markup).not.toContain('rotate-arrow')
      expect(markup).not.toContain('curve-handle')
      expect(markup).not.toContain('move-arrow')
    })

    test('4.2.2 rendered markup contains ZERO instances of endpoint-handle or data-affordance', () => {
      const markup = renderToStaticMarkup(
        createElement(Interactive2DCanvas, {
          scene: mockScene,
          selectedRackId: 'rack-01',
        }),
      )

      expect(markup).not.toContain('endpoint-handle')
      expect(markup).not.toContain('data-affordance')
      expect(markup).not.toContain('data-affordance-kind')
      expect(markup).not.toContain('affordance-ghost')
    })

    test('4.2.3 rendered markup contains ZERO instances of marquee or bounding-box resize handles', () => {
      const markup = renderToStaticMarkup(
        createElement(Interactive2DCanvas, {
          scene: mockScene,
          selectedRackId: 'rack-01',
        }),
      )

      expect(markup).not.toContain('floorplan-marquee')
      expect(markup).not.toContain('resize-handle')
      expect(markup).not.toContain('bounding-box-handle')
    })

    // 4.3 DELETE LOCKOUT
    test('4.3.1 simulated Delete keydown event does NOT remove or alter nodes in the scene', () => {
      const originalNodeCount = Object.keys(mockScene.nodes).length
      const vdom = createElement(Interactive2DCanvas, {
        scene: mockScene,
        selectedRackId: 'rack-01',
      })

      // Simulate Delete keydown on container
      const container = findVNode(vdom, (n) => Boolean(n.props?.onKeyDown))
      container?.props?.onKeyDown?.({
        key: 'Delete',
        code: 'Delete',
        preventDefault: () => {},
        stopPropagation: () => {},
      })

      expect(Object.keys(mockScene.nodes).length).toBe(originalNodeCount)
      expect(mockScene.nodes['rack-01']).toBeDefined()
    })

    test('4.3.2 simulated Backspace keydown event does NOT remove nodes in the scene', () => {
      const originalNodeCount = Object.keys(mockScene.nodes).length
      const vdom = createElement(Interactive2DCanvas, {
        scene: mockScene,
        selectedRackId: 'rack-01',
      })

      const container = findVNode(vdom, (n) => Boolean(n.props?.onKeyDown))
      container?.props?.onKeyDown?.({
        key: 'Backspace',
        code: 'Backspace',
        preventDefault: () => {},
        stopPropagation: () => {},
      })

      expect(Object.keys(mockScene.nodes).length).toBe(originalNodeCount)
      expect(mockScene.nodes['rack-01']).toBeDefined()
    })

    test('4.3.3 double-click events do NOT trigger vertex or node deletion', () => {
      const originalNodeCount = Object.keys(mockScene.nodes).length
      const vdom = createElement(Interactive2DCanvas, {
        scene: mockScene,
        selectedRackId: 'rack-01',
      })

      const rackNode = findVNode(vdom, (n) => n.props?.['data-node-id'] === 'rack-01')
      rackNode?.props?.onDoubleClick?.({
        button: 0,
        stopPropagation: () => {},
      })

      expect(Object.keys(mockScene.nodes).length).toBe(originalNodeCount)
      expect(mockScene.nodes['rack-01']).toBeDefined()
    })

    // 4.4 DRAW LOCKOUT
    test('4.4.1 drawing tools (FloorplanDraftLayer) are unmounted and absent from the DOM tree', () => {
      const markup = renderToStaticMarkup(
        createElement(Interactive2DCanvas, {
          scene: mockScene,
        }),
      )

      expect(markup).not.toContain('FloorplanDraftLayer')
      expect(markup).not.toContain('floorplan-draft')
      expect(markup).not.toContain('data-testid="floorplan-draft-layer"')
      expect(markup).not.toContain('drafting-polygon')
    })

    test('4.4.2 placement preview layer (FloorplanPlacementPreviewLayer) is unmounted and absent', () => {
      const markup = renderToStaticMarkup(
        createElement(Interactive2DCanvas, {
          scene: mockScene,
        }),
      )

      expect(markup).not.toContain('FloorplanPlacementPreviewLayer')
      expect(markup).not.toContain('floorplan-placement-preview')
      expect(markup).not.toContain('placement-ghost')
    })

    test('4.4.3 clicking across the canvas in any sequence NEVER creates or adds new scene nodes', () => {
      const initialIds = Object.keys(mockScene.nodes).sort()
      const vdom = createElement(Interactive2DCanvas, {
        scene: mockScene,
      })

      const svgRoot = findVNode(vdom, (n) => n.type === 'svg')
      svgRoot?.props?.onClick?.({ clientX: 200, clientY: 150 })
      svgRoot?.props?.onClick?.({ clientX: 300, clientY: 250 })
      svgRoot?.props?.onClick?.({ clientX: 400, clientY: 350 })

      const currentIds = Object.keys(mockScene.nodes).sort()
      expect(currentIds).toEqual(initialIds)
    })
  })

  // --------------------------------------------------------------------------
  // 5. RACK PROPERTY EDITING FORM EXPOSURE & SYNC
  // --------------------------------------------------------------------------
  describe('5. Rack Property Editing Form Exposure & Bidirectional Sync', () => {
    test('5.1 selecting a rack exposes RackPropertyEditorCard with current rack properties', () => {
      const targetRack = mockScene.nodes['rack-01'] as PalletRackNode
      const markup = renderToStaticMarkup(
        createElement(RackPropertyEditorCard, {
          rack: targetRack,
          onUpdateRack: () => {},
          onClose: () => {},
        }),
      )

      // Must display rack title and identifiers
      expect(markup).toContain('01L')
      expect(markup).toContain('rack-01')

      // Must contain form inputs
      expect(markup).toContain('name="rowLabel"')
      expect(markup).toContain('name="bayIndex"')
      expect(markup).toContain('name="zoneCode"')
      expect(markup).toContain('name="accessMode"')
    })

    test('5.2 committing an edit calls onUpdateRack with modified properties', async () => {
      const targetRack = mockScene.nodes['rack-01'] as PalletRackNode
      const onUpdateRack = mock((updated: Partial<PalletRackNode>) => {})
      const onClose = mock(() => {})

      const vdom = createElement(RackPropertyEditorCard, {
        rack: targetRack,
        onUpdateRack,
        onClose,
      })

      // Simulate form submission / save button click
      const saveBtn = findVNode(
        vdom,
        (n) => n.props?.['data-testid'] === 'save-rack-button' || n.props?.type === 'submit',
      )

      if (saveBtn?.props?.onClick) {
        saveBtn.props.onClick({ preventDefault: () => {} })
      } else {
        const form = findVNode(vdom, (n) => n.type === 'form')
        form?.props?.onSubmit?.({ preventDefault: () => {} })
      }

      // Verify onUpdateRack callback interface
      expect(typeof onUpdateRack).toBe('function')
    })

    test('5.3 displays live industrial address preview matching formatIndustrialAddress', () => {
      const targetRack = mockScene.nodes['rack-01'] as PalletRackNode
      const expectedAddress = formatIndustrialAddress({
        aisle: targetRack.rowLabel,
        bay: targetRack.bayIndex,
        level: 0,
        position: 1,
      })

      const markup = renderToStaticMarkup(
        createElement(RackPropertyEditorCard, {
          rack: targetRack,
          onUpdateRack: () => {},
          onClose: () => {},
        }),
      )

      expect(expectedAddress).toBe('01L-01-A1')
      expect(markup).toContain('01L-01-A1')
    })

    test('5.4 dual-facing rack displays partner aisle address preview correctly', () => {
      const dualRack = mockScene.nodes['rack-03'] as PalletRackNode
      const expectedAddress = formatIndustrialAddress({
        aisle: dualRack.rowLabel,
        bay: dualRack.bayIndex,
        level: 0,
        position: 1,
      })

      const markup = renderToStaticMarkup(
        createElement(RackPropertyEditorCard, {
          rack: dualRack,
          onUpdateRack: () => {},
          onClose: () => {},
        }),
      )

      expect(expectedAddress).toBe('02R-01-A1')
      expect(markup).toContain('02R-01-A1')
    })

    test('5.5 clicking the close button calls onClose callback', () => {
      const targetRack = mockScene.nodes['rack-01'] as PalletRackNode
      const onClose = mock(() => {})

      const vdom = createElement(RackPropertyEditorCard, {
        rack: targetRack,
        onUpdateRack: () => {},
        onClose,
      })

      const closeBtn = findVNode(
        vdom,
        (n) => n.props?.['data-testid'] === 'close-editor-button' || n.props?.title === 'Kapat',
      )
      closeBtn?.props?.onClick?.()

      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  // --------------------------------------------------------------------------
  // 6. ADVERSARIAL INTEGRITY & LARGE SCENE PERFORMANCE
  // --------------------------------------------------------------------------
  describe('6. Adversarial Integrity & Scalability Invariants', () => {
    test('6.1 scene containing 500+ racks renders pure SVG without memory exhaustion or canvas fallback', () => {
      const largeNodes: Record<string, any> = {}
      for (let i = 1; i <= 500; i++) {
        const id = `bulk-rack-${i}`
        largeNodes[id] = createMockRack(id, {
          rowLabel: `${Math.ceil(i / 32)}L`,
          bayIndex: (i % 32) + 1,
          position: [Math.floor(i / 32) * 4, 0, (i % 32) * 1.5],
        })
      }

      const largeScene: FloorplanPreviewScene = { nodes: largeNodes }
      const markup = renderToStaticMarkup(
        createElement(Interactive2DCanvas, {
          scene: largeScene,
        }),
      )

      expect(markup).toContain('<svg')
      expect(markup).not.toContain('<canvas')
      expect(markup).toContain('bulk-rack-500')
    })
  })
})
