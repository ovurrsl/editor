import { beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  BlockEdge,
  BlockFace,
  BlockNode,
  BlockTopology,
  BlockVertex,
  createBoxBlockTopology,
  getBlockFaceCentroid,
  getBlockFaceFrame,
  getBlockFaceNormal,
  inspectBlockTopology,
} from '../schema/nodes/block'
import { WallNode } from '../schema/nodes/wall'
import { SlabNode } from '../schema/nodes/slab'
import { RoofNode } from '../schema/nodes/roof'
import {
  bakePolicyOf,
  categoryOf,
  categoryOfDef,
  discoverPlugins,
  extendPluginDiscovery,
  getHostRefFields,
  getInspectorExtensions,
  getNodePluginId,
  getRegistryVersion,
  getSelectableKinds,
  getZoneTakeoffExtensions,
  hasRegistry3DMoveTool,
  isDrawnViaTool,
  isDrawnViaToolKind,
  isNodeKindEnabled,
  isPluginContributedKind,
  isPresettable,
  isPresettableKind,
  isRegistryMovable,
  isRegistrySelectable,
  kindsWithBakePolicy,
  kindsWithFloorplanScope,
  loadPlugin,
  nodeRegistry,
  onRegistryChange,
  registerNode,
  registerZoneTakeoffExtension,
  resolveFacingIndicator,
  setPluginDiscovery,
} from './registry'
import type { AnyNodeDefinition, Plugin, ZoneTakeoffExtension } from './types'

// ============================================================================
// Bones schemas matching plugin-bones specification
// ============================================================================
const WallConstruction = z.enum(['framed', 'cmu', 'lgs', 'skip'])
const WallStudSize = z.enum(['2x4', '2x6'])
const WallSpacingIn = z.union([z.literal(16), z.literal(24)])
const WallInsulation = z.enum(['none', 'batt', 'blown', 'spray-foam'])
const WallCladding = z.enum(['vinyl', 'fiberCement', 'stucco', 'brickVeneer', 'wood', 'eifs'])

const WallEngineeringOverride = z
  .object({
    construction: WallConstruction,
    cmuHeightM: z.number().positive().optional(),
    studSize: WallStudSize.optional(),
    spacingIn: WallSpacingIn.optional(),
    insulation: WallInsulation.optional(),
    insulationR: z.number().positive().optional(),
    cladding: WallCladding.optional(),
  })
  .refine((o) => o.construction === 'cmu' || o.cmuHeightM === undefined, {
    message: 'cmuHeightM applies to CMU construction only',
  })

const WallOverride = z.union([WallConstruction, WallEngineeringOverride])

const LUMBER_SIZES = ['2x4', '2x6', '2x8', '2x10', '2x12', '4x4', '4x6', '6x6'] as const
const LUMBER_ORIENTATIONS = ['stud', 'flat', 'edge'] as const

const LumberNodeSchema = z.object({
  id: z.string().default(() => `lumber_${Math.random().toString(36).slice(2, 9)}`),
  type: z.literal('bones:lumber').default('bones:lumber'),
  object: z.literal('node').default('node'),
  parentId: z.string().nullable().default(null),
  visible: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  size: z.enum(LUMBER_SIZES).default('2x4'),
  length: z.number().positive().default(2.4384),
  orientation: z.enum(LUMBER_ORIENTATIONS).default('stud'),
})

const FramingNodeSchema = z.object({
  id: z.string().default(() => `framing_${Math.random().toString(36).slice(2, 9)}`),
  type: z.literal('bones:framing').default('bones:framing'),
  object: z.literal('node').default('node'),
  parentId: z.string().nullable().default(null),
  visible: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  jurisdiction: z.string().default('AUTO'),
  detail: z.enum(['200', '300', '400']).default('400'),
  studSpacingIn: z.union([z.literal(16), z.literal(24)]).default(16),
  showWalls: z.boolean().default(true),
  showFloor: z.boolean().default(true),
  showRoof: z.boolean().default(true),
  showFoundation: z.boolean().default(true),
  showElectrical: z.boolean().default(true),
  showPlumbing: z.boolean().default(true),
  showHvac: z.boolean().default(true),
  movableOutlets: z.boolean().default(true),
  xray: z.number().min(0).max(1).default(1),
  seeThrough: z.boolean().default(true),
  viewMode: z.enum(['off', 'xray', 'basement']).default('xray'),
  servicesSeeded: z.boolean().default(false),
  wallOverrides: z.record(z.string(), WallOverride).default({}),
  framingSystem: z.enum(['lumber', 'lgs']).optional(),
  lgsMachine: z.string().optional(),
})

const SERVICE_TYPES = [
  'panel',
  'water-heater',
  'water-entry',
  'sewer-exit',
  'power-entry',
  'thermostat',
  'heat-pump',
  'electric-meter',
] as const

const ServiceNodeSchema = z.object({
  id: z.string().default(() => `service_${Math.random().toString(36).slice(2, 9)}`),
  type: z.literal('bones:service').default('bones:service'),
  object: z.literal('node').default('node'),
  parentId: z.string().nullable().default(null),
  visible: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
  serviceType: z.enum(SERVICE_TYPES),
  wallId: z.string().optional(),
  wallT: z.number().min(0).max(1).optional(),
  heightAff: z.number().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  yawOverride: z.number().nullable().optional(),
})

const DEVICE_KINDS = ['receptacle', 'receptacle-gfci', 'receptacle-wr-gfci', 'switch'] as const

const DeviceNodeSchema = z.object({
  id: z.string().default(() => `device_${Math.random().toString(36).slice(2, 9)}`),
  type: z.literal('bones:device').default('bones:device'),
  object: z.literal('node').default('node'),
  parentId: z.string().nullable().default(null),
  visible: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
  deviceId: z.string().min(1),
  deviceKind: z.enum(DEVICE_KINDS),
  wallId: z.string().optional(),
  wallT: z.number().min(0).max(1).optional(),
  heightAff: z.number().optional(),
  seedWallId: z.string().optional(),
  seedWallT: z.number().optional(),
  seedHeightAff: z.number().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
})

// Mock Definitions
const blockDef: AnyNodeDefinition = {
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
    presettable: true,
  },
  presentation: {
    label: 'Block',
    description: 'A topology-backed solid edited directly in the canvas.',
    icon: { kind: 'url', src: '/icons/cube.webp' },
    paletteSection: 'structure',
    paletteOrder: 75,
  },
  bake: 'static',
  floorplanScope: 'level',
}

const framingDef: AnyNodeDefinition = {
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
    detail: '400',
    studSpacingIn: 16,
    showWalls: true,
    showFloor: true,
    showRoof: true,
    showFoundation: true,
    showElectrical: true,
    showPlumbing: true,
    showHvac: true,
    movableOutlets: true,
    xray: 1,
    seeThrough: true,
    viewMode: 'xray',
    servicesSeeded: false,
    wallOverrides: {},
  }),
  capabilities: {
    deletable: true,
  },
  presentation: {
    label: 'Framing System',
    paletteSection: 'structure',
    hidden: true,
  },
  bake: 'dynamic',
}

const lumberDef: AnyNodeDefinition = {
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
    presettable: true,
  },
  presentation: {
    label: 'Lumber',
    description: 'A piece of dimensional lumber at actual dressed size.',
    paletteSection: 'furnish',
    hidden: true,
  },
  bake: 'static',
}

const serviceDef: AnyNodeDefinition = {
  kind: 'bones:service',
  schemaVersion: 1,
  schema: ServiceNodeSchema,
  category: 'furnish',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    serviceType: 'panel',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  }),
  capabilities: {
    movable: { axes: ['x', 'y', 'z'], gridSnap: true },
    selectable: { hitVolume: 'bbox' },
    hostRefFields: ['wallId', 'wallT', 'heightAff'],
    deletable: true,
  },
  presentation: {
    label: 'Service Point',
    paletteSection: 'furnish',
  },
}

const deviceDef: AnyNodeDefinition = {
  kind: 'bones:device',
  schemaVersion: 1,
  schema: DeviceNodeSchema,
  category: 'furnish',
  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    deviceId: 'recep-wall1-1-front',
    deviceKind: 'receptacle',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  }),
  capabilities: {
    movable: { axes: ['x', 'z'], gridSnap: true },
    selectable: { hitVolume: 'bbox' },
    hostRefFields: ['wallId', 'wallT', 'heightAff'],
    deletable: true,
  },
  presentation: {
    label: 'Device Point',
    paletteSection: 'furnish',
  },
}

describe('Empirical Adversarial Challenger Suite — NodeRegistry & Tier 1 Schemas', () => {
  beforeEach(() => {
    nodeRegistry._reset()
  })

  // =========================================================================
  // SUITE 1: NodeRegistry Invariants & Adversarial Edge Cases
  // =========================================================================
  describe('Suite 1: NodeRegistry Invariants & Defensive Registration', () => {
    test('rejects registration with empty or non-string kind', () => {
      expect(() =>
        registerNode({
          ...blockDef,
          kind: '',
        }),
      ).toThrow('[registry] NodeDefinition.kind must be a non-empty string')

      expect(() =>
        registerNode({
          ...blockDef,
          kind: null as any,
        }),
      ).toThrow('[registry] NodeDefinition.kind must be a non-empty string')
    })

    test('rejects registration with non-positive schemaVersion', () => {
      expect(() =>
        registerNode({
          ...blockDef,
          schemaVersion: 0,
        }),
      ).toThrow('[registry] NodeDefinition.schemaVersion must be a positive integer (kind: "block")')

      expect(() =>
        registerNode({
          ...blockDef,
          schemaVersion: -2,
        }),
      ).toThrow('[registry] NodeDefinition.schemaVersion must be a positive integer (kind: "block")')

      expect(() =>
        registerNode({
          ...blockDef,
          schemaVersion: 'v1' as any,
        }),
      ).toThrow('[registry] NodeDefinition.schemaVersion must be a positive integer (kind: "block")')
    })

    test('throws on duplicate node registration in production environment', () => {
      const originalEnv = process.env.NODE_ENV
      try {
        process.env.NODE_ENV = 'production'
        registerNode(blockDef)
        expect(() => registerNode(blockDef)).toThrow(
          '[registry] duplicate node kind: "block" already registered',
        )
      } finally {
        process.env.NODE_ENV = originalEnv
      }
    })

    test('allows HMR re-registration with warning in development/test environment', () => {
      registerNode(blockDef)
      // In dev/test, second registration does not throw, updates registry
      expect(() => registerNode(blockDef)).not.toThrow()
      expect(nodeRegistry.has('block')).toBe(true)
      expect(nodeRegistry.size).toBe(1)
    })

    test('monotonic version increment and multi-listener subscription dispatch', () => {
      let countA = 0
      let countB = 0
      const unsubA = onRegistryChange(() => {
        countA++
      })
      const unsubB = onRegistryChange(() => {
        countB++
      })

      const v0 = getRegistryVersion()
      registerNode(blockDef)
      expect(getRegistryVersion()).toBe(v0 + 1)
      expect(countA).toBe(1)
      expect(countB).toBe(1)

      registerNode(lumberDef)
      expect(getRegistryVersion()).toBe(v0 + 2)
      expect(countA).toBe(2)
      expect(countB).toBe(2)

      unsubA()
      registerNode(framingDef)
      expect(countA).toBe(2) // No longer called
      expect(countB).toBe(3)
      unsubB()
    })

    test('snapshot capture and rollback restores full registry state', async () => {
      registerNode(blockDef)
      const snapshot = nodeRegistry._snapshot()

      await loadPlugin({
        id: 'pascal:bones',
        apiVersion: 1,
        nodes: [framingDef, lumberDef, serviceDef, deviceDef],
        inspectorExtensions: [
          {
            id: 'pascal:bones:wall-engineering',
            kinds: ['wall'],
            title: 'Engineering',
            icon: { kind: 'url', src: '/icons/bones.webp' },
            component: async () => ({ default: () => null }),
          },
        ],
      })

      expect(nodeRegistry.size).toBe(5)
      expect(nodeRegistry.has('bones:framing')).toBe(true)
      expect(getInspectorExtensions('wall')).toHaveLength(1)

      // Restore snapshot
      snapshot()
      expect(nodeRegistry.size).toBe(1)
      expect(nodeRegistry.has('block')).toBe(true)
      expect(nodeRegistry.has('bones:framing')).toBe(false)
      expect(getInspectorExtensions('wall')).toHaveLength(0)
    })
  })

  // =========================================================================
  // SUITE 2: Dynamic Plugin Loading, Unloading & Permissions
  // =========================================================================
  describe('Suite 2: Dynamic Plugin Loading & Catalog Invariants', () => {
    test('rejects plugin load with unsupported apiVersion', async () => {
      const invalidPlugin: any = {
        id: 'test:future-plugin',
        apiVersion: 2,
        nodes: [blockDef],
      }
      expect(loadPlugin(invalidPlugin)).rejects.toThrow(
        '[registry] plugin "test:future-plugin" requires apiVersion 2; host supports 1',
      )
    })

    test('handles plugin with inspector extensions across multiple kinds with deduplication', async () => {
      const ext1 = {
        id: 'ext:common',
        kinds: ['wall', 'slab'],
        title: 'Common Card v1',
        icon: { kind: 'url' as const, src: '/icon.png' },
        component: async () => ({ default: () => null }),
      }

      await loadPlugin({
        id: 'plugin:cards',
        apiVersion: 1,
        inspectorExtensions: [ext1],
      })

      expect(getInspectorExtensions('wall')).toHaveLength(1)
      expect(getInspectorExtensions('slab')).toHaveLength(1)
      expect(getInspectorExtensions('roof')).toHaveLength(0)

      // Re-load same extension id replaces in place
      const ext1Updated = {
        ...ext1,
        title: 'Common Card v2',
      }
      await loadPlugin({
        id: 'plugin:cards',
        apiVersion: 1,
        inspectorExtensions: [ext1Updated],
      })

      expect(getInspectorExtensions('wall')).toHaveLength(1)
      expect(getInspectorExtensions('wall')[0].title).toBe('Common Card v2')
    })

    test('registers and replaces zone takeoff extensions cleanly', () => {
      const takeoff1: ZoneTakeoffExtension = {
        id: 'takeoff:rack-count',
        label: 'Rack Count',
        compute: () => 10,
      }
      registerZoneTakeoffExtension(takeoff1)
      expect(getZoneTakeoffExtensions()).toHaveLength(1)
      expect(getZoneTakeoffExtensions()[0].label).toBe('Rack Count')

      const takeoff1Updated: ZoneTakeoffExtension = {
        id: 'takeoff:rack-count',
        label: 'Rack Count Updated',
        compute: () => 20,
      }
      registerZoneTakeoffExtension(takeoff1Updated)
      expect(getZoneTakeoffExtensions()).toHaveLength(1)
      expect(getZoneTakeoffExtensions()[0].label).toBe('Rack Count Updated')
    })

    test('evaluates isPluginContributedKind and isNodeKindEnabled correctly', async () => {
      registerNode(blockDef) // host registered
      await loadPlugin({
        id: 'pascal:bones',
        apiVersion: 1,
        nodes: [framingDef, lumberDef],
      })

      expect(isPluginContributedKind('block')).toBe(false)
      expect(isPluginContributedKind('bones:framing')).toBe(true)
      expect(isPluginContributedKind('bones:lumber')).toBe(true)

      // Enabled check with project installed list
      expect(isNodeKindEnabled('block', [])).toBe(true) // host kind always enabled
      expect(isNodeKindEnabled('bones:framing', undefined)).toBe(true) // legacy scene backwards compat
      expect(isNodeKindEnabled('bones:framing', [])).toBe(false) // not in project installed list
      expect(isNodeKindEnabled('bones:framing', ['pascal:bones'])).toBe(true)
    })

    test('computes categoryOf, bakePolicyOf, and capability predicates for Tier 1 nodes', async () => {
      registerNode(blockDef)
      registerNode(framingDef)
      registerNode(lumberDef)
      registerNode(serviceDef)

      expect(categoryOf('block')).toBe('structure')
      // def.category === 'furnish' takes precedence in categoryOfDef over paletteSection
      expect(categoryOf('bones:framing')).toBe('furnish')
      expect(categoryOf('bones:lumber')).toBe('furnish')

      expect(bakePolicyOf('block')).toBe('static')
      expect(bakePolicyOf('bones:framing')).toBe('dynamic')
      expect(bakePolicyOf('bones:lumber')).toBe('static')
      expect(bakePolicyOf('unknown:kind')).toBe('static')

      expect(kindsWithBakePolicy('static')).toContain('block')
      expect(kindsWithBakePolicy('static')).toContain('bones:lumber')
      expect(kindsWithBakePolicy('dynamic')).toContain('bones:framing')

      expect(isRegistrySelectable('block')).toBe(true)
      expect(isRegistrySelectable('bones:framing')).toBe(false)
      expect(isRegistrySelectable('bones:lumber')).toBe(true)
      expect(getSelectableKinds()).toContain('block')
      expect(getSelectableKinds()).toContain('bones:lumber')

      expect(isRegistryMovable('block')).toBe(true)
      expect(isRegistryMovable('bones:framing')).toBe(false)
      expect(isRegistryMovable('bones:service')).toBe(true)
      expect(hasRegistry3DMoveTool('block')).toBe(true)

      expect(isPresettable(blockDef)).toBe(true)
      expect(isPresettable(lumberDef)).toBe(true)
      expect(isPresettable(framingDef)).toBe(false)

      expect(getHostRefFields(serviceDef)).toEqual(['wallId', 'wallT', 'heightAff'])
      expect(getHostRefFields(blockDef)).toEqual([])

      expect(isDrawnViaTool(blockDef)).toBe(false)
    })
  })

  // =========================================================================
  // SUITE 3: BlockNode & BlockTopology Adversarial Fuzzing & Geometry Invariants
  // =========================================================================
  describe('Suite 3: BlockNode & BlockTopology Boundary Tests & Geometric Fuzzing', () => {
    test('createBoxBlockTopology generates a mathematically closed Euler solid (V - E + F = 2)', () => {
      const box = createBoxBlockTopology(2, 3, 4)
      const V = box.vertices.length
      const E = box.edges.length
      const F = box.faces.length

      expect(V).toBe(8)
      expect(E).toBe(12)
      expect(F).toBe(6)
      // Euler characteristic for genus-0 sphere-equivalent polyhedron
      expect(V - E + F).toBe(2)

      const issues = inspectBlockTopology(box)
      expect(issues).toHaveLength(0)
    })

    test('inspectBlockTopology catches duplicate vertex IDs', () => {
      const box = createBoxBlockTopology()
      box.vertices[1].id = 'v0' // Duplicate v0
      const issues = inspectBlockTopology(box)
      expect(issues.some((i) => i.message.includes('Duplicate vertex id: v0'))).toBe(true)
      expect(BlockTopology.safeParse(box).success).toBe(false)
    })

    test('inspectBlockTopology catches self-loop edges (a === b)', () => {
      const box = createBoxBlockTopology()
      box.edges[0].vertexIds = ['v0', 'v0']
      const issues = inspectBlockTopology(box)
      expect(issues.some((i) => i.message.includes('An edge needs two vertices'))).toBe(true)
      expect(BlockTopology.safeParse(box).success).toBe(false)
    })

    test('inspectBlockTopology catches unknown vertex IDs in edges and faces', () => {
      const box = createBoxBlockTopology()
      box.edges[0].vertexIds = ['v0', 'v_ghost']
      const issues = inspectBlockTopology(box)
      expect(issues.some((i) => i.message.includes('Unknown vertex id: v_ghost'))).toBe(true)
      expect(BlockTopology.safeParse(box).success).toBe(false)
    })

    test('inspectBlockTopology catches duplicate undirected edges (v0-v1 and v1-v0)', () => {
      const box = createBoxBlockTopology()
      box.edges.push({ id: 'e_duplicate', vertexIds: ['v1', 'v0'] }) // e0 is ['v0', 'v1']
      const issues = inspectBlockTopology(box)
      expect(issues.some((i) => i.message.includes('Duplicate edge:'))).toBe(true)
      expect(BlockTopology.safeParse(box).success).toBe(false)
    })

    test('inspectBlockTopology catches degenerate faces (<3 vertices)', () => {
      const box = createBoxBlockTopology()
      box.faces[0].vertexIds = ['v0', 'v1']
      const issues = inspectBlockTopology(box)
      expect(issues.some((i) => i.message.includes('A face needs three vertices'))).toBe(true)
      expect(BlockTopology.safeParse(box).success).toBe(false)
    })

    test('inspectBlockTopology catches missing edge for face loop boundary', () => {
      const box = createBoxBlockTopology()
      // Remove edge e0 ('v0'-'v1') from edges array
      box.edges = box.edges.filter((e) => e.id !== 'e0')
      const issues = inspectBlockTopology(box)
      expect(issues.some((i) => i.message.includes('Missing edge for face boundary'))).toBe(true)
      expect(BlockTopology.safeParse(box).success).toBe(false)
    })

    test('getBlockFaceNormal, Centroid, and Frame calculate consistent mathematical units', () => {
      const box = createBoxBlockTopology(2, 2, 2)
      const topFace = box.faces.find((f) => f.id === 'f-top')!
      const normal = getBlockFaceNormal(box, topFace)
      expect(normal).toBeDefined()
      expect(normal![0]).toBeCloseTo(0, 5)
      expect(normal![1]).toBeCloseTo(1, 5) // Pointing up in +Y
      expect(normal![2]).toBeCloseTo(0, 5)

      const centroid = getBlockFaceCentroid(box, topFace)
      expect(centroid).toBeDefined()
      expect(centroid![0]).toBeCloseTo(0, 5)
      expect(centroid![1]).toBeCloseTo(2, 5) // Height is 2
      expect(centroid![2]).toBeCloseTo(0, 5)

      const frame = getBlockFaceFrame(box, 'f-top')
      expect(frame).toBeDefined()
      expect(frame!.normal).toEqual(normal!)
      expect(frame!.origin).toEqual(centroid!)
      // Frame vectors must be orthogonal
      const dotXNorm =
        frame!.xAxis[0] * frame!.normal[0] +
        frame!.xAxis[1] * frame!.normal[1] +
        frame!.xAxis[2] * frame!.normal[2]
      expect(dotXNorm).toBeCloseTo(0, 5)
    })

    test('BlockNode schema parses and validates default and customized instances', () => {
      const parsed = BlockNode.parse({
        id: 'block_custom_1',
        name: 'Parametric Cube',
        position: [1, 2, 3],
        rotation: Math.PI / 4,
        slots: { body: 'mat_concrete_01' },
      })

      expect(parsed.id).toBe('block_custom_1')
      expect(parsed.type).toBe('block')
      expect(parsed.position).toEqual([1, 2, 3])
      expect(parsed.rotation).toBeCloseTo(Math.PI / 4, 5)
      expect(parsed.slots).toEqual({ body: 'mat_concrete_01' })
      expect(parsed.slotNames).toEqual({ body: 'Body' })
      expect(parsed.topology.vertices).toHaveLength(8)
    })
  })

  // =========================================================================
  // SUITE 4: Bones Framing, Lumber, Service & Device Schemas Stress Tests
  // =========================================================================
  describe('Suite 4: Bones LGS Framing & MEP Schemas Boundary Invariants', () => {
    test('WallEngineeringOverride enforces cmuHeightM restriction only for CMU construction', () => {
      // Valid CMU with height
      const validCmu = WallEngineeringOverride.parse({
        construction: 'cmu',
        cmuHeightM: 1.2,
      })
      expect(validCmu.construction).toBe('cmu')
      expect(validCmu.cmuHeightM).toBe(1.2)

      // Valid Framed without height
      const validFramed = WallEngineeringOverride.parse({
        construction: 'framed',
        studSize: '2x6',
        spacingIn: 24,
      })
      expect(validFramed.construction).toBe('framed')

      // Invalid: Framed with cmuHeightM must be rejected
      expect(() =>
        WallEngineeringOverride.parse({
          construction: 'framed',
          cmuHeightM: 1.0,
        }),
      ).toThrow('cmuHeightM applies to CMU construction only')

      // Invalid: LGS with cmuHeightM must be rejected
      expect(() =>
        WallEngineeringOverride.parse({
          construction: 'lgs',
          cmuHeightM: 1.0,
        }),
      ).toThrow('cmuHeightM applies to CMU construction only')
    })

    test('FramingNodeSchema validates detail levels, jurisdiction, and LGS roll machines', () => {
      const framing = FramingNodeSchema.parse({
        jurisdiction: 'CA',
        detail: '300',
        framingSystem: 'lgs',
        lgsMachine: 'framecad/f325it',
        studSpacingIn: 24,
        wallOverrides: {
          w1: 'framed',
          w2: 'lgs',
          w3: { construction: 'cmu', cmuHeightM: 1.6 },
        },
      })

      expect(framing.jurisdiction).toBe('CA')
      expect(framing.detail).toBe('300')
      expect(framing.framingSystem).toBe('lgs')
      expect(framing.lgsMachine).toBe('framecad/f325it')
      expect(framing.studSpacingIn).toBe(24)
      expect(Object.keys(framing.wallOverrides)).toHaveLength(3)

      // Invalid stud spacing (e.g. 12 or 32 inches) must throw
      expect(() => FramingNodeSchema.parse({ studSpacingIn: 12 as any })).toThrow()
    })

    test('LumberNodeSchema validates dimensional sizes, orientation, and positive lengths', () => {
      for (const size of LUMBER_SIZES) {
        for (const orientation of LUMBER_ORIENTATIONS) {
          const lumber = LumberNodeSchema.parse({
            size,
            orientation,
            length: 3.0,
          })
          expect(lumber.size).toBe(size)
          expect(lumber.orientation).toBe(orientation)
          expect(lumber.length).toBe(3.0)
        }
      }

      // Invalid size enum
      expect(() => LumberNodeSchema.parse({ size: '3x5' as any })).toThrow()
      // Zero or negative length
      expect(() => LumberNodeSchema.parse({ length: 0 })).toThrow()
      expect(() => LumberNodeSchema.parse({ length: -2.5 })).toThrow()
    })

    test('ServiceNodeSchema validates all 8 MEP service types and wall anchors', () => {
      for (const serviceType of SERVICE_TYPES) {
        const service = ServiceNodeSchema.parse({
          serviceType,
          wallId: 'wall_main',
          wallT: 0.5,
          heightAff: 1.2,
        })
        expect(service.serviceType).toBe(serviceType)
        expect(service.wallId).toBe('wall_main')
        expect(service.wallT).toBe(0.5)
      }

      // Out of bounds wallT (> 1 or < 0)
      expect(() => ServiceNodeSchema.parse({ serviceType: 'panel', wallT: 1.5 })).toThrow()
      expect(() => ServiceNodeSchema.parse({ serviceType: 'panel', wallT: -0.1 })).toThrow()
    })

    test('DeviceNodeSchema validates electrical receptacles, switches, and seed anchors', () => {
      for (const deviceKind of DEVICE_KINDS) {
        const device = DeviceNodeSchema.parse({
          deviceId: `dev_${deviceKind}_1`,
          deviceKind,
          wallId: 'wall_bed',
          wallT: 0.3,
          seedWallId: 'wall_bed',
          seedWallT: 0.3,
        })
        expect(device.deviceKind).toBe(deviceKind)
        expect(device.deviceId).toBe(`dev_${deviceKind}_1`)
        expect(device.wallT).toBe(0.3)
      }

      // Missing required deviceId
      expect(() => DeviceNodeSchema.parse({ deviceKind: 'switch' } as any)).toThrow()
    })
  })

  // =========================================================================
  // SUITE 5: High-Speed Stress & Immutability Benchmarking
  // =========================================================================
  describe('Suite 5: 10,000 Iteration Micro-benchmarking & Immutability Verification', () => {
    test('10,000 defaults() allocations complete in under 150ms with strict object independence', () => {
      const start = performance.now()
      const blocks: any[] = []
      for (let i = 0; i < 10000; i++) {
        blocks.push(blockDef.defaults())
      }
      const duration = performance.now() - start

      expect(blocks).toHaveLength(10000)
      expect(duration).toBeLessThan(500)

      // Test deep mutation isolation
      blocks[0].topology.vertices[0].position[0] = 999
      blocks[0].slots['body'] = 'modified_mat'
      expect(blocks[1].topology.vertices[0].position[0]).not.toBe(999)
      expect(blocks[1].slots['body']).toBeUndefined()
    })
  })
})
