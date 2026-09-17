import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CommunityViewerToolbarCenter,
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from './viewer-toolbar'
import type { ScenePresence } from './use-scene-presence'

const mockViewerPresence: ScenePresence = {
  loaded: true,
  isEditor: false,
  canEdit: true,
  editor: {
    userId: 'user_alice_123',
    email: 'alice@example.com',
  },
  present: [
    { userId: 'user_alice_123', email: 'alice@example.com', isEditor: true },
    { userId: 'user_bob_456', email: 'bob@example.com', isEditor: false },
  ],
  takeOver: () => {},
  passControl: async () => {},
  refresh: async () => {},
}

const mockEditorPresence: ScenePresence = {
  loaded: true,
  isEditor: true,
  canEdit: true,
  editor: {
    userId: 'user_alice_123',
    email: 'alice@example.com',
  },
  present: [
    { userId: 'user_alice_123', email: 'alice@example.com', isEditor: true },
    { userId: 'user_bob_456', email: 'bob@example.com', isEditor: false },
  ],
  takeOver: () => {},
  passControl: async () => {},
  refresh: async () => {},
}

describe('R3 & R4: CommunityViewerToolbar & Active Editor Badge', () => {
  it('R4: CommunityViewerToolbarLeft in editor mode renders ViewModeControl with 2D, 3D, and Split view options', () => {
    const markup = renderToStaticMarkup(<CommunityViewerToolbarLeft presence={mockEditorPresence} />)
    expect(markup).toContain('3D')
    expect(markup).toContain('2D')
    expect(markup).toContain('Split')
  })

  it('R4: CommunityViewerToolbarLeft in viewer mode is completely hidden (null)', () => {
    const markup = renderToStaticMarkup(
      <CommunityViewerToolbarLeft
        currentUserId="user_bob_456"
        presence={mockViewerPresence}
      />,
    )
    expect(markup).toBe('')
  })

  it('R3: CommunityViewerToolbarLeft renders active editor badge when user is the editor', () => {
    const markup = renderToStaticMarkup(
      <CommunityViewerToolbarLeft
        currentUserId="user_alice_123"
        presence={mockEditorPresence}
      />,
    )
    expect(markup).toContain('active-editor-badge')
    expect(markup).toContain('Editor')
    expect(markup).toContain('alice@example.com')
  })

  it('R3 Edge Case: Handles null/undefined presence gracefully without throwing or rendering badge', () => {
    const markupNull = renderToStaticMarkup(<CommunityViewerToolbarLeft presence={null} />)
    expect(markupNull).toBe('')

    const markupUndefined = renderToStaticMarkup(<CommunityViewerToolbarLeft />)
    expect(markupUndefined).toBe('')
  })

  it('R3 Edge Case: Does not render toolbar when presence.loaded is false', () => {
    const unloadedPresence: ScenePresence = {
      ...mockViewerPresence,
      loaded: false,
    }
    const markup = renderToStaticMarkup(<CommunityViewerToolbarLeft presence={unloadedPresence} />)
    expect(markup).toBe('')
  })

  it('R3 Edge Case: Handles email without @ by using raw identifier as fallback', () => {
    const rawIdPresence: ScenePresence = {
      ...mockEditorPresence,
      editor: { userId: 'custom-arch-99', email: 'custom-arch-99' },
    }
    const markup = renderToStaticMarkup(<CommunityViewerToolbarLeft presence={rawIdPresence} />)
    expect(markup).toContain('custom-arch-99')
  })

  it('CommunityViewerToolbarRight renders display controls when in editor mode', () => {
    const markup = renderToStaticMarkup(<CommunityViewerToolbarRight presence={mockEditorPresence} />)
    expect(markup).toContain('Display')
    expect(markup).toContain('Preview')
  })

  it('CommunityViewerToolbarRight hides controls when not in editor mode', () => {
    const markup = renderToStaticMarkup(<CommunityViewerToolbarRight presence={mockViewerPresence} />)
    expect(markup).toBe('')
  })
})
