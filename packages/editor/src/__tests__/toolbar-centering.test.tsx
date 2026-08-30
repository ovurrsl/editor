import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EditorLayoutV2 } from '../components/editor/editor-layout-v2'
import { EditorLayoutMobile } from '../components/editor/editor-layout-mobile'

describe('R4: Toolbar Layout & ViewModeControl Centering', () => {
  it('RightColumn renders toolbarCenter with absolute left-1/2 -translate-x-1/2 true centering container', () => {
    const markup = renderToStaticMarkup(
      <EditorLayoutV2
        isPreviewMode={false}
        renderTabContent={() => null}
        viewerContent={<div id="test-canvas">Canvas</div>}
        viewerToolbarCenter={<div id="center-slot">Center ViewModeControl</div>}
        viewerToolbarLeft={<div id="left-slot">Left Actions</div>}
        viewerToolbarRight={<div id="right-slot">Right Tools</div>}
      />,
    )

    expect(markup).toContain('id="center-slot"')
    expect(markup).toContain('id="left-slot"')
    expect(markup).toContain('id="right-slot"')
    // Verify true centering class container
    expect(markup).toContain('absolute left-1/2 -translate-x-1/2 flex items-center justify-center gap-2')
    expect(markup).toContain('pointer-events-none absolute top-3 right-3 left-3 z-20 flex items-center justify-between gap-2')
  })

  it('preserves viewer toolbars when isPreviewMode is true (does not suppress toolbar for viewers)', () => {
    const markup = renderToStaticMarkup(
      <EditorLayoutV2
        isPreviewMode={true}
        renderTabContent={() => null}
        viewerContent={<div id="test-canvas">Canvas</div>}
        viewerToolbarCenter={<div id="center-slot">Center ViewModeControl</div>}
        viewerToolbarLeft={<div id="left-slot">Left Actions</div>}
        viewerToolbarRight={<div id="right-slot">Right Tools</div>}
      />,
    )

    // Toolbar elements must be rendered even in preview/read-only mode
    expect(markup).toContain('id="center-slot"')
    expect(markup).toContain('id="left-slot"')
    expect(markup).toContain('id="right-slot"')
    expect(markup).toContain('absolute left-1/2 -translate-x-1/2')
  })

  it('Mobile layout (EditorLayoutMobile) also renders center toolbar with absolute centering', () => {
    const markup = renderToStaticMarkup(
      <EditorLayoutMobile
        isPreviewMode={false}
        renderTabContent={() => null}
        viewerContent={<div id="test-canvas">Canvas</div>}
        viewerToolbarCenter={<div id="mobile-center-slot">Mobile Center</div>}
        viewerToolbarLeft={<div id="mobile-left-slot">Mobile Left</div>}
        viewerToolbarRight={<div id="mobile-right-slot">Mobile Right</div>}
      />,
    )

    expect(markup).toContain('id="mobile-center-slot"')
    expect(markup).toContain('id="mobile-left-slot"')
    expect(markup).toContain('id="mobile-right-slot"')
    expect(markup).toContain('pointer-events-auto absolute left-1/2 -translate-x-1/2 flex items-center justify-center gap-2')
  })

  it('Cleanly omits toolbar container when all toolbar slots are undefined', () => {
    const markup = renderToStaticMarkup(
      <EditorLayoutV2
        isPreviewMode={false}
        renderTabContent={() => null}
        viewerContent={<div id="test-canvas">Canvas</div>}
      />,
    )

    expect(markup).not.toContain('pointer-events-none absolute top-3 right-3 left-3')
    expect(markup).not.toContain('absolute left-1/2 -translate-x-1/2')
  })

  it('Single-slot toolbarCenter without left/right still renders properly centered', () => {
    const markup = renderToStaticMarkup(
      <EditorLayoutV2
        isPreviewMode={false}
        renderTabContent={() => null}
        viewerContent={<div id="test-canvas">Canvas</div>}
        viewerToolbarCenter={<div id="isolated-center">Center Only</div>}
      />,
    )

    expect(markup).toContain('id="isolated-center"')
    expect(markup).toContain('absolute left-1/2 -translate-x-1/2')
  })
})
