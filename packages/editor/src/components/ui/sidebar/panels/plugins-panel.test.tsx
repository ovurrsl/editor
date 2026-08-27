import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { pluginManager, useScene } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { editorHostPanelRegistry } from '../../../../lib/plugin-panels'
import { PluginsPanel } from './plugins-panel'

describe('PluginsPanel Native Sidebar Component', () => {
  beforeEach(() => {
    pluginManager._reset()
    editorHostPanelRegistry.reset()
    useScene.getState().setInstalledPlugins([], { explicit: true })

    pluginManager.registerDescriptors([
      {
        id: 'pascal:boots',
        name: 'PascalOrg Boots',
        description: 'Industrial safety equipment and footwear.',
        icon: '/icons/boots.webp',
        author: { name: 'PascalOrg', url: 'https://pascal.org' },
        pluginUrl: 'https://editor.pascal.app/plugins/boots',
        loadPlugin: async () => ({
          id: 'pascal:boots',
          name: 'PascalOrg Boots',
          version: '1.0.0',
          apiVersion: 1,
        }),
      },
      {
        id: 'pascal:trees',
        name: 'Nature and Trees',
        description: 'Parametric procedural greenery and vegetation.',
        icon: { kind: 'url', src: '/nature.webp' },
        author: 'Pascal Green',
        loadPlugin: async () => ({
          id: 'pascal:trees',
          name: 'Nature and Trees',
          version: '1.0.0',
          apiVersion: 1,
        }),
      },
    ])
  })

  afterEach(() => {
    pluginManager._reset()
    editorHostPanelRegistry.reset()
  })

  it('renders all plugins from pluginManager descriptors in native card layout', () => {
    const html = renderToStaticMarkup(<PluginsPanel />)

    expect(html).toContain('Plugins')
    expect(html).toContain('Add focused tools and content to this project.')
    expect(html).toContain('PascalOrg Boots')
    expect(html).toContain('Nature and Trees')
    expect(html).toContain('Industrial safety equipment and footwear.')
    expect(html).toContain('Not installed')
    expect(html).toContain('Create a DigitalTwin plugin')
  })

  it('strictly enforces no search input or category filter tabs in native design', () => {
    const html = renderToStaticMarkup(<PluginsPanel />)

    expect(html).not.toContain('<input')
    expect(html).not.toContain('role="tablist"')
    expect(html).not.toContain('placeholder="Search')
  })

  it('renders string URL icons correctly', () => {
    const html = renderToStaticMarkup(<PluginsPanel />)

    expect(html).toContain('src="/icons/boots.webp"')
    expect(html).toContain('src="/nature.webp"')
  })

  it('reflects installed plugin state when installed via pluginManager', async () => {
    await pluginManager.installPlugin('pascal:boots')

    const html = renderToStaticMarkup(<PluginsPanel />)

    expect(html).toContain('Installed')
  })
})
