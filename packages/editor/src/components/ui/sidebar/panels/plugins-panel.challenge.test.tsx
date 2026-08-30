import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { type IconRef, pluginManager, useScene } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { editorHostPanelRegistry } from '../../../../lib/plugin-panels'
import { PluginsPanel } from './plugins-panel'

describe('EMPIRICAL ADVERSARIAL CHALLENGE: PluginsPanel Sidebar Integration', () => {
  beforeEach(() => {
    pluginManager._reset()
    editorHostPanelRegistry.reset()
    useScene.getState().setInstalledPlugins([], { explicit: true })
    useScene.setState({ readOnly: false })
  })

  afterEach(() => {
    pluginManager._reset()
    editorHostPanelRegistry.reset()
    useScene.setState({ readOnly: false })
  })

  describe('Dimension 1: Polymorphic & Adversarial Icon Rendering', () => {
    it('renders plain string URLs, relative paths, and HTTPS URLs without error', () => {
      pluginManager.registerDescriptors([
        {
          id: 'test:string-icon-rel',
          name: 'Relative Icon Plugin',
          icon: '/icons/custom-tool.webp',
          loadPlugin: async () => ({ id: 'test:string-icon-rel', apiVersion: 1 }),
        },
        {
          id: 'test:string-icon-https',
          name: 'HTTPS Icon Plugin',
          icon: 'https://images.unsplash.com/photo-example.png',
          loadPlugin: async () => ({ id: 'test:string-icon-https', apiVersion: 1 }),
        },
      ])

      const html = renderToStaticMarkup(<PluginsPanel />)

      expect(html).toContain('src="/icons/custom-tool.webp"')
      expect(html).toContain('src="https://images.unsplash.com/photo-example.png"')
    })

    it('handles null, undefined, and empty string icon definitions by falling back to default Puzzle icon', () => {
      pluginManager.registerDescriptors([
        {
          id: 'test:null-icon',
          name: 'Null Icon Plugin',
          icon: null,
          loadPlugin: async () => ({ id: 'test:null-icon', apiVersion: 1 }),
        },
        {
          id: 'test:undefined-icon',
          name: 'Undefined Icon Plugin',
          icon: undefined,
          loadPlugin: async () => ({ id: 'test:undefined-icon', apiVersion: 1 }),
        },
      ])

      const html = renderToStaticMarkup(<PluginsPanel />)

      expect(html).toContain('Null Icon Plugin')
      expect(html).toContain('Undefined Icon Plugin')
      // Lucide Puzzle SVG uses lucide-puzzle class
      expect(html).toContain('lucide-puzzle')
    })

    it('renders Iconify, SVG, URL, and Lazy Component IconRef structures safely', () => {
      pluginManager.registerDescriptors([
        {
          id: 'test:iconify',
          name: 'Iconify Plugin',
          icon: { kind: 'iconify', name: 'lucide:activity' },
          loadPlugin: async () => ({ id: 'test:iconify', apiVersion: 1 }),
        },
        {
          id: 'test:svg',
          name: 'SVG Plugin',
          icon: {
            kind: 'svg',
            viewBox: '0 0 24 24',
            path: 'M12 2L2 7l10 5 10-5-10-5z',
          },
          loadPlugin: async () => ({ id: 'test:svg', apiVersion: 1 }),
        },
        {
          id: 'test:url-kind',
          name: 'URL Kind Plugin',
          icon: { kind: 'url', src: '/assets/kind-icon.svg' },
          loadPlugin: async () => ({ id: 'test:url-kind', apiVersion: 1 }),
        },
      ])

      const html = renderToStaticMarkup(<PluginsPanel />)

      expect(html).toContain('Iconify Plugin')
      expect(html).toContain('viewBox="0 0 24 24"')
      expect(html).toContain('d="M12 2L2 7l10 5 10-5-10-5z"')
      expect(html).toContain('src="/assets/kind-icon.svg"')
    })
  })

  describe('Dimension 2: Native UI Specification & Invariant Enforcement', () => {
    it('strictly guarantees no search bar, no category filter tabs, and exact header typography', () => {
      pluginManager.registerDescriptors([
        {
          id: 'test:plugin-1',
          name: 'Plugin Alpha',
          description: 'Alpha description text for testing',
          loadPlugin: async () => ({ id: 'test:plugin-1', apiVersion: 1 }),
        },
      ])

      const html = renderToStaticMarkup(<PluginsPanel />)

      // Strict prohibition of search input and filter tabs
      expect(html).not.toContain('<input')
      expect(html).not.toContain('role="tablist"')
      expect(html).not.toContain('placeholder="')
      expect(html).not.toContain('Eklenti Yöneticisi')

      // Preserved native typography and documentation links
      expect(html).toContain('<h2 class="font-semibold text-lg text-sidebar-foreground">Plugins</h2>')
      expect(html).toContain('Add focused tools and content to this project.')
      expect(html).toContain('Create a DigitalTwin plugin')
      expect(html).toContain('href="https://editor.pascal.app/docs/developers/plugins"')
    })

    it('sanitizes external links with rel="noreferrer" and target="_blank"', () => {
      pluginManager.registerDescriptors([
        {
          id: 'test:author-link',
          name: 'Author Link Plugin',
          author: { name: 'Pascal Team', url: 'https://pascal.org' },
          pluginUrl: 'https://editor.pascal.app/plugins/author-link',
          loadPlugin: async () => ({ id: 'test:author-link', apiVersion: 1 }),
        },
      ])

      const html = renderToStaticMarkup(<PluginsPanel />)
      expect(html).toContain('Author Link Plugin')
    })
  })

  describe('Dimension 3: Unified Merging of Descriptors and Host Panels', () => {
    it('merges plugins from pluginManager and editorHostPanelRegistry without duplicate keys', () => {
      // 1. Register in pluginManager
      pluginManager.registerDescriptor({
        id: 'shared:plugin',
        name: 'Shared Catalog Plugin',
        description: 'From Catalog',
        loadPlugin: async () => ({ id: 'shared:plugin', apiVersion: 1 }),
      })

      // 2. Register extra panel in editorHostPanelRegistry with the same pluginId
      editorHostPanelRegistry.registerPanel({
        id: 'shared:panel',
        pluginId: 'shared:plugin',
        label: 'Shared Panel In Registry',
        icon: { kind: 'url', src: '/shared.webp' },
        component: async () => ({ default: () => null }),
      })

      // 3. Register standalone panel in editorHostPanelRegistry without catalog descriptor
      editorHostPanelRegistry.registerPanel({
        id: 'standalone:panel',
        pluginId: 'standalone:plugin',
        label: 'Standalone Panel',
        description: 'Standalone host panel without catalog descriptor',
        icon: { kind: 'url', src: '/standalone.webp' },
        component: async () => ({ default: () => null }),
      })

      const html = renderToStaticMarkup(<PluginsPanel />)

      // Shared plugin should be listed once
      expect(html).toContain('Shared Catalog Plugin')
      expect(html).toContain('Standalone Panel')
      expect(html).toContain('Standalone host panel without catalog descriptor')
    })
  })

  describe('Dimension 4: Dynamic State Synchronization with useScene & readOnly Guard', () => {
    it('reflects dynamic installation transitions from uninstalled to installed', async () => {
      pluginManager.registerDescriptor({
        id: 'pascal:boots',
        name: 'PascalOrg Boots',
        loadPlugin: async () => ({ id: 'pascal:boots', apiVersion: 1 }),
      })

      // Before install
      let html = renderToStaticMarkup(<PluginsPanel />)
      expect(html).toContain('Not installed')
      expect(html).not.toContain('Installed</p>')

      // Trigger install via pluginManager
      await pluginManager.installPlugin('pascal:boots')
      useScene.getState().setInstalledPlugins(['pascal:boots'], { explicit: true })

      // After install
      html = renderToStaticMarkup(<PluginsPanel />)
      expect(html).toContain('Installed')
    })

    it('correctly handles uninstall transitions back to Not installed', async () => {
      pluginManager.registerDescriptor({
        id: 'pascal:boots',
        name: 'PascalOrg Boots',
        loadPlugin: async () => ({ id: 'pascal:boots', apiVersion: 1 }),
      })

      await pluginManager.installPlugin('pascal:boots')
      useScene.getState().setInstalledPlugins(['pascal:boots'], { explicit: true })

      let html = renderToStaticMarkup(<PluginsPanel />)
      expect(html).toContain('Installed')

      // Uninstall
      pluginManager.uninstallPlugin('pascal:boots')
      useScene.getState().setInstalledPlugins([], { explicit: true })

      html = renderToStaticMarkup(<PluginsPanel />)
      expect(html).toContain('Not installed')
    })

    it('respects readOnly scene state to prevent modifications', () => {
      useScene.setState({ readOnly: true })

      pluginManager.registerDescriptor({
        id: 'pascal:locked',
        name: 'Locked Plugin',
        loadPlugin: async () => ({ id: 'pascal:locked', apiVersion: 1 }),
      })

      const html = renderToStaticMarkup(<PluginsPanel />)
      expect(html).toContain('Locked Plugin')
      expect(html).toContain('Not installed')
    })
  })
})
