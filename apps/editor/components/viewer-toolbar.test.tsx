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
  it('R4: CommunityViewerToolbarCenter renders ViewModeControl with 2D, 3D, and Split view options', () => {
    const markup = renderToStaticMarkup(<CommunityViewerToolbarCenter />)
    expect(markup).toContain('3D')
    expect(markup).toContain('2D')
    expect(markup).toContain('Split')
  })

  it('R4: CommunityViewerToolbarLeft does NOT render ViewModeControl buttons (decoupled to center slot)', () => {
    const markup = renderToStaticMarkup(
      <CommunityViewerToolbarLeft
        currentUserId="user_bob_456"
        presence={mockViewerPresence}
      />,
    )
    expect(markup).not.toContain('Split')
  })

  it('R3: CommunityViewerToolbarLeft renders active editor badge with editor name and pulsating dot when viewing', () => {
    const markup = renderToStaticMarkup(
      <CommunityViewerToolbarLeft
        currentUserId="user_bob_456"
        presence={mockViewerPresence}
      />,
    )
    // Should display "Düzenleyen:" and the editor's display name "alice"
    expect(markup).toContain('Düzenleyen:')
    expect(markup).toContain('alice')
    expect(markup).toContain('animate-ping')
    expect(markup).toContain('bg-emerald-400')
    expect(markup).toContain('bg-emerald-500')
  })

  it('R3: CommunityViewerToolbarLeft renders "Düzenliyorsunuz (Aktif Editör)" with static indicator when user is the editor', () => {
    const markup = renderToStaticMarkup(
      <CommunityViewerToolbarLeft
        currentUserId="user_alice_123"
        presence={mockEditorPresence}
      />,
    )
    expect(markup).toContain('Düzenliyorsunuz (Aktif Editör)')
    expect(markup).not.toContain('animate-ping')
    expect(markup).toContain('border-emerald-500/30')
    expect(markup).toContain('bg-emerald-500/10')
  })

  it('R3 Edge Case: Handles null/undefined presence gracefully without throwing or rendering badge', () => {
    const markupNull = renderToStaticMarkup(<CommunityViewerToolbarLeft presence={null} />)
    expect(markupNull).not.toContain('active-editor-badge')
    expect(markupNull).not.toContain('Düzenleyen:')
    expect(markupNull).not.toContain('Düzenliyorsunuz')

    const markupUndefined = renderToStaticMarkup(<CommunityViewerToolbarLeft />)
    expect(markupUndefined).not.toContain('active-editor-badge')
  })

  it('R3 Edge Case: Does not render badge when presence.loaded is false', () => {
    const unloadedPresence: ScenePresence = {
      ...mockViewerPresence,
      loaded: false,
    }
    const markup = renderToStaticMarkup(<CommunityViewerToolbarLeft presence={unloadedPresence} />)
    expect(markup).not.toContain('active-editor-badge')
    expect(markup).not.toContain('alice')
  })

  it('R3 Edge Case: Does not render badge when presence.loaded is true but editor is null', () => {
    const noEditorPresence: ScenePresence = {
      ...mockViewerPresence,
      editor: null,
    }
    const markup = renderToStaticMarkup(<CommunityViewerToolbarLeft presence={noEditorPresence} />)
    expect(markup).not.toContain('active-editor-badge')
    expect(markup).not.toContain('Düzenleyen:')
  })

  it('R3 Edge Case: Handles email without @ by using raw identifier as fallback', () => {
    const rawIdPresence: ScenePresence = {
      ...mockViewerPresence,
      editor: { userId: 'custom-arch-99', email: 'custom-arch-99' },
    }
    const markup = renderToStaticMarkup(<CommunityViewerToolbarLeft presence={rawIdPresence} />)
    expect(markup).toContain('custom-arch-99')
  })

  it('CommunityViewerToolbarRight renders history, levels, wall mode and display controls', () => {
    const markup = renderToStaticMarkup(<CommunityViewerToolbarRight />)
    expect(markup).toContain('Undo')
    expect(markup).toContain('Redo')
    expect(markup).toContain('Display')
    expect(markup).toContain('Preview')
  })
})
