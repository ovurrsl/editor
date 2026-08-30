'use client'

import { Icon } from '@iconify/react'
import { type IconRef, pluginManager, useScene } from '@pascal-app/core'
import { ChevronLeft, ChevronRight, ExternalLink, Puzzle } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useMemo, useState, useSyncExternalStore } from 'react'
import { editorHostPanelRegistry } from '../../../../lib/plugin-panels'
import { Button } from '../../primitives/button'

const PLUGIN_AUTHORING_URL =
  'https://editor.pascal.app/docs/developers/plugins'

export interface UnifiedPlugin {
  id: string
  label: string
  description?: string
  icon?: IconRef | string | null
  creator?: { name: string; url?: string }
  pluginUrl?: string
}

function renderPluginIcon(ref?: IconRef | string | null): ReactNode {
  if (!ref) {
    return <Puzzle className="h-7 w-7" />
  }
  if (typeof ref === 'string') {
    return <img alt="" className="h-8 w-8 object-contain" src={ref} />
  }
  if (ref.kind === 'url') {
    return <img alt="" className="h-8 w-8 object-contain" src={ref.src} />
  }
  if (ref.kind === 'iconify') {
    return <Icon height={28} icon={ref.name} width={28} />
  }
  if (ref.kind === 'svg') {
    return (
      <svg height={28} viewBox={ref.viewBox} width={28}>
        <path d={ref.path} fill="currentColor" />
      </svg>
    )
  }
  if (ref.kind === 'component' && ref.module) {
    const LazyIcon = lazy(ref.module)
    return (
      <Suspense fallback={<Puzzle className="h-7 w-7" />}>
        <LazyIcon />
      </Suspense>
    )
  }
  if (typeof (ref as any).module === 'function') {
    const LazyIcon = lazy((ref as any).module)
    return (
      <Suspense fallback={<Puzzle className="h-7 w-7" />}>
        <LazyIcon />
      </Suspense>
    )
  }
  return <Puzzle className="h-7 w-7" />
}

export function PluginsPanel() {
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null)
  const [isBusyPluginId, setIsBusyPluginId] = useState<string | null>(null)

  const panels = useSyncExternalStore(
    editorHostPanelRegistry.subscribe,
    editorHostPanelRegistry.getSnapshot,
    editorHostPanelRegistry.getSnapshot,
  )
  const pluginSnapshot = useSyncExternalStore(
    pluginManager.subscribe,
    pluginManager.getSnapshot,
    pluginManager.getSnapshot,
  )
  const installedPlugins = useScene((state) => state.installedPlugins)
  const setInstalledPlugins = useScene((state) => state.setInstalledPlugins)
  const readOnly = useScene((state) => state.readOnly)

  const plugins: UnifiedPlugin[] = useMemo(() => {
    const map = new Map<string, UnifiedPlugin>()

    // 1. Add all descriptors registered in pluginManager (from PLUGIN_CATALOG)
    for (const desc of pluginSnapshot.descriptors) {
      const matchingPanel = panels.find((p) => p.pluginId === desc.id)
      map.set(desc.id, {
        id: desc.id,
        label: desc.name,
        description: desc.description ?? matchingPanel?.description,
        icon: desc.icon ?? matchingPanel?.icon,
        creator:
          typeof desc.author === 'string'
            ? { name: desc.author }
            : desc.author
              ? { name: desc.author.name, url: desc.author.url }
              : matchingPanel?.creator,
        pluginUrl: desc.pluginUrl ?? matchingPanel?.pluginUrl,
      })
    }

    // 2. Add any additional panels registered directly in editorHostPanelRegistry
    for (const panel of panels) {
      if (panel.pluginId && !map.has(panel.pluginId)) {
        map.set(panel.pluginId, {
          id: panel.pluginId,
          label: panel.label,
          description: panel.description,
          icon: panel.icon,
          creator: panel.creator,
          pluginUrl: panel.pluginUrl,
        })
      }
    }

    return Array.from(map.values())
  }, [pluginSnapshot.descriptors, panels])

  const selectedPlugin = selectedPluginId
    ? plugins.find((p) => p.id === selectedPluginId)
    : undefined

  const handleToggleInstall = async (pluginId: string) => {
    if (readOnly || isBusyPluginId) return

    const isInstalled = installedPlugins.includes(pluginId)
    if (isInstalled) {
      pluginManager.uninstallPlugin(pluginId)
      const next = installedPlugins.filter((id) => id !== pluginId)
      setInstalledPlugins(next, { explicit: true })
    } else {
      setIsBusyPluginId(pluginId)
      try {
        if (pluginManager.hasDescriptor(pluginId)) {
          await pluginManager.installPlugin(pluginId)
        }
        if (!installedPlugins.includes(pluginId)) {
          setInstalledPlugins([...installedPlugins, pluginId], { explicit: true })
        }
      } catch (err) {
        console.error(`[plugins-panel] Failed to install plugin ${pluginId}:`, err)
      } finally {
        setIsBusyPluginId(null)
      }
    }
  }

  if (selectedPlugin) {
    const installed =
      (installedPlugins && installedPlugins.includes(selectedPlugin.id)) ||
      pluginSnapshot.states[selectedPlugin.id]?.status === 'installed'
    const isBusy = isBusyPluginId === selectedPlugin.id

    return (
      <div className="flex h-full flex-col overflow-y-auto p-4">
        <div>
          <Button
            className="rounded-full"
            onClick={() => setSelectedPluginId(null)}
            size="sm"
            variant="ghost"
          >
            <ChevronLeft className="h-4 w-4" />
            All plugins
          </Button>

          <div className="mt-5 flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-background/60">
              {renderPluginIcon(selectedPlugin.icon)}
            </div>
            <div className="min-w-0 pt-1">
              <h2 className="font-semibold text-lg text-sidebar-foreground">
                {selectedPlugin.label}
              </h2>
              <p className="text-sidebar-foreground/50 text-sm">
                {installed ? 'Installed' : 'Not installed'}
              </p>
            </div>
          </div>

          <p className="mt-5 text-sidebar-foreground/70 text-sm">
            {selectedPlugin.description ?? 'Adds a new tool panel to the editor.'}
          </p>

          <dl className="mt-6 divide-y divide-border/50 rounded-xl border border-border/60">
            <div className="p-3">
              <dt className="text-sidebar-foreground/50 text-xs">Plugin ID</dt>
              <dd className="mt-1 break-all text-sidebar-foreground text-sm">
                {selectedPlugin.id}
              </dd>
            </div>
            {selectedPlugin.creator && (
              <div className="p-3">
                <dt className="text-sidebar-foreground/50 text-xs">Creator</dt>
                <dd className="mt-1 text-sm">
                  {selectedPlugin.creator.url ? (
                    <a
                      className="inline-flex items-center gap-1 text-sidebar-foreground underline-offset-4 hover:underline"
                      href={selectedPlugin.creator.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {selectedPlugin.creator.name}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    selectedPlugin.creator.name
                  )}
                </dd>
              </div>
            )}
            {selectedPlugin.pluginUrl && (
              <div className="p-3">
                <dt className="text-sidebar-foreground/50 text-xs">Plugin</dt>
                <dd className="mt-1 text-sm">
                  <a
                    className="inline-flex items-center gap-1 text-sidebar-foreground underline-offset-4 hover:underline"
                    href={selectedPlugin.pluginUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View plugin
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </dd>
              </div>
            )}
          </dl>

          <Button
            className="mt-5 rounded-full"
            disabled={readOnly || isBusy}
            onClick={() => handleToggleInstall(selectedPlugin.id)}
            variant={installed ? 'outline' : 'default'}
          >
            {isBusy ? 'Installing…' : installed ? 'Uninstall' : 'Install'}
          </Button>
        </div>

        <div className="mt-auto pt-6">
          <a
            className="inline-flex items-center gap-1.5 text-sidebar-foreground/70 text-sm underline-offset-4 hover:text-sidebar-foreground hover:underline"
            href={PLUGIN_AUTHORING_URL}
            rel="noreferrer"
            target="_blank"
          >
            Create a DigitalTwin plugin
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-5">
        <h2 className="font-semibold text-lg text-sidebar-foreground">Plugins</h2>
        <p className="mt-1 text-sidebar-foreground/60 text-sm">
          Add focused tools and content to this project.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {plugins.map((plugin) => {
          const installed =
            (installedPlugins && installedPlugins.includes(plugin.id)) ||
            pluginSnapshot.states[plugin.id]?.status === 'installed'
          return (
            <button
              className="w-full rounded-xl border border-border/60 bg-accent/20 p-3 text-left transition-colors hover:bg-accent/40"
              key={plugin.id}
              onClick={() => setSelectedPluginId(plugin.id)}
              type="button"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background/60">
                  {renderPluginIcon(plugin.icon)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-medium text-sidebar-foreground">{plugin.label}</h3>
                      <p className="text-sidebar-foreground/50 text-xs">
                        {installed ? 'Installed' : 'Not installed'}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
                  </div>
                  <p className="mt-2 text-sidebar-foreground/60 text-sm">
                    {plugin.description ?? 'Adds a new tool panel to the editor.'}
                  </p>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-auto pt-6">
        <a
          className="inline-flex items-center gap-1.5 text-sidebar-foreground/70 text-sm underline-offset-4 hover:text-sidebar-foreground hover:underline"
          href={PLUGIN_AUTHORING_URL}
          rel="noreferrer"
          target="_blank"
        >
          Create a DigitalTwin plugin
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}
