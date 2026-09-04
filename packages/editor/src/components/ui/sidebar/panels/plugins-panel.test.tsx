import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { useScene } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { editorHostPanelRegistry, registerEditorHostPanel } from '../../../../lib/plugin-panels'
import { PluginsPanel } from './plugins-panel'

describe('PluginsPanel Native Sidebar Component', () => {
  beforeEach(() => {
    editorHostPanelRegistry.reset()
    useScene.setState({ readOnly: false })
    useScene.getState().setInstalledPlugins([], { explicit: true })

    registerEditorHostPanel({
      id: 'pascal:boots:panel',
      pluginId: 'pascal:boots',
      label: 'PascalOrg Boots',
      description: 'Industrial safety equipment and footwear.',
      icon: { kind: 'url', src: '/icons/boots.webp' },
      creator: { name: 'PascalOrg', url: 'https://pascal.org' },
      pluginUrl: 'https://editor.pascal.app/plugins/boots',
      component: async () => ({ default: () => null }),
    })

    registerEditorHostPanel({
      id: 'pascal:trees:trees',
      pluginId: 'pascal:trees',
      label: 'Nature and Trees',
      description: 'Parametric procedural greenery and vegetation.',
      icon: { kind: 'url', src: '/nature.webp' },
      creator: { name: 'Pascal Green' },
      component: async () => ({ default: () => null }),
    })
  })

  afterEach(() => {
    editorHostPanelRegistry.reset()
  })

  it('renders all plugins from editorHostPanelRegistry in native card layout', () => {
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

  it('reflects installed plugin state when installed via useScene', async () => {
    useScene.getState().setInstalledPlugins(['pascal:boots'], { explicit: true })

    const html = renderToStaticMarkup(<PluginsPanel />)

    expect(html).toContain('Installed')
  })
})
