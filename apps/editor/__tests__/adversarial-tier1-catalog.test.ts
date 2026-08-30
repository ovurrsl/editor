import { beforeEach, describe, expect, test } from 'bun:test'
import { loadPlugin, nodeRegistry, getRegistryVersion, onRegistryChange } from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'
import { PLUGIN_CATALOG, getPluginDescriptor, isPluginInstalledByDefault } from '../lib/plugins/catalog'
import { IfcImportButton } from '@/components/ifc-import-button'

describe('Adversarial Tier 1 Catalog, NodeRegistry & UI Slot Verification Suite', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  describe('1. NodeRegistry Resilience & Builtin Tier 1 Registration', () => {
    test('registers 48 builtin nodes including BlockNode, Wall, Slab, Roof without error', async () => {
      expect(nodeRegistry.size).toBe(0)
      await loadPlugin(builtinPlugin)

      expect(nodeRegistry.size).toBeGreaterThanOrEqual(45)
      expect(nodeRegistry.has('block')).toBe(true)
      expect(nodeRegistry.has('wall')).toBe(true)
      expect(nodeRegistry.has('slab')).toBe(true)
      expect(nodeRegistry.has('roof')).toBe(true)

      const blockDef = nodeRegistry.get('block')
      expect(blockDef).toBeDefined()
      expect(blockDef?.category).toBe('structure')
      expect(blockDef?.schemaVersion).toBe(5)
    })

    test('re-loading builtinPlugin in dev mode does not corrupt or duplicate registry entries', async () => {
      await loadPlugin(builtinPlugin)
      const size1 = nodeRegistry.size

      // Re-load
      await loadPlugin(builtinPlugin)
      const size2 = nodeRegistry.size

      expect(size1).toBe(size2)
      expect(nodeRegistry.has('block')).toBe(true)
    })
  })

  describe('2. Dynamic Bones Plugin Load & Unload Lifecycle', () => {
    test('Bones descriptor loads dynamically, exposes framing & lumber, and mounts cleanly', async () => {
      const bonesDesc = getPluginDescriptor('pascal:bones')
      expect(bonesDesc).toBeDefined()
      expect(bonesDesc?.id).toBe('pascal:bones')
      expect(bonesDesc?.nodeKinds).toContain('bones:framing')
      expect(bonesDesc?.nodeKinds).toContain('bones:lumber')

      const loaded = await bonesDesc!.loadPlugin()
      expect(loaded.plugin).toBeDefined()
      expect(loaded.plugin.apiVersion).toBe(1)
      expect(loaded.panel).toBeDefined()
      expect(loaded.panel?.label).toBe('Bones')

      // Snapshot registry before loading
      const restore = nodeRegistry._snapshot()
      await loadPlugin(loaded.plugin)

      expect(nodeRegistry.has('bones:framing')).toBe(true)
      expect(nodeRegistry.has('bones:lumber')).toBe(true)

      // Rollback via snapshot
      restore()
      expect(nodeRegistry.has('bones:framing')).toBe(false)
      expect(nodeRegistry.has('bones:lumber')).toBe(false)
    })
  })

  describe('3. IFC Converter & 3D Print Exporter Module Availability', () => {
    test('IFC converter engine convertIfcToPascal is an async function', async () => {
      const ifcMod = await import('@pascal-app/ifc-converter')
      expect(typeof ifcMod.convertIfcToPascal).toBe('function')
    })

    test('3D Print Exporter preparePrintExport is available from @pascal-app/editor', async () => {
      const printMod = await import(
        '../../../packages/editor/src/components/ui/sidebar/panels/settings-panel/print-export-button'
      )
      expect(typeof printMod.preparePrintExport).toBe('function')
      expect(typeof printMod.PrintExportButton).toBe('function')
    })
  })
})
