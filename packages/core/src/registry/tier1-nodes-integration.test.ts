import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  BlockNode,
  BlockTopology,
  createBoxBlockTopology,
} from '../schema/nodes/block'
import { WallNode } from '../schema/nodes/wall'
import { SlabNode } from '../schema/nodes/slab'
import { RoofNode } from '../schema/nodes/roof'
import {
  getInspectorExtensions,
  getNodePluginId,
  getRegistryVersion,
  isNodeKindEnabled,
  loadPlugin,
  nodeRegistry,
  onRegistryChange,
  registerNode,
} from './registry'
import type { AnyNodeDefinition, Plugin } from './types'

// Bones framing schemas for LGS structural members
const LumberNodeSchema = z.object({
  id: z.string().default(() => `lumber_${Math.random().toString(36).slice(2, 9)}`),
  type: z.literal('bones:lumber').default('bones:lumber'),
  object: z.literal('node').default('node'),
  parentId: z.string().nullable().default(null),
  visible: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  size: z.enum(['2x4', '2x6', '2x8', '2x10', '2x12', '4x4', '4x6', '6x6']).default('2x4'),
  length: z.number().positive().default(2.4384),
  orientation: z.enum(['stud', 'flat', 'edge']).default('stud'),
})

const FramingNodeSchema = z.object({
  id: z.string().default(() => `framing_${Math.random().toString(36).slice(2, 9)}`),
  type: z.literal('bones:framing').default('bones:framing'),
  object: z.literal('node').default('node'),
  parentId: z.string().nullable().default(null),
  visible: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
  jurisdiction: z.string().default('AUTO'),
  detail: z.enum(['200', '300', '400']).default('200'),
  studSpacingIn: z.union([z.literal(16), z.literal(24)]).default(16),
  viewMode: z.enum(['off', 'xray', 'basement']).default('off'),
  showWalls: z.boolean().default(true),
  showFloor: z.boolean().default(true),
  showRoof: z.boolean().default(true),
  showFoundation: z.boolean().default(true),
  showElectrical: z.boolean().default(false),
  showPlumbing: z.boolean().default(false),
  showHvac: z.boolean().default(false),
})

// BlockNode definition matching @pascal-app/nodes blockDefinition
const mockBlockDefinition: AnyNodeDefinition = {
  kind: 'block',
  schemaVersion: 5,
  schema: BlockNode,
  category: 'structure',
  surfaceRole: 'wall',
  snapProfile: 'structural',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    children: [],
    position: [0, 0, 0],
    rotation: 0,
    topology: createBoxBlockTopology(),
    slots: {},
    slotNames: { body: 'Body' },
  }),
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'z'], gridSnap: true },
    duplicable: true,
    deletable: true,
    paint: { hasSlots: true },
    faceHost: true,
  },
  presentation: {
    label: 'Block',
    description: 'A topology-backed solid edited directly in the canvas.',
    icon: { kind: 'url', src: '/icons/cube.webp' },
    paletteSection: 'structure',
    paletteOrder: 75,
  },
}

// Bones framing definitions
const mockFramingDefinition: AnyNodeDefinition = {
  kind: 'bones:framing',
  schemaVersion: 1,
  schema: FramingNodeSchema,
  category: 'furnish',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    jurisdiction: 'AUTO',
    detail: '200',
    studSpacingIn: 16,
    viewMode: 'off',
    showWalls: true,
    showFloor: true,
    showRoof: true,
    showFoundation: true,
    showElectrical: false,
    showPlumbing: false,
    showHvac: false,
  }),
  capabilities: {
    selectable: false,
    movable: false,
    deletable: true,
  },
  presentation: {
    label: 'Framing System',
    paletteSection: 'structure',
    hidden: true,
  },
}

const mockLumberDefinition: AnyNodeDefinition = {
  kind: 'bones:lumber',
  schemaVersion: 1,
  schema: LumberNodeSchema,
  category: 'furnish',
  snapProfile: 'item',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: '2x4',
    length: 2.4384,
    orientation: 'stud',
  }),
  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },
  presentation: {
    label: 'Lumber',
    description: 'A piece of dimensional lumber at actual dressed size.',
    paletteSection: 'furnish',
    hidden: true,
  },
}

describe('Tier 1 Upstream Features Integration Test Suite', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  describe('a. Registration of BlockNode in NodeRegistry', () => {
    test('successfully registers BlockNode definition into nodeRegistry', () => {
      expect(nodeRegistry.has('block')).toBe(false)
      registerNode(mockBlockDefinition)

      expect(nodeRegistry.has('block')).toBe(true)
      expect(nodeRegistry.size).toBe(1)

      const def = nodeRegistry.get('block')
      expect(def).toBeDefined()
      expect(def?.kind).toBe('block')
      expect(def?.schemaVersion).toBe(5)
      expect(def?.category).toBe('structure')
      expect(def?.presentation?.label).toBe('Block')
      expect(def?.capabilities.selectable).toBeDefined()
      expect(def?.capabilities.movable).toBeDefined()
    })

    test('BlockNode defaults produce valid topology-backed geometry structure', () => {
      registerNode(mockBlockDefinition)
      const def = nodeRegistry.get('block')!
      const defaults = def.defaults() as any

      expect(defaults.topology).toBeDefined()
      expect(defaults.topology.vertices).toHaveLength(8)
      expect(defaults.topology.edges).toHaveLength(12)
      expect(defaults.topology.faces).toHaveLength(6)
      expect(defaults.slotNames).toEqual({ body: 'Body' })
      expect(defaults.slots).toEqual({})
    })

    test('BlockNode registration updates reactive registry version and fires subscribers', () => {
      let notified = 0
      const unsubscribe = onRegistryChange(() => {
        notified++
      })

      const versionBefore = getRegistryVersion()
      registerNode(mockBlockDefinition)

      expect(getRegistryVersion()).toBe(versionBefore + 1)
      expect(notified).toBe(1)
      unsubscribe()
    })
  })

  describe('b. Registration of LGS Framing (bones:framing, bones:lumber) in NodeRegistry', () => {
    test('loads Bones plugin registering framing and lumber nodes', async () => {
      const bonesPlugin: Plugin = {
        id: 'pascal:bones',
        apiVersion: 1,
        nodes: [mockFramingDefinition, mockLumberDefinition],
        inspectorExtensions: [
          {
            id: 'pascal:bones:wall-engineering',
            pluginId: 'pascal:bones',
            kinds: ['wall'],
            icon: { kind: 'url', src: '/icons/bones.webp' },
            title: 'Engineering',
            component: async () => ({ default: () => null }),
          },
        ],
      }

      await loadPlugin(bonesPlugin)

      expect(nodeRegistry.has('bones:framing')).toBe(true)
      expect(nodeRegistry.has('bones:lumber')).toBe(true)
      expect(getNodePluginId('bones:framing')).toBe('pascal:bones')
      expect(getNodePluginId('bones:lumber')).toBe('pascal:bones')

      // Verify inspector extension registration
      const wallExtensions = getInspectorExtensions('wall')
      expect(wallExtensions.some((ext) => ext.id === 'pascal:bones:wall-engineering')).toBe(true)
    })

    test('checks enabled status for bones nodes per project plugin permissions', async () => {
      await loadPlugin({
        id: 'pascal:bones',
        apiVersion: 1,
        nodes: [mockFramingDefinition, mockLumberDefinition],
      })

      // When plugin is not installed on project, external plugin kinds are disabled
      expect(isNodeKindEnabled('bones:framing', [])).toBe(false)
      expect(isNodeKindEnabled('bones:lumber', [])).toBe(false)

      // When plugin is installed on project, kinds are enabled
      expect(isNodeKindEnabled('bones:framing', ['pascal:bones'])).toBe(true)
      expect(isNodeKindEnabled('bones:lumber', ['pascal:bones'])).toBe(true)
    })
  })

  describe('c. Validation of default node structures using Zod schemas', () => {
    test('BlockNode Zod schema validates default box solid and rejects malformed topology', () => {
      const validBlock = BlockNode.parse({ name: 'Test Box' })
      expect(validBlock.type).toBe('block')
      expect(validBlock.topology.vertices).toHaveLength(8)
      expect(validBlock.topology.faces).toHaveLength(6)

      // Safe parse valid topology
      expect(BlockTopology.safeParse(validBlock.topology).success).toBe(true)

      // Mutate topology to be invalid (missing faces)
      const invalidTopology = { vertices: [], edges: [], faces: null }
      expect(BlockTopology.safeParse(invalidTopology).success).toBe(false)
    })

    test('LGS LumberNode Zod schema validates dimensional lumber properties', () => {
      const defaultLumber = LumberNodeSchema.parse({})
      expect(defaultLumber.type).toBe('bones:lumber')
      expect(defaultLumber.size).toBe('2x4')
      expect(defaultLumber.orientation).toBe('stud')
      expect(defaultLumber.length).toBeCloseTo(2.4384, 4)

      // Custom valid 2x6 plate
      const plate = LumberNodeSchema.parse({
        size: '2x6',
        length: 3.6576,
        orientation: 'flat',
      })
      expect(plate.size).toBe('2x6')
      expect(plate.orientation).toBe('flat')

      // Negative length rejected
      expect(() => LumberNodeSchema.parse({ length: -1 })).toThrow()
    })

    test('LGS FramingNode Zod schema validates framing configuration and defaults', () => {
      const framing = FramingNodeSchema.parse({})
      expect(framing.type).toBe('bones:framing')
      expect(framing.jurisdiction).toBe('AUTO')
      expect(framing.studSpacingIn).toBe(16)
      expect(framing.detail).toBe('200')
      expect(framing.viewMode).toBe('off')
      expect(framing.showWalls).toBe(true)
      expect(framing.showFloor).toBe(true)
    })

    test('Core architectural nodes (Wall, Slab, Roof) maintain integrity alongside Tier 1 nodes', () => {
      const wall = WallNode.parse({
        start: [0, 0],
        end: [10, 0],
        thickness: 0.2,
      })
      expect(wall.type).toBe('wall')
      expect(wall.thickness).toBe(0.2)

      const slab = SlabNode.parse({
        polygon: [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      })
      expect(slab.type).toBe('slab')
      expect(slab.polygon).toHaveLength(4)

      const roof = RoofNode.parse({})
      expect(roof.type).toBe('roof')
    })
  })

  describe('d. Dynamic catalog / plugin loading without crash', () => {
    test('loads multiple Tier 1 plugins simultaneously without collision or crash', async () => {
      const plugin1: Plugin = {
        id: 'pascal:core',
        apiVersion: 1,
        nodes: [mockBlockDefinition],
      }

      const plugin2: Plugin = {
        id: 'pascal:bones',
        apiVersion: 1,
        nodes: [mockFramingDefinition, mockLumberDefinition],
      }

      await loadPlugin(plugin1)
      await loadPlugin(plugin2)

      expect(nodeRegistry.size).toBe(3)
      expect(nodeRegistry.has('block')).toBe(true)
      expect(nodeRegistry.has('bones:framing')).toBe(true)
      expect(nodeRegistry.has('bones:lumber')).toBe(true)

      const allKinds = Array.from(nodeRegistry.entries(), ([k]) => k)
      expect(allKinds).toEqual(['block', 'bones:framing', 'bones:lumber'])

      const schemas = nodeRegistry.schemas()
      expect(schemas).toHaveLength(3)
    })

    test('preserves registry snapshot and supports non-destructive rollback', async () => {
      registerNode(mockBlockDefinition)
      const restoreSnapshot = nodeRegistry._snapshot()

      // Dynamically load additional plugin
      await loadPlugin({
        id: 'pascal:bones',
        apiVersion: 1,
        nodes: [mockFramingDefinition],
      })
      expect(nodeRegistry.size).toBe(2)

      // Restore snapshot
      restoreSnapshot()
      expect(nodeRegistry.size).toBe(1)
      expect(nodeRegistry.has('block')).toBe(true)
      expect(nodeRegistry.has('bones:framing')).toBe(false)
    })
  })
})
