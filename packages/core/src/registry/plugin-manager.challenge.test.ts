import { beforeEach, describe, expect, it, vi } from 'bun:test'
import { z } from 'zod'
import { getRegistryVersion, nodeRegistry } from './registry'
import {
  PluginManager,
  type LazyPluginDescriptor,
} from './plugin-manager'
import type { AnyNodeDefinition, Plugin } from './types'

describe('EMPIRICAL ADVERSARIAL CHALLENGE: Core PluginManager Stress & Invariants', () => {
  let manager: PluginManager

  const createDummyDef = (kind: string): AnyNodeDefinition => ({
    kind,
    category: 'furnish',
    schemaVersion: 1,
    schema: z.object({
      id: z.string(),
      type: z.literal(kind),
    }),
    capabilities: {},
  })

  beforeEach(() => {
    nodeRegistry._reset()
    manager = new PluginManager()
  })

  describe('Dimension 1: Extreme Concurrency & Race Hazard Interleaving', () => {
    it('handles 200 concurrent install calls across 5 distinct plugins with random delay variance', async () => {
      const loadCounts = new Map<string, number>()

      for (let p = 0; p < 5; p++) {
        const pluginId = `stress:plugin:${p}`
        loadCounts.set(pluginId, 0)
        manager.registerDescriptor({
          id: pluginId,
          name: `Stress Plugin ${p}`,
          loadPlugin: async () => {
            const current = loadCounts.get(pluginId) ?? 0
            loadCounts.set(pluginId, current + 1)
            // Simulated random async network delay (5-30ms)
            await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 25) + 5))
            return {
              id: pluginId,
              apiVersion: 1,
              nodes: [createDummyDef(`stress:node:${p}`)],
            }
          },
        })
      }

      // Launch 200 interleaved concurrent requests
      const promises: Promise<void>[] = []
      for (let i = 0; i < 200; i++) {
        const targetPlugin = `stress:plugin:${i % 5}`
        promises.push(manager.installPlugin(targetPlugin))
      }

      await Promise.all(promises)

      // Verify each plugin was loaded EXACTLY once despite massive concurrency
      for (let p = 0; p < 5; p++) {
        const pluginId = `stress:plugin:${p}`
        expect(loadCounts.get(pluginId)).toBe(1)
        expect(manager.getPluginState(pluginId).status).toBe('installed')
        expect(nodeRegistry.has(`stress:node:${p}`)).toBe(true)
      }
    })

    it('handles concurrent install and uninstall operations without state inconsistency', async () => {
      let loadCount = 0
      manager.registerDescriptor({
        id: 'race:target',
        name: 'Race Target',
        loadPlugin: async () => {
          loadCount++
          await new Promise((resolve) => setTimeout(resolve, 20))
          return { id: 'race:target', apiVersion: 1 }
        },
      })

      // Start install, immediately call uninstall, then wait for install to complete
      const installPromise = manager.installPlugin('race:target')
      manager.uninstallPlugin('race:target')
      await installPromise

      // Final state should be installed because the promise completed
      expect(manager.getPluginState('race:target').status).toBe('installed')
      expect(loadCount).toBe(1)

      // Subsequent uninstall marks it unloaded
      manager.uninstallPlugin('race:target')
      expect(manager.getPluginState('race:target').status).toBe('unloaded')
    })
  })

  describe('Dimension 2: Malformed Descriptors, Host Exceptions & Crash Boundaries', () => {
    it('throws validation error when registering descriptors with non-string or empty IDs', () => {
      expect(() =>
        manager.registerDescriptor({
          id: '' as any,
          name: 'Empty ID',
          loadPlugin: async () => ({ id: '', apiVersion: 1 }),
        }),
      ).toThrow('[plugin-manager] descriptor id must be a non-empty string')

      expect(() =>
        manager.registerDescriptor({
          id: null as any,
          name: 'Null ID',
          loadPlugin: async () => ({ id: '', apiVersion: 1 }),
        }),
      ).toThrow()
    })

    it('throws error when loadPlugin is not a function', () => {
      expect(() =>
        manager.registerDescriptor({
          id: 'test:no-func',
          name: 'No Func',
          loadPlugin: 'not-a-function' as any,
        }),
      ).toThrow('must provide a loadPlugin function')
    })

    it('handles loadPlugin rejecting with primitive string or non-Error object', async () => {
      manager.registerDescriptor({
        id: 'test:primitive-throw',
        name: 'Primitive Throw',
        loadPlugin: async () => {
          throw 'Critical bundle transmission failure string'
        },
      })

      let threw = false
      try {
        await manager.installPlugin('test:primitive-throw')
      } catch (err) {
        threw = true
      }

      expect(threw).toBe(true)
      const state = manager.getPluginState('test:primitive-throw')
      expect(state.status).toBe('error')
      expect(state.error).toBe('Critical bundle transmission failure string')
    })

    it('isolates panel registrar errors so that other registrars still receive the panel', async () => {
      const registrar1 = vi.fn(() => {
        throw new Error('Registrar 1 blown up')
      })
      const registrar2 = vi.fn()

      manager.setPanelRegistrar(registrar1)
      manager.setPanelRegistrar(registrar2)

      const testPanel = { id: 'panel:test', label: 'Test Panel' }
      manager.registerDescriptor({
        id: 'test:multi-reg',
        name: 'Multi Registrar',
        loadPlugin: async () => ({
          plugin: { id: 'test:multi-reg', apiVersion: 1 },
          panel: testPanel,
        }),
      })

      await manager.installPlugin('test:multi-reg')

      expect(registrar1).toHaveBeenCalledTimes(1)
      expect(registrar2).toHaveBeenCalledTimes(1)
      expect(registrar2).toHaveBeenCalledWith(testPanel)
      expect(manager.getPluginState('test:multi-reg').status).toBe('installed')
    })
  })

  describe('Dimension 3: Snapshot Referential Stability & Memory Health', () => {
    it('maintains snapshot referential cache until mutation triggers invalidation', () => {
      const s1 = manager.getSnapshot()
      const s2 = manager.getSnapshot()
      expect(s1).toBe(s2)

      manager.registerDescriptor({
        id: 'test:snap-1',
        name: 'Snap 1',
        loadPlugin: async () => ({ id: 'test:snap-1', apiVersion: 1 }),
      })

      const s3 = manager.getSnapshot()
      expect(s3).not.toBe(s1)
      expect(s3.descriptors).toHaveLength(1)

      const s4 = manager.getSnapshot()
      expect(s4).toBe(s3)
    })

    it('survives 1,000 subscribe/unsubscribe rapid cycles without listener leakage', () => {
      let callCount = 0
      const listeners: (() => void)[] = []

      for (let i = 0; i < 1000; i++) {
        const unsub = manager.subscribe(() => {
          callCount++
        })
        listeners.push(unsub)
      }

      // Unsubscribe all
      for (const unsub of listeners) {
        unsub()
      }

      // Trigger mutation
      manager.registerDescriptor({
        id: 'test:no-leak',
        name: 'No Leak',
        loadPlugin: async () => ({ id: 'test:no-leak', apiVersion: 1 }),
      })

      expect(callCount).toBe(0)
    })
  })
})
