import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  getInspectorExtensions,
  getRegistryVersion,
  type InspectorExtension,
  loadPlugin,
  nodeRegistry,
  onRegistryChange,
  type Plugin,
  registerZoneTakeoffExtension,
  getZoneTakeoffExtensions,
} from '@pascal-app/core'
import {
  type InspectorCardMode,
  resolveActiveExtension,
  toggleCard,
  toggleExtension,
} from '../lib/inspector-card-mode'

describe('Tier 2 Plugin Inspector Extensions & Slot Contracts', () => {
  let restoreRegistry: () => void

  beforeEach(() => {
    restoreRegistry = nodeRegistry._snapshot()
  })

  afterEach(() => {
    restoreRegistry()
  })

  describe('Plugin InspectorExtension Registration & Version Notification', () => {
    test('registers inspector extensions across multiple node kinds and bumps registryVersion', async () => {
      const initialVersion = getRegistryVersion()
      const changeSpy = mock(() => undefined)
      const unsubscribe = onRegistryChange(changeSpy)

      const mockExtension: InspectorExtension = {
        id: 'test-plugin:rack-analytics',
        pluginId: 'test-warehouse-plugin',
        kinds: ['warehouse:pallet-rack', 'warehouse:cantilever'],
        title: 'Rack Structural Analysis',
        icon: { kind: 'iconify', name: 'lucide:activity' },
        component: () => Promise.resolve({ default: () => null }),
      }

      const mockPlugin: Plugin = {
        id: 'test-warehouse-plugin',
        apiVersion: 1,
        nodes: [],
        inspectorExtensions: [mockExtension],
      }

      await loadPlugin(mockPlugin)

      expect(getRegistryVersion()).toBeGreaterThan(initialVersion)
      expect(changeSpy).toHaveBeenCalled()

      // Inspect registered extensions per kind
      const palletRackExtensions = getInspectorExtensions('warehouse:pallet-rack')
      expect(palletRackExtensions.length).toBe(1)
      expect(palletRackExtensions[0].id).toBe('test-plugin:rack-analytics')
      expect(palletRackExtensions[0].title).toBe('Rack Structural Analysis')

      const cantileverExtensions = getInspectorExtensions('warehouse:cantilever')
      expect(cantileverExtensions.length).toBe(1)
      expect(cantileverExtensions[0].id).toBe('test-plugin:rack-analytics')

      // Unrelated kind returns empty array
      expect(getInspectorExtensions('wall')).toEqual([])

      unsubscribe()
    })

    test('replaces extension in place on HMR re-registration with identical ID', async () => {
      const extensionV1: InspectorExtension = {
        id: 'test-plugin:timber-takeoff',
        pluginId: 'plugin-bones',
        kinds: ['wall'],
        title: 'Timber Stud Takeoff V1',
        icon: { kind: 'iconify', name: 'lucide:calculator' },
        component: () => Promise.resolve({ default: () => null }),
      }

      const extensionV2: InspectorExtension = {
        id: 'test-plugin:timber-takeoff',
        pluginId: 'plugin-bones',
        kinds: ['wall'],
        title: 'Timber Stud Takeoff V2 (HMR)',
        icon: { kind: 'iconify', name: 'lucide:calculator' },
        component: () => Promise.resolve({ default: () => null }),
      }

      await loadPlugin({
        id: 'plugin-bones',
        apiVersion: 1,
        nodes: [],
        inspectorExtensions: [extensionV1],
      })

      expect(getInspectorExtensions('wall')[0].title).toBe('Timber Stud Takeoff V1')

      // Re-load with V2
      await loadPlugin({
        id: 'plugin-bones',
        apiVersion: 1,
        nodes: [],
        inspectorExtensions: [extensionV2],
      })

      const wallExtensions = getInspectorExtensions('wall')
      expect(wallExtensions.length).toBe(1)
      expect(wallExtensions[0].title).toBe('Timber Stud Takeoff V2 (HMR)')
    })

    test('registers zone takeoff extensions and allows retrieval', () => {
      const takeoffExt = {
        id: 'test:zone-pallet-count',
        title: 'Pallet Capacity Estimator',
        compute: () => ({ count: 42 }),
      }

      registerZoneTakeoffExtension(takeoffExt as any)
      const allTakeoffs = getZoneTakeoffExtensions()
      expect(allTakeoffs.some((t) => t.id === 'test:zone-pallet-count')).toBe(true)
    })
  })

  describe('Inspector Card Mode Machine & Transitions', () => {
    const collapsed: InspectorCardMode = { collapsed: true, activeExtensionId: null }
    const regular: InspectorCardMode = { collapsed: false, activeExtensionId: null }
    const warehouseExtMode: InspectorCardMode = {
      collapsed: false,
      activeExtensionId: 'warehouse:analytics',
    }

    test('toggleCard transitions correctly across collapsed, regular, and extension states', () => {
      // From collapsed to regular
      expect(toggleCard(collapsed)).toEqual(regular)

      // From regular to collapsed
      expect(toggleCard(regular)).toEqual(collapsed)

      // From extension mode, chevron exits to regular mode while staying expanded
      expect(toggleCard(warehouseExtMode)).toEqual(regular)
    })

    test('toggleExtension handles opening, switching, and toggling active extension off', () => {
      // Opening extension from collapsed
      expect(toggleExtension(collapsed, 'warehouse:analytics')).toEqual(warehouseExtMode)

      // Opening extension from regular
      expect(toggleExtension(regular, 'warehouse:analytics')).toEqual(warehouseExtMode)

      // Clicking active extension icon again returns to regular
      expect(toggleExtension(warehouseExtMode, 'warehouse:analytics')).toEqual(regular)

      // Switching directly to another extension
      expect(toggleExtension(warehouseExtMode, 'bones:engineering')).toEqual({
        collapsed: false,
        activeExtensionId: 'bones:engineering',
      })
    })

    test('resolveActiveExtension safely handles matching, non-matching, and null IDs', () => {
      const extensions = [
        { id: 'warehouse:analytics', title: 'Analytics' },
        { id: 'bones:engineering', title: 'Engineering' },
      ]

      expect(resolveActiveExtension(null, extensions)).toBeNull()
      expect(resolveActiveExtension('warehouse:analytics', extensions)).toEqual(extensions[0])
      expect(resolveActiveExtension('bones:engineering', extensions)).toEqual(extensions[1])

      // Stale or uninstalled extension ID safely returns null (falls back to regular mode)
      expect(resolveActiveExtension('uninstalled:extension', extensions)).toBeNull()
    })
  })
})
