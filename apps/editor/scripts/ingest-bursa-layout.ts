#!/usr/bin/env bun
/**
 * Ingest Bursa Warehouse Layout & Master Locations
 *
 * Usage:
 *   bun apps/editor/scripts/ingest-bursa-layout.ts [--seed] [--excel <path>] [--scene <path>] [--site <id>]
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  parseWarehouseExcel,
  applyExcelLayoutToScene,
  seedLocationsFromExcel,
  type WarehouseLayoutResult,
} from '../panel/lib/excel-ingest'

// CLI Argument Parsing
const args = process.argv.slice(2)
function getArg(flag: string, defaultValue: string): string {
  const idx = args.indexOf(flag)
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1]!
  }
  return defaultValue
}

const shouldSeed = args.includes('--seed')
const excelPath = getArg('--excel', 'C:/Users/resul.ovur/Desktop/Depo Layout 10.09.2026.xlsx')
const scenePath = getArg('--scene', 'C:/Users/resul.ovur/Desktop/layout_2026-09-11.json')
const siteId = getArg('--site', '01JM1SITE00000000000000001')
const saveScenePath = getArg('--save-scene', '')

async function main() {
  console.log('='.repeat(70))
  console.log('  🏭 BURSA WAREHOUSE EXCEL LAYOUT & ADDRESS INGESTION ENGINE')
  console.log('='.repeat(70))
  console.log(`\n📂 Excel Source : ${excelPath}`)
  console.log(`🌐 3D Scene Ref : ${scenePath}`)
  console.log(`🏢 Target Site  : ${siteId}`)
  console.log(`⚡ Seed Mode    : ${shouldSeed ? 'ENABLED' : 'DISABLED (dry run, use --seed to persist)'}\n`)

  if (!fs.existsSync(excelPath)) {
    console.error(`❌ Error: Excel file not found at ${excelPath}`)
    process.exit(1)
  }

  // 1. Parse Excel
  console.log('⏳ Parsing Excel workbook...')
  const startTime = performance.now()
  let layout: WarehouseLayoutResult

  try {
    layout = parseWarehouseExcel(excelPath, {
      siteId,
      siteName: 'Bursa Depo',
      facilityName: 'Bursa',
      scanExtendedRows: true,
    })
  } catch (err: any) {
    console.error(`❌ Parse failed: ${err.message}`)
    process.exit(1)
  }

  const parseTime = (performance.now() - startTime).toFixed(1)
  console.log(`✅ Parsed in ${parseTime}ms\n`)

  // 2. Summary
  console.log('📊 LAYOUT SUMMARY')
  console.log('-'.repeat(50))
  console.log(`• Worksheet       : ${layout.sheetName}`)
  console.log(`• Active Aisles   : ${layout.totalAisles} runs`)
  console.log(`• Active Bay Grid : ${layout.totalBays} bays`)
  console.log(`• Active Pallets  : ${layout.totalPallets.toLocaleString()} pallets`)
  console.log(`• Gross Pallets   : ${layout.grossPallets.toLocaleString()} pallets`)
  console.log(`• Locations Master: ${layout.locations.length.toLocaleString()} discrete slot addresses`)

  if (layout.skippedCols.length > 0) {
    console.log(`\n⚠️  Skipped Inactive Columns (${layout.skippedCols.length}):`)
    for (const sc of layout.skippedCols) {
      console.log(`   - Col ${sc.colLetter} (#${sc.colIndex}): ${sc.aisleCode || 'N/A'} -> ${sc.reason}`)
    }
  }

  console.log('\n🏷️  ZONE BREAKDOWN')
  console.log('-'.repeat(50))
  for (const [zone, metrics] of Object.entries(layout.summaryByZone)) {
    console.log(
      `• ${zone.padEnd(12)}: ${String(metrics.runs).padStart(2)} runs | ${String(metrics.bays).padStart(4)} bays | ${metrics.pallets.toLocaleString().padStart(6)} pallets`
    )
  }

  console.log('\n📍 SAMPLE INDUSTRIAL ADDRESSES')
  console.log('-'.repeat(50))
  const sampleAddresses = layout.locations.slice(0, 5).concat(layout.locations.slice(-5))
  for (const loc of sampleAddresses) {
    console.log(`• ${loc.addressId.padEnd(16)} -> Barcode: ${loc.barcode.padEnd(18)} [${loc.zoneCode}]`)
  }

  // 3. Scene Graph Mapping
  if (fs.existsSync(scenePath)) {
    console.log('\n' + '='.repeat(70))
    console.log('  🎮 3D SCENE GRAPH TOPOLOGY MAPPING')
    console.log('='.repeat(70))
    try {
      const sceneData = JSON.parse(fs.readFileSync(scenePath, 'utf8'))
      const mappingResult = applyExcelLayoutToScene(sceneData, layout, {
        bayIndexing: 'sequential',
      })

      console.log(`• Total Racks in Scene : ${mappingResult.totalRacks}`)
      console.log(`• Successfully Updated : ${mappingResult.updatedCount}`)
      console.log(`• Matched Aisle Lines  : ${mappingResult.matchedAisles}`)
      console.log(`• Unmapped Nodes       : ${mappingResult.unmappedNodes}`)

      if (saveScenePath) {
        fs.writeFileSync(saveScenePath, JSON.stringify(sceneData, null, 2), 'utf8')
        console.log(`💾 Updated scene saved to: ${saveScenePath}`)
      }
    } catch (err: any) {
      console.error(`⚠️ Failed to map scene graph: ${err.message}`)
    }
  }

  // 4. Bulk Seeding
  if (shouldSeed) {
    console.log('\n' + '='.repeat(70))
    console.log('  💾 BULK LOCATION SEEDING (DATABASE / STORE)')
    console.log('='.repeat(70))
    console.log(`⏳ Seeding ${layout.locations.length.toLocaleString()} locations in chunks of 1,000...`)
    const seedStart = performance.now()
    const seedResult = await seedLocationsFromExcel(layout, siteId)
    const seedTime = ((performance.now() - seedStart) / 1000).toFixed(2)

    console.log(`✅ Seeding completed in ${seedTime}s`)
    console.log(`• Total Records : ${seedResult.total.toLocaleString()}`)
    console.log(`• Created       : ${seedResult.created.toLocaleString()}`)
    console.log(`• Updated       : ${seedResult.updated.toLocaleString()}`)
    console.log(`• Batches       : ${seedResult.batches}`)
    if (seedResult.errors.length > 0) {
      console.log(`⚠️ Errors (${seedResult.errors.length}):`, seedResult.errors.slice(0, 5))
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('✨ Ingestion process completed successfully.')
  console.log('='.repeat(70) + '\n')
}

main().catch((err) => {
  console.error('Fatal execution error:', err)
  process.exit(1)
})
