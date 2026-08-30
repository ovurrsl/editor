import { beforeEach, describe, expect, it } from 'bun:test'
import { nodeRegistry, pluginManager, useScene } from '@pascal-app/core'
import { PLUGIN_CATALOG, getPluginDescriptor } from './catalog'
import { usePluginManager } from './use-plugin-manager'

describe('EMPIRICAL ADVERSARIAL CHALLENGE: usePluginManager Store & Sync Operations', () => {
  beforeEach(() => {
    nodeRegistry._reset()
    pluginManager._reset()
    useScene.getState().setInstalledPlugins([], { explicit: true })
    pluginManager.registerDescriptors(PLUGIN_CATALOG)
  })

  describe('Dimension 1: Store Surface Cleanliness (No Modal State Residue)', () => {
    it('strictly guarantees that modal state, search queries, and categories are deleted from store', () => {
      const state: any = usePluginManager.getState()

      expect(state.searchQuery).toBeUndefined()
      expect(state.selectedCategory).toBeUndefined()
      expect(state.isModalOpen).toBeUndefined()
      expect(state.activeDetailPluginId).toBeUndefined()
      expect(state.openModal).toBeUndefined()
      expect(state.closeModal).toBeUndefined()
      expect(state.setSearchQuery).toBeUndefined()
      expect(state.setSelectedCategory).toBeUndefined()

      // Essential lifecycle methods exist
      expect(typeof state.installPlugin).toBe('function')
      expect(typeof state.uninstallPlugin).toBe('function')
      expect(typeof state.syncWithScene).toBe('function')
      expect(typeof state.loadDefaultPlugins).toBe('function')
    })
  })

  describe('Dimension 2: Scene Synchronization & Idempotency', () => {
    it('syncWithScene safely handles empty array, unknown IDs, and duplicate IDs', async () => {
      // 1. Empty array
      await usePluginManager.getState().syncWithScene([])
      expect(pluginManager.getDescriptors().length).toBeGreaterThan(0)

      // 2. Duplicate IDs and unknown IDs
      await usePluginManager.getState().syncWithScene([
        'pascal:boots',
        'pascal:boots',
        'unknown:fake:plugin',
        'pascal:trees',
      ])

      expect(pluginManager.getPluginState('pascal:boots').status).toBe('installed')
      expect(pluginManager.getPluginState('pascal:trees').status).toBe('installed')
      expect(pluginManager.getPluginState('unknown:fake:plugin').status).toBe('unloaded')
      expect(useScene.getState().installedPlugins).toContain('pascal:boots')
      expect(useScene.getState().installedPlugins).toContain('pascal:trees')
    })

    it('loadDefaultPlugins respects scene.hasExplicitPluginInstallState', async () => {
      // Set explicit empty plugins
      useScene.getState().setInstalledPlugins([], { explicit: true })
      expect(useScene.getState().hasExplicitPluginInstallState).toBe(true)

      await usePluginManager.getState().loadDefaultPlugins()
      // Should not load default plugins if explicit state is already true
      expect(useScene.getState().installedPlugins).toHaveLength(0)

      // Set explicit = false (e.g. brand new project)
      useScene.getState().setInstalledPlugins([], { explicit: false })
      expect(useScene.getState().hasExplicitPluginInstallState).toBe(false)

      await usePluginManager.getState().loadDefaultPlugins()

      const defaultCatalogIds = PLUGIN_CATALOG.filter((p) => p.defaultInstalled).map((p) => p.id)
      for (const id of defaultCatalogIds) {
        expect(useScene.getState().installedPlugins).toContain(id)
        expect(pluginManager.getPluginState(id).status).toBe('installed')
      }
    }, 15000)
  })

  describe('Dimension 3: Error Isolation and State Integrity', () => {
    it('returns false and preserves state when installing non-existent plugin', async () => {
      const result = await usePluginManager.getState().installPlugin('nonexistent:id')
      expect(result).toBe(false)
      expect(useScene.getState().installedPlugins).not.toContain('nonexistent:id')
    })

    it('returns true and cleanly uninstalls plugins', async () => {
      await usePluginManager.getState().installPlugin('pascal:boots')
      expect(useScene.getState().installedPlugins).toContain('pascal:boots')

      const result = await usePluginManager.getState().uninstallPlugin('pascal:boots')
      expect(result).toBe(true)
      expect(useScene.getState().installedPlugins).not.toContain('pascal:boots')
      expect(pluginManager.getPluginState('pascal:boots').status).toBe('unloaded')
    })
  })
})
