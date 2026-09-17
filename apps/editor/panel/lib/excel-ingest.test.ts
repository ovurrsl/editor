import { describe, expect, test, beforeEach } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as XLSX from 'xlsx'
import {
  parseWarehouseExcel,
  parseWarehouseExcelBuffer,
  parseWarehouseExcelFromBuffer,
  applyExcelLayoutToScene,
  seedLocationsFromExcel,
  formatIndustrialAddress,
  generateBarcode,
  levelToLetter,
  LEVEL_LETTERS,
  type WarehouseLayoutResult,
  type ParsedAisleRun,
  type ParsedLocation,
} from './excel-ingest'
import { getMemoryStore, setMemoryStore } from '../../app/api/locations/route'
import type { PalletRackNode } from '@ovurrsl/plugin-warehouse'

const REAL_EXCEL_PATH = 'C:/Users/resul.ovur/Desktop/Depo Layout 10.09.2026.xlsx'
const REAL_SCENE_PATH = 'C:/Users/resul.ovur/Desktop/layout_2026-09-11.json'
const hasRealExcel = fs.existsSync(REAL_EXCEL_PATH)
const hasRealScene = fs.existsSync(REAL_SCENE_PATH)

// ============================================================================
// SYNTHETIC IN-MEMORY WORKBOOK BUILDER FOR CI & REPEATABLE UNIT TESTS
// ============================================================================

/** Builds an in-memory synthetic Excel workbook buffer matching the real layout structure */
function createSyntheticExcelBuffer(options?: {
  omitSayfa1?: boolean
  includeInactiveCXCY?: boolean
  includeAisleAnnotations?: boolean
}): Buffer {
  const wb = XLSX.utils.book_new()
  const sheetName = options?.omitSayfa1 ? 'Sheet1' : 'Sayfa1'
  const data: (string | number | null)[][] = Array.from({ length: 50 }, () => Array(190).fill(null))

  // Summary headers in row 1 & row 2
  data[0]![2] = 'TCA'
  data[0]![3] = 'Ambient'
  data[0]![4] = 'Brüt'
  data[1]![2] = 11694
  data[1]![3] = 45240
  data[1]![4] = 56934

  // Col G (index 6 in 0-based SheetJS, Col 7 in 1-based Excel): PL rack run
  data[0]![6] = 'PL'
  data[1]![6] = 126
  data[2]![6] = 6
  data[3]![6] = 7

  // Col I (index 8 in 0-based SheetJS, Col 9 in 1-based Excel): 1L
  data[0]![8] = '1L'
  data[1]![8] = 576
  data[2]![8] = 32
  data[3]![8] = 6
  data[4]![8] = '1L'
  data[5]![8] = 'TCA'
  data[7]![8] = 'A'
  for (let r = 11; r < 43; r++) data[r]![8] = 1

  // Col K (index 10 in 0-based SheetJS, Col 11 in 1-based Excel): 1R
  data[0]![10] = '1R'
  data[1]![10] = 768
  data[2]![10] = 32
  data[3]![10] = 8
  data[4]![10] = '1R'
  data[7]![10] = 'B'
  for (let r = 11; r < 43; r++) data[r]![10] = 1

  // Col AA (index 26): 06L (zero-padded)
  data[0]![26] = '6L'
  data[1]![26] = 768
  data[2]![26] = 32
  data[3]![26] = 8
  data[4]![26] = '06L'
  data[7]![26] = 'B'
  for (let r = 11; r < 43; r++) data[r]![26] = 1

  // Col AG (index 32): TCL (renamed TCA Left)
  data[0]![32] = '8L'
  data[1]![32] = 768
  data[2]![32] = 32
  data[3]![32] = 8
  data[4]![32] = 'TCL'
  data[7]![32] = 'B'
  for (let r = 11; r < 43; r++) data[r]![32] = 1

  // Col FY (index 180): 52R (terminal 9-level run)
  data[0]![180] = '52R'
  data[1]![180] = 432
  data[2]![180] = 16
  data[3]![180] = 9
  data[4]![180] = '52R'
  data[5]![180] = 'Ambient'
  data[7]![180] = 'C'
  for (let r = 11; r < 27; r++) data[r]![180] = 1

  // Inactive Columns CX (101 in 0-based, Col 102 in 1-based) and CY (102 in 0-based, Col 103 in 1-based)
  if (options?.includeInactiveCXCY) {
    data[1]![101] = 72
    data[2]![101] = 24
    data[3]![101] = 1
    data[4]![101] = '28L'
    data[1]![102] = 72
    data[2]![102] = 24
    data[3]![102] = 1
    data[4]![102] = '28R'
    // rows 11..42 remain null (0 active bays)
  }

  // Driving aisle text annotations without aisle headers (e.g. Col 96 CR)
  if (options?.includeAisleAnnotations) {
    data[15]![95] = '180 Kuru Toplama'
    data[18]![107] = 'PET CARE TOPLAMA '
  }

  const ws = XLSX.utils.aoa_to_sheet(data)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

/** Builds a mock scene graph of PalletRackNode instances */
function createMockSceneGraph(): {
  nodes: Record<string, PalletRackNode>
  rackRuns: PalletRackNode[][]
} {
  const nodes: Record<string, PalletRackNode> = {}
  const rackRuns: PalletRackNode[][] = []

  // 103 Parallel Aisle Runs along X
  for (let line = 0; line < 103; line++) {
    const run: PalletRackNode[] = []
    const xCoord = -132.0 + line * 2.4
    const bayCount = line < 35 ? 32 : line < 60 ? 24 : 16

    for (let bay = 0; bay < bayCount; bay++) {
      const id = `rack_node_line${line}_bay${bay}`
      const zCoord = -26.0 + bay * 2.8
      const node: PalletRackNode = {
        object: 'node',
        id,
        type: 'warehouse:pallet-rack',
        parentId: 'level_0',
        visible: true,
        metadata: {},
        position: [xCoord, 0, zCoord],
        rotation: [0, 4.71238898, 0],
        rowLabel: '',
        bayIndex: 1,
        zoneCode: '',
        accessMode: 'single-face',
        levels: 6,
        bayClearWidth: 2.73,
        depth: 1.1,
        uprightHeight: 15,
        depthPositions: 1,
        uprightColor: '#00e1ff',
        beamColor: '#f97316',
      } as unknown as PalletRackNode
      nodes[id] = node
      run.push(node)
    }
    rackRuns.push(run)
  }

  // 1 Transversal Run for PL (6 bays, rotation = 0)
  const plRun: PalletRackNode[] = []
  for (let bay = 0; bay < 6; bay++) {
    const id = `rack_node_pl_bay${bay}`
    const node: PalletRackNode = {
      object: 'node',
      id,
      type: 'warehouse:pallet-rack',
      parentId: 'level_0',
      visible: true,
      metadata: {},
      position: [0, 0, -35.0 + bay * 2.8],
      rotation: [0, 0, 0],
      rowLabel: '',
      bayIndex: 1,
      zoneCode: '',
      accessMode: 'single-face',
      levels: 7,
      bayClearWidth: 2.73,
      depth: 1.1,
      uprightHeight: 15,
      depthPositions: 1,
    } as unknown as PalletRackNode
    nodes[id] = node
    plRun.push(node)
  }
  rackRuns.push(plRun)

  return { nodes, rackRuns }
}

// ============================================================================
// AUTOMATED TEST SUITE EXECUTION
// ============================================================================

describe('Excel Address Ingestion Engine (Milestone M1)', () => {
  beforeEach(() => {
    setMemoryStore([] as any)
  })

  // --------------------------------------------------------------------------
  // 1. HAPPY PATH: REAL EXCEL FILE INGESTION
  // --------------------------------------------------------------------------
  describe('1. Happy Path: Real Warehouse Excel Parsing (Depo Layout 10.09.2026.xlsx)', () => {
    test.skipIf(!hasRealExcel)('1.1 loads and parses Sayfa1 worksheet successfully', () => {
      const layout = parseWarehouseExcel(REAL_EXCEL_PATH)
      expect(layout).toBeDefined()
      expect(layout.sheetName).toBe('Sayfa1')
      expect(layout.facilityName).toBe('Bursa')
      expect(layout.siteName).toBe('Bursa Depo')
    })

    test.skipIf(!hasRealExcel)('1.2 extracts exactly 103 active rack runs (102 aisle runs + 1 PL run)', () => {
      const layout = parseWarehouseExcel(REAL_EXCEL_PATH)
      expect(layout.runs).toHaveLength(103)
      expect(layout.totalAisles).toBe(103)

      const plRun = layout.runs.find((r) => r.aisleCode === 'PL' || r.legacyCode === 'PL')
      expect(plRun).toBeDefined()
      expect(plRun?.modules).toBe(6)
      expect(plRun?.levels).toBe(7)
      expect(plRun?.totalPallets).toBe(126)
      expect(plRun?.activeBays).toHaveLength(6)

      const aisleRuns = layout.runs.filter((r) => r.aisleCode !== 'PL' && r.legacyCode !== 'PL')
      expect(aisleRuns).toHaveLength(102)
    })

    test.skipIf(!hasRealExcel)('1.3 verifies total pallet capacity invariant (active: 56,790, gross: 56,934)', () => {
      const layout = parseWarehouseExcel(REAL_EXCEL_PATH)
      expect(layout.grossPallets).toBe(56934)
      expect(layout.totalPallets).toBe(56790)

      const computedPallets = layout.runs.reduce((acc, r) => acc + r.totalPallets, 0)
      expect(computedPallets).toBe(56790)
    })

    test.skipIf(!hasRealExcel)('1.4 verifies correct zone breakdown (TCA: 11,694, Ambient + Pet Care: 45,096)', () => {
      const layout = parseWarehouseExcel(REAL_EXCEL_PATH)
      const tcaPallets = layout.runs
        .filter((r) => r.zone === 'TCA')
        .reduce((acc, r) => acc + r.totalPallets, 0)
      expect(tcaPallets).toBe(11694)

      const ambientPallets = layout.runs
        .filter((r) => r.zone === 'Ambient' || r.zone === 'Pet Care')
        .reduce((acc, r) => acc + r.totalPallets, 0)
      expect(ambientPallets).toBe(45096)

      const petCareRun = layout.runs.find((r) => r.zone === 'Pet Care')
      expect(petCareRun).toBeDefined()
      expect(layout.summaryByZone.TCA).toBeDefined()
      expect(layout.summaryByZone.TCA.pallets).toBe(11694)
      expect(layout.summaryByZone['Pet Care']).toBeDefined()
    })

    test.skipIf(!hasRealExcel)('1.5 verifies modern aisle labels (06L, 06R, 07L, 07R, TCL, TCR, 52R)', () => {
      const layout = parseWarehouseExcel(REAL_EXCEL_PATH)
      const codes = layout.runs.map((r) => r.aisleCode)

      expect(codes).toContain('06L')
      expect(codes).toContain('06R')
      expect(codes).toContain('07L')
      expect(codes).toContain('07R')
      expect(codes).toContain('TCL')
      expect(codes).toContain('TCR')
      expect(codes).toContain('52R')

      // Legacy codes preserved in metadata
      const tcl = layout.runs.find((r) => r.aisleCode === 'TCL')
      expect(tcl?.legacyCode).toBe('8L')
      const tcr = layout.runs.find((r) => r.aisleCode === 'TCR')
      expect(tcr?.legacyCode).toBe('8R')
    })

    test.skipIf(!hasRealExcel)('1.6 extracts rack types (A, B, C, D) and level counts (6, 8, 9, 7)', () => {
      const layout = parseWarehouseExcel(REAL_EXCEL_PATH)
      const typeA = layout.runs.find((r) => r.rackType === 'A')
      expect(typeA).toBeDefined()
      expect(typeA?.levels).toBe(6)

      const typeB = layout.runs.find((r) => r.rackType === 'B')
      expect(typeB).toBeDefined()
      expect(typeB?.levels).toBe(8)

      const typeC = layout.runs.find((r) => r.rackType === 'C')
      expect(typeC).toBeDefined()
      expect(typeC?.levels).toBe(9)

      const pl = layout.runs.find((r) => r.aisleCode === 'PL' || r.legacyCode === 'PL')
      expect(pl?.levels).toBe(7)
    })

    test.skipIf(!hasRealExcel)('1.7 matrix bay scanning maps active bays per run (1L: 32, 52R: 16, PL: 6)', () => {
      const layout = parseWarehouseExcel(REAL_EXCEL_PATH)
      const run1L = layout.runs.find((r) => r.aisleCode === '1L')
      expect(run1L).toBeDefined()
      expect(run1L?.activeBays).toHaveLength(32)
      expect(run1L?.activeBays[0]).toBe(1)
      expect(run1L?.activeBays[31]).toBe(32)

      const run52R = layout.runs.find((r) => r.aisleCode === '52R')
      expect(run52R).toBeDefined()
      expect(run52R?.activeBays).toHaveLength(16)

      const pl = layout.runs.find((r) => r.aisleCode === 'PL')
      expect(pl?.activeBays).toHaveLength(6)
    })
  })

  // --------------------------------------------------------------------------
  // 2. SLOT ADDRESS GENERATION & INDUSTRIAL FORMATTING
  // --------------------------------------------------------------------------
  describe('2. Slot Address Generation & Formatting Verification', () => {
    const addressPattern = /^([A-Za-z0-9]+)-(\d{2,})-([A-Za-z])(\d+)(?:-(\d+))?$/

    test('2.1 formats standard single-face, single-deep industrial address', () => {
      const addr = formatIndustrialAddress({ aisle: '1L', bay: 1, level: 0, position: 1, depth: 1 })
      expect(addr).toBe('1L-01-A1')
      expect(addr).toMatch(addressPattern)
    })

    test('2.2 generates correct slots for initial aisle 1L', () => {
      const slots = [
        formatIndustrialAddress({ aisle: '1L', bay: 1, level: 0, position: 1, depth: 1 }),
        formatIndustrialAddress({ aisle: '1L', bay: 1, level: 0, position: 2, depth: 1 }),
        formatIndustrialAddress({ aisle: '1L', bay: 1, level: 0, position: 3, depth: 1 }),
      ]
      expect(slots).toEqual(['1L-01-A1', '1L-01-A2', '1L-01-A3'])
    })

    test('2.3 generates correct address for renamed TCA aisle TCL', () => {
      const addr = formatIndustrialAddress({ aisle: 'TCL', bay: 15, level: 2, position: 2, depth: 1 })
      expect(addr).toBe('TCL-15-C2')
      expect(addr).toMatch(addressPattern)
    })

    test('2.4 generates correct address for padded aisle 06L', () => {
      const addr = formatIndustrialAddress({ aisle: '06L', bay: 5, level: 1, position: 3, depth: 1 })
      expect(addr).toBe('06L-05-B3')
      expect(addr).toMatch(addressPattern)
    })

    test('2.5 generates correct address for 9-level rack 52R (level 8 = I)', () => {
      const addr = formatIndustrialAddress({ aisle: '52R', bay: 16, level: 8, position: 1, depth: 1 })
      expect(addr).toBe('52R-16-I1')
      expect(addr).toMatch(addressPattern)
    })

    test('2.6 generates correct address for buffer rack PL', () => {
      const addr = formatIndustrialAddress({ aisle: 'PL', bay: 3, level: 6, position: 2, depth: 1 })
      expect(addr).toBe('PL-03-G2')
      expect(addr).toMatch(addressPattern)
    })

    test('2.7 verifies zero-padding boundaries for bay numbers (01, 09, 10, 32)', () => {
      expect(formatIndustrialAddress({ aisle: '1L', bay: 1, level: 0, position: 1, depth: 1 })).toBe('1L-01-A1')
      expect(formatIndustrialAddress({ aisle: '1L', bay: 9, level: 0, position: 1, depth: 1 })).toBe('1L-09-A1')
      expect(formatIndustrialAddress({ aisle: '1L', bay: 10, level: 0, position: 1, depth: 1 })).toBe('1L-10-A1')
      expect(formatIndustrialAddress({ aisle: '1L', bay: 32, level: 0, position: 1, depth: 1 })).toBe('1L-32-A1')
    })

    test('2.8 verifies industrial level letter conversion across all tiers A-I', () => {
      const levels = [0, 1, 2, 3, 4, 5, 6, 7, 8]
      const letters = levels.map((l) => levelToLetter(l))
      expect(letters).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'])
    })

    test('2.9 verifies barcode format LOC-${cleanAddressId}', () => {
      const addrId = 'TCL-15-C2'
      const barcode = generateBarcode(addrId)
      expect(barcode).toBe('LOC-TCL15C2')
    })

    test('2.10 supports positional argument overload for formatIndustrialAddress', () => {
      expect(formatIndustrialAddress('1L', 1, 'A', 1)).toBe('1L-01-A1')
      expect(formatIndustrialAddress('TCL', '15', 2, '2')).toBe('TCL-15-C2')
    })
  })

  // --------------------------------------------------------------------------
  // 3. BOUNDARY, EDGE CASES & ERROR HANDLING
  // --------------------------------------------------------------------------
  describe('3. Boundary, Edge Cases & Error Handling', () => {
    test('3.1 handles empty columns CX (102) & CY (103) without generating phantom locations', () => {
      const buf = createSyntheticExcelBuffer({ includeInactiveCXCY: true })
      const layout = parseWarehouseExcelFromBuffer(buf)
      expect(layout.skippedCols.length).toBeGreaterThanOrEqual(2)

      const cxSkipped = layout.skippedCols.find((s) => s.colLetter === 'CX')
      expect(cxSkipped).toBeDefined()
      expect(cxSkipped?.aisleCode).toBe('28L')

      const cySkipped = layout.skippedCols.find((s) => s.colLetter === 'CY')
      expect(cySkipped).toBeDefined()
      expect(cySkipped?.aisleCode).toBe('28R')

      // Ensure no locations generated for 28L or 28R
      const cxLocations = layout.locations.filter((l) => l.aisle === '28L' || l.aisle === '28R')
      expect(cxLocations).toHaveLength(0)
    })

    test('3.2 skips blank separator rows seamlessly', () => {
      const buf = createSyntheticExcelBuffer()
      const layout = parseWarehouseExcelFromBuffer(buf)
      expect(layout.runs.length).toBeGreaterThan(0)
    })

    test('3.3 ignores non-rack driving aisle text annotations without aisle headers', () => {
      const buf = createSyntheticExcelBuffer({ includeAisleAnnotations: true })
      const layout = parseWarehouseExcelFromBuffer(buf)
      const invalidAisles = layout.runs.filter(
        (r) => r.aisleCode.includes('Kuru') || r.aisleCode.includes('TOPLAMA')
      )
      expect(invalidAisles).toHaveLength(0)
    })

    test('3.4 throws descriptive error when Excel file does not exist', () => {
      expect(() => parseWarehouseExcel('C:/invalid/non_existent_depo.xlsx')).toThrow(
        /file not found|no such file|ENOENT/i
      )
    })

    test('3.5 throws descriptive error when buffer is corrupted or invalid', () => {
      const corruptedBuffer = Buffer.from('NOT_A_VALID_EXCEL_STREAM')
      expect(() => parseWarehouseExcelFromBuffer(corruptedBuffer)).toThrow(
        /unsupported file|invalid buffer|corrupt/i
      )
    })

    test('3.6 throws descriptive error when Sayfa1 worksheet is missing', () => {
      const invalidBuffer = createSyntheticExcelBuffer({ omitSayfa1: true })
      expect(() => parseWarehouseExcelFromBuffer(invalidBuffer)).toThrow(
        /worksheet 'Sayfa1' not found|missing worksheet/i
      )
    })

    test('3.7 falls back gracefully to legacyCode when modern aisleCode is omitted', () => {
      const buf = createSyntheticExcelBuffer()
      const layout = parseWarehouseExcelFromBuffer(buf)
      const pl = layout.runs.find((r) => r.aisleCode === 'PL' || r.legacyCode === 'PL')
      expect(pl).toBeDefined()
      expect(pl?.aisleCode).toBe('PL')
    })
  })

  // --------------------------------------------------------------------------
  // 4. PALLET RACK NODE SCENE GRAPH UPDATE VERIFICATION
  // --------------------------------------------------------------------------
  describe('4. PalletRackNode Scene Graph Update Verification', () => {
    test('4.1 applyExcelLayoutToScene maps sorted X lines to Excel runs', () => {
      const { nodes } = createMockSceneGraph()
      const buf = createSyntheticExcelBuffer()
      const layout = parseWarehouseExcelFromBuffer(buf)

      const result = applyExcelLayoutToScene(nodes, layout)
      expect(result.updatedCount).toBeGreaterThan(0)

      // First run mapped to 1L
      const line0Nodes = Object.values(nodes).filter((n) => Math.abs(n.position[0] - -132.0) < 0.2)
      expect(line0Nodes[0]?.rowLabel).toBe('1L')
      expect(line0Nodes[0]?.zoneCode).toBe('TCA')
    })

    test('4.2 assigns sequential 1-based bayIndex to contiguous racks along Z', () => {
      const { nodes } = createMockSceneGraph()
      const buf = createSyntheticExcelBuffer()
      const layout = parseWarehouseExcelFromBuffer(buf)

      applyExcelLayoutToScene(nodes, layout)
      const line0Nodes = Object.values(nodes)
        .filter((n) => n.rowLabel === '1L')
        .sort((a, b) => a.position[2] - b.position[2])

      expect(line0Nodes.length).toBe(32)
      expect(line0Nodes[0]?.bayIndex).toBe(1)
      expect(line0Nodes[31]?.bayIndex).toBe(32)
    })

    test('4.3 strictly preserves node transforms and physical dimensions', () => {
      const { nodes } = createMockSceneGraph()
      const sampleNodeId = Object.keys(nodes)[0]!
      const originalX = nodes[sampleNodeId]!.position[0]
      const originalWidth = nodes[sampleNodeId]!.bayClearWidth
      const originalColor = nodes[sampleNodeId]!.uprightColor

      const buf = createSyntheticExcelBuffer()
      const layout = parseWarehouseExcelFromBuffer(buf)
      applyExcelLayoutToScene(nodes, layout)

      expect(nodes[sampleNodeId]!.position[0]).toBe(originalX)
      expect(nodes[sampleNodeId]!.bayClearWidth).toBe(originalWidth)
      expect(nodes[sampleNodeId]!.uprightColor).toBe(originalColor)
    })

    test.skipIf(!hasRealScene || !hasRealExcel)('4.4 maps all 2,325 racks in real Bursa layout with 0 unmapped nodes', () => {
      const layout = parseWarehouseExcel(REAL_EXCEL_PATH)
      const scene = JSON.parse(fs.readFileSync(REAL_SCENE_PATH, 'utf8'))
      const result = applyExcelLayoutToScene(scene, layout)

      expect(result.totalRacks).toBe(2325)
      expect(result.updatedCount).toBe(2325)
      expect(result.unmappedNodes).toBe(0)
      expect(result.matchedAisles).toBe(103)

      const plNodes = result.nodes.filter((n: any) => n.rowLabel === 'PL')
      expect(plNodes).toHaveLength(6)
      expect(plNodes[0]?.levels).toBe(7)
      expect(plNodes[0]?.zoneCode).toBe('TCA')
    })
  })

  // --------------------------------------------------------------------------
  // 5. BULK API SEEDING VERIFICATION
  // --------------------------------------------------------------------------
  describe('5. Bulk Location Seeding & Store Integration Verification', () => {
    test('5.1 seedLocationsFromExcel updates locations memory store via /api/locations/bulk', async () => {
      const buf = createSyntheticExcelBuffer()
      const layout = parseWarehouseExcelFromBuffer(buf)
      // Use a representative sample of 150 locations for fast, deterministic unit test
      const testLayout = { ...layout, locations: layout.locations.slice(0, 150) }

      const siteId = '01JM1SITE00000000000000001'
      const seedResult = await seedLocationsFromExcel(testLayout, siteId)

      expect(seedResult.created).toBe(150)
      expect(seedResult.errors).toHaveLength(0)

      const store = getMemoryStore()
      expect(store.length).toBe(150)

      const sample = store.find((l) => l.addressId === '1L-01-A1')
      expect(sample).toBeDefined()
      expect(sample?.aisle).toBe('1L')
      expect(sample?.bay).toBe('01')
      expect(sample?.level).toBe('A')
      expect(sample?.position).toBe('1')
      expect(sample?.barcode).toBe('LOC-1L01A1')
      expect(sample?.status).toBe('Active')
    }, 15000)

    test('5.2 guarantees idempotent upsert on repeat executions without inflating store', async () => {
      const buf = createSyntheticExcelBuffer()
      const layout = parseWarehouseExcelFromBuffer(buf)
      const testLayout = { ...layout, locations: layout.locations.slice(0, 150) }
      const siteId = '01JM1SITE00000000000000001'

      // First run: all created
      const run1 = await seedLocationsFromExcel(testLayout, siteId)
      expect(run1.created).toBe(150)
      const countAfterRun1 = getMemoryStore().length

      // Second run: all updated, zero created, store size remains constant
      const run2 = await seedLocationsFromExcel(testLayout, siteId)
      expect(run2.created).toBe(0)
      expect(run2.updated).toBe(countAfterRun1)

      const countAfterRun2 = getMemoryStore().length
      expect(countAfterRun2).toBe(countAfterRun1)
    }, 15000)

    test('5.3 supports custom bulkPostFn and reports batch count correctly', async () => {
      const dummyLocations = Array.from({ length: 2500 }, (_, i) => ({
        aisle: '1L',
        bay: String(i + 1).padStart(2, '0'),
        level: 'A',
        position: '1',
      }))

      let postCallCount = 0
      const customPost = async (payload: any) => {
        postCallCount++
        return { created: payload.locations.length, updated: 0 }
      }

      const result = await seedLocationsFromExcel(dummyLocations, 'site_1', customPost)
      expect(result.total).toBe(2500)
      expect(result.batches).toBe(3)
      expect(postCallCount).toBe(3)
      expect(result.created).toBe(2500)
    })
  })
})
