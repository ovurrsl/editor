'use client'

import { create } from 'zustand'
import { useScene } from '@pascal-app/core'

export interface PluginManagerState {
  installPlugin: (pluginId: string) => Promise<boolean>
  uninstallPlugin: (pluginId: string) => Promise<boolean>
  syncWithScene: (installedIds: string[]) => Promise<void>
  loadDefaultPlugins: () => Promise<void>
}

export const usePluginManager = create<PluginManagerState>((_set, _get) => ({
  installPlugin: async (pluginId: string): Promise<boolean> => {
    const scene = useScene.getState()
    if (!scene.installedPlugins.includes(pluginId)) {
      scene.setInstalledPlugins([...scene.installedPlugins, pluginId], { explicit: true })
    }
    return true
  },

  uninstallPlugin: async (pluginId: string): Promise<boolean> => {
    const scene = useScene.getState()
    const next = scene.installedPlugins.filter((id) => id !== pluginId)
    scene.setInstalledPlugins(next, { explicit: true })
    return true
  },

  syncWithScene: async (_installedIds: string[]) => {
    // Handled by scene state and native bootstrap discovery
  },

  loadDefaultPlugins: async () => {
    // Handled by editorHostPanelRegistry defaultInstalled flags
  },
}))
