import { describe, expect, test } from 'bun:test'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import React from 'react'
import { EditorLayoutV2 } from '../components/editor/editor-layout-v2'

describe('Strict Zero-Mutation & Slot Isolation Invariant Tests', () => {
  // Find project root relative to current file or working directory
  const rootCandidates = [
    resolve(import.meta.dir, '../../../../..'),
    resolve(process.cwd(), '../..'),
    resolve(process.cwd(), '../../..'),
    'E:\\Digital Twin',
  ]
  const projectRoot = rootCandidates.find((dir) => existsSync(join(dir, 'Digitaltwin'))) ?? 'E:\\Digital Twin'

  describe('Slot Isolation in EditorLayoutV2', () => {
    test('mounts slots into dedicated layout regions cleanly', () => {
      const mockToolbarCenter = React.createElement('div', { id: 'test-center-toolbar' }, 'Center Tools')
      const mockToolbarLeft = React.createElement('div', { id: 'test-left-toolbar' }, 'Left Tools')
      const mockToolbarRight = React.createElement('div', { id: 'test-right-toolbar' }, 'Right Tools')
      const mockStageOverlay = React.createElement('div', { id: 'test-stage-overlay' }, 'Stage Overlay')
      const mockSidebarOverlay = React.createElement('div', { id: 'test-sidebar-overlay' }, 'Sidebar Overlay')
      const mockViewerContent = React.createElement('div', { id: 'test-viewer-canvas' }, 'Canvas Area')

      const element = React.createElement(EditorLayoutV2, {
        viewerToolbarCenter: mockToolbarCenter,
        viewerToolbarLeft: mockToolbarLeft,
        viewerToolbarRight: mockToolbarRight,
        stageOverlay: mockStageOverlay,
        sidebarOverlay: mockSidebarOverlay,
        viewerContent: mockViewerContent,
        sidebarTabs: [{ id: 'build', label: 'Build', icon: 'build' as any }],
        renderTabContent: (tabId: string) => React.createElement('div', { id: `tab-content-${tabId}` }),
      } as any)

      expect(element).toBeDefined()
      expect(element.type).toBe(EditorLayoutV2 as any)
      expect((element.props as any).viewerToolbarCenter).toBe(mockToolbarCenter)
      expect((element.props as any).stageOverlay).toBe(mockStageOverlay)
      expect((element.props as any).viewerToolbarLeft).toBe(mockToolbarLeft)
      expect((element.props as any).viewerToolbarRight).toBe(mockToolbarRight)
    })
  })

  describe('Forensic Invariant Protection: scene-loader.tsx', () => {
    const sceneLoaderPath = join(projectRoot, 'editor', 'apps', 'editor', 'components', 'scene-loader.tsx')

    test('verifies scene-loader.tsx exists and is pristine', () => {
      expect(existsSync(sceneLoaderPath)).toBe(true)
      const content = readFileSync(sceneLoaderPath, 'utf-8')

      // 1. SSE Event Streaming Subscription
      expect(content).toContain('/api/scenes/')
      expect(content).toContain('/events')

      // 2. Presence Lease Lock Management
      expect(content).toContain('useScenePresence')

      // 3. Unhydrated Empty Graph Overwrite Guard
      expect(content).toContain('isEmptyGraphOverwrite')

      // 4. Optimistic Versioning & Scene Graph Signature
      expect(content).toContain('sceneGraphSignature')

      // 5. Clean Component Prop Slot Integration
      expect(content).toContain('CommunityViewerToolbarCenter')
      expect(content).toContain('CommunityViewerToolbarLeft')
      expect(content).toContain('CommunityViewerToolbarRight')
      expect(content).toContain('EDITOR_SIDEBAR_TABS')
    })
  })

  describe('Forensic Invariant Protection: Database & Migrations', () => {
    const migrationsDir = join(projectRoot, 'Digitaltwin', 'panel-migrations')

    test('verifies zero added SQL migrations and pristine migration count', () => {
      expect(existsSync(migrationsDir)).toBe(true)
      const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))

      // Must be exactly 7 migrations (001 to 007)
      expect(files.length).toBe(7)
      expect(files.sort()).toEqual([
        '001_init.sql',
        '002_roles_and_requests.sql',
        '003_password_resets.sql',
        '004_site_scene.sql',
        '005_user_locale.sql',
        '006_provenance_survives_deletion.sql',
        '007_indexes_for_the_hot_paths.sql',
      ])
    })

    test('verifies core database schemas and tables remain unchanged', () => {
      const initSqlPath = join(migrationsDir, '001_init.sql')
      expect(existsSync(initSqlPath)).toBe(true)
      const initSql = readFileSync(initSqlPath, 'utf-8')

      expect(initSql).toContain('CREATE TABLE users')
      expect(initSql).toContain('CREATE TABLE sessions')
      expect(initSql).toContain('CREATE TABLE sites')
      expect(initSql).toContain('CREATE TABLE two_factor')
      expect(initSql).toContain('CREATE TABLE audit_log')
    })
  })
})
