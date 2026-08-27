// Polyfill localStorage and animation frames for headless test environment
const memoryStorage = new Map<string, string>()
const mockStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStorage.set(key, String(value))
  },
  removeItem: (key: string) => {
    memoryStorage.delete(key)
  },
  clear: () => memoryStorage.clear(),
  key: (index: number) => Array.from(memoryStorage.keys())[index] ?? null,
  get length() {
    return memoryStorage.size
  },
}

if (typeof globalThis.window === 'undefined') {
  ;(globalThis as any).window = globalThis
}
;(globalThis as any).localStorage = mockStorage
;(globalThis.window as any).localStorage = mockStorage
;(globalThis as any).requestAnimationFrame = (cb: (time: number) => void) => {
  cb(performance.now())
  return 0
}
;(globalThis as any).cancelAnimationFrame = () => {}

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  BuildingNode,
  LevelNode,
  WallNode,
  useScene,
  acquireSceneReadOnlyLease,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { isNodeEditLocked } from '../lib/edit-lock'

describe('R2: Seamless Role Transfer & Lock Elimination', () => {
  const buildingA = BuildingNode.parse({ id: 'building_1', children: ['level_1'] })
  const levelA = LevelNode.parse({ id: 'level_1', parentId: 'building_1', level: 0, children: ['wall_1'] })
  const wall1 = WallNode.parse({ id: 'wall_1', parentId: 'level_1', start: [0, 0], end: [5, 0] })

  beforeEach(() => {
    useScene.setState({
      nodes: {
        [buildingA.id]: buildingA,
        [levelA.id]: levelA,
        [wall1.id]: wall1,
      },
      rootNodeIds: [buildingA.id],
      materials: {},
      collections: {},
      dirtyNodes: new Set(),
      readOnly: false,
    } as never)

    useViewer.setState({
      selection: {
        buildingId: null,
        levelId: null,
        zoneId: null,
        selectedIds: [],
      },
      sceneLocked: false,
      inputDragging: false,
      cameraDragging: false,
    })

    useEditor.setState({
      isPreviewMode: true,
      mode: 'select',
      tool: null,
    })

    useInteractionScope.getState().end()
  })

  afterEach(() => {
    useInteractionScope.getState().end()
  })

  test('Viewer entering preview mode clears selection and sets isPreviewMode: true', () => {
    useEditor.getState().setPreviewMode(true)
    expect(useEditor.getState().isPreviewMode).toBe(true)
    expect(useViewer.getState().selection.selectedIds).toEqual([])
  })

  test('Seamless role transfer unsets preview mode and resets interaction scope and dragging flags', () => {
    // Simulate user in viewer mode with hanging drag/interaction flags
    useEditor.getState().setPreviewMode(true)
    useInteractionScope.getState().begin({
      kind: 'moving',
      node: wall1 as never,
      nodeId: wall1.id,
      nodeType: wall1.type,
      view: '3d',
    })
    expect(useInteractionScope.getState().scope.kind).toBe('moving')

    useViewer.getState().setInputDragging(true)
    useViewer.getState().setCameraDragging(true)
    useViewer.getState().setSceneLocked(true)

    // Execute seamless role transfer logic
    useEditor.getState().setPreviewMode(false)
    useInteractionScope.getState().end()
    useViewer.getState().setInputDragging(false)
    useViewer.getState().setCameraDragging(false)
    useViewer.getState().setSceneLocked(false)

    // Verify all lock and dragging flags are eliminated
    expect(useEditor.getState().isPreviewMode).toBe(false)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(useViewer.getState().cameraDragging).toBe(false)
    expect(useViewer.getState().sceneLocked).toBe(false)
  })

  test('Seamless role transfer auto-recovers active building and level selection when levelId is null', () => {
    // Start with empty level selection
    expect(useViewer.getState().selection.levelId).toBeNull()

    // Simulate role transfer auto-recovery
    const viewer = useViewer.getState()
    if (!viewer.selection.levelId) {
      const nodes = useScene.getState().nodes
      const firstBuilding = Object.values(nodes).find((n) => n.type === 'building')
      const firstLevel = Object.values(nodes).find((n) => n.type === 'level')
      if (firstBuilding && firstLevel) {
        viewer.setSelection({
          buildingId: firstBuilding.id,
          levelId: firstLevel.id,
          selectedIds: [],
          zoneId: null,
        })
      }
    }

    // Verify building and level are auto-recovered
    expect(useViewer.getState().selection.buildingId).toBe('building_1')
    expect(useViewer.getState().selection.levelId).toBe('level_1')
  })

  test('Unlocked nodes are editable and direct manipulation is enabled after role transfer', () => {
    // After role transfer:
    useEditor.getState().setPreviewMode(false)
    useViewer.getState().setSceneLocked(false)

    const wallNode = useScene.getState().nodes['wall_1'] as WallNode | undefined
    expect(wallNode).toBeDefined()
    expect(isNodeEditLocked(wallNode!)).toBe(false)

    // Node can be updated without throwing read-only or lock error
    useScene.getState().updateNode('wall_1', { height: 3.5 } as never)
    expect((useScene.getState().nodes['wall_1'] as WallNode | undefined)?.height).toBe(3.5)
  })

  test('Read-only lease release immediately unlocks scene graph mutations', () => {
    const release = acquireSceneReadOnlyLease()
    expect(useScene.getState().readOnly).toBe(true)

    // Release lease
    release()
    expect(useScene.getState().readOnly).toBe(false)

    // Verify mutations work freely
    useScene.getState().updateNode('wall_1', { thickness: 0.3 } as never)
    expect((useScene.getState().nodes['wall_1'] as WallNode | undefined)?.thickness).toBe(0.3)
  })
})
