import { beforeEach, describe, expect, test } from 'bun:test'
import { loadPlugin, nodeRegistry } from '@pascal-app/core'
import { builtinPlugin } from '@pascal-app/nodes'
import { PLUGIN_CATALOG, getPluginDescriptor } from './plugins/catalog'
import { IfcImportButton } from '@/components/ifc-import-button'

describe('Tier 1 Upstream Features — Editor App Integration Suite', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  describe('1. Builtin Nodes & BlockNode Integration', () => {
    test('builtinPlugin bundles blockDefinition with kind "block"', async () => {
      expect(builtinPlugin.id).toBe('pascal:core')
      await loadPlugin(builtinPlugin)

      expect(nodeRegistry.has('block')).toBe(true)
      const blockDef = nodeRegistry.get('block')
      expect(blockDef).toBeDefined()
      expect(blockDef?.kind).toBe('block')
      expect(blockDef?.category).toBe('structure')
      expect(blockDef?.presentation?.label).toBe('Block')
    })
  })

  describe('2. LGS Steel Framing Engine (plugin-bones) Integration', () => {
    test('PLUGIN_CATALOG includes "pascal:bones" descriptor with framing & lumber nodeKinds', () => {
      const bonesDesc = getPluginDescriptor('pascal:bones')
      expect(bonesDesc).toBeDefined()
      expect(bonesDesc?.id).toBe('pascal:bones')
      expect(bonesDesc?.category).toBe('engineering')
      expect(bonesDesc?.nodeKinds).toContain('bones:framing')
      expect(bonesDesc?.nodeKinds).toContain('bones:lumber')
    })

    test('dynamically loads Bones plugin and mounts nodes in nodeRegistry', async () => {
      const bonesDesc = getPluginDescriptor('pascal:bones')!
      const loaded = await bonesDesc.loadPlugin()

      expect(loaded.plugin).toBeDefined()
      expect(loaded.plugin.id).toBe('pascal:bones')
      expect(loaded.panel).toBeDefined()
      expect(loaded.panel?.label).toBe('Bones')

      // Register the loaded plugin into registry
      await loadPlugin(loaded.plugin)

      expect(nodeRegistry.has('bones:framing')).toBe(true)
      expect(nodeRegistry.has('bones:lumber')).toBe(true)
    })
  })

  describe('3. IFC Converter & Import UI Integration', () => {
    test('IfcImportButton component is callable and exportable', () => {
      expect(typeof IfcImportButton).toBe('function')
    })

    test('@pascal-app/ifc-converter dynamically loads convertIfcToPascal function', async () => {
      const ifcConverter = await import('@pascal-app/ifc-converter')
      expect(typeof ifcConverter.convertIfcToPascal).toBe('function')
    })
  })

  describe('4. 3D Print Exporter Integration', () => {
    test('@pascal-app/editor exports PrintExportButton and print-3mf export logic', async () => {
      const settingsPanelModule = await import(
        '../../../packages/editor/src/components/ui/sidebar/panels/settings-panel/print-export-button'
      )
      expect(typeof settingsPanelModule.PrintExportButton).toBe('function')
      expect(typeof settingsPanelModule.preparePrintExport).toBe('function')
    })
  })
})
