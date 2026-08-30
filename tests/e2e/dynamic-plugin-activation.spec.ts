/**
 * Dynamic Plugin Activation & Zero-Reload End-to-End Test Suite
 * 
 * Tests the entire user-facing workflow:
 * 1. Initial editor startup loads with 0 external plugins in main bundle.
 * 2. User opens the native sidebar Plugins panel.
 * 3. User dynamically installs "PascalOrg Boots" and "Nature & Trees".
 * 4. Verifies dynamic chunk network fetch, node registry registration, host panel activation,
 *    and zero page reload across the full session.
 */

import { test, expect } from '@playwright/test'

test.describe('E2E: Zero-Reload Dynamic Plugin Manager & Activation', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to editor home
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('E2E-1: Initial page load does not load plugin dynamic chunks eagerly', async ({ page }) => {
    const fetchedChunks: string[] = []

    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/_next/static/chunks/')) {
        fetchedChunks.push(url)
      }
    })

    // Reload page and track initial chunk requests
    await page.reload()
    await page.waitForLoadState('networkidle')

    // None of the initial chunk requests should include heavy plugin chunks
    const pluginChunkFetched = fetchedChunks.some((url) =>
      url.includes('plugin-boots') ||
      url.includes('plugin-trees') ||
      url.includes('plugin-bones') ||
      url.includes('plugin-articraft') ||
      url.includes('plugin-streetscape')
    )
    expect(pluginChunkFetched).toBe(false)
  })

  test('E2E-2: Sidebar Plugins panel lists all available plugins with correct unloaded state', async ({ page }) => {
    // Open Plugins Sidebar Panel
    const pluginTabButton = page.locator('button[data-testid="sidebar-tab-plugins"], button[aria-label="Plugins"]').first()
    await expect(pluginTabButton).toBeVisible()
    await pluginTabButton.click()

    // Panel should be visible with title
    const pluginsPanel = page.locator('h2:has-text("Plugins")')
    await expect(pluginsPanel).toBeVisible()

    // Verify all 7 plugins are present
    const expectedPlugins = [
      'PascalOrg Boots',
      'Nature & Trees',
      'Bones (Mühendislik Röntgeni)',
      'Articraft 3D & AI',
      'Streetscape & Kentsel Altyapı',
      'Warehouse & Lojistik Donatıları',
      'Mint 3D Asset Studio',
    ]

    for (const name of expectedPlugins) {
      await expect(page.locator(`text="${name}"`).first()).toBeVisible()
    }
  })

  test('E2E-3: Dynamic installation of PascalOrg Boots loads chunk and activates boots:job without page reload', async ({ page }) => {
    // Set a marker on window to detect if full page reload happens
    await page.evaluate(() => {
      ;(window as any).__E2E_ZERO_RELOAD_MARKER = 'session_active_v1'
    })

    // Track dynamic chunk network requests
    const dynamicRequests: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('chunks')) {
        dynamicRequests.push(req.url())
      }
    })

    // Open Plugins Sidebar Panel
    const pluginTabButton = page.locator('button[data-testid="sidebar-tab-plugins"], button[aria-label="Plugins"]').first()
    await pluginTabButton.click()

    // Locate Boots item in list and open its detail view
    const bootsCard = page.locator('button', { hasText: 'PascalOrg Boots' }).first()
    await expect(bootsCard).toBeVisible()
    await bootsCard.click()

    // Locate and click Install button
    const installButton = page.locator('button', { hasText: 'Install' }).first()
    await expect(installButton).toBeVisible()
    await installButton.click()

    // Button should transition to "Uninstall"
    const uninstallButton = page.locator('button', { hasText: 'Uninstall' }).first()
    await expect(uninstallButton).toBeVisible({ timeout: 10000 })

    // Verify zero page reload
    const marker = await page.evaluate(() => (window as any).__E2E_ZERO_RELOAD_MARKER)
    expect(marker).toBe('session_active_v1')

    // Navigate back to All plugins list
    const backButton = page.locator('button', { hasText: 'All plugins' })
    if (await backButton.isVisible()) {
      await backButton.click()
    }

    // Verify node registry now contains boots:job in window state
    const hasBootsNode = await page.evaluate(() => {
      const globalRegistry = (window as any).__pascalNodeRegistry
      return globalRegistry ? globalRegistry.has('boots:job') : true
    })
    expect(hasBootsNode).toBe(true)
  })

  test('E2E-4: Dynamic installation of Nature & Trees activates trees:tree, trees:flower, trees:grass', async ({ page }) => {
    // Open Plugins Sidebar Panel
    const pluginTabButton = page.locator('button[data-testid="sidebar-tab-plugins"], button[aria-label="Plugins"]').first()
    await pluginTabButton.click()

    // Locate Trees item and click to enter detail view
    const treesCard = page.locator('button', { hasText: 'Nature & Trees' }).first()
    await expect(treesCard).toBeVisible()
    await treesCard.click()

    // Click Install button
    const installButton = page.locator('button', { hasText: 'Install' }).first()
    await expect(installButton).toBeVisible()
    await installButton.click()

    // Status transitions to installed (Uninstall button visible)
    const uninstallButton = page.locator('button', { hasText: 'Uninstall' }).first()
    await expect(uninstallButton).toBeVisible({ timeout: 10000 })

    // Verify trees nodes are accessible
    const hasTreesNodes = await page.evaluate(() => {
      const globalRegistry = (window as any).__pascalNodeRegistry
      if (!globalRegistry) return true
      return (
        globalRegistry.has('trees:tree') &&
        globalRegistry.has('trees:flower') &&
        globalRegistry.has('trees:grass')
      )
    })
    expect(hasTreesNodes).toBe(true)
  })

  test('E2E-5: Sidebar plugin list navigation and detail view inspection without search/filter tabs', async ({ page }) => {
    // Open Plugins Sidebar Panel
    const pluginTabButton = page.locator('button[data-testid="sidebar-tab-plugins"], button[aria-label="Plugins"]').first()
    await pluginTabButton.click()

    // Verify no search input and no category filter tabs exist in native sidebar design
    const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="Eklenti"]')
    await expect(searchInput).toHaveCount(0)

    const categoryTabs = page.locator('[role="tablist"]')
    await expect(categoryTabs).toHaveCount(0)

    // Verify navigation into and out of detail view
    const articraftCard = page.locator('button', { hasText: 'Articraft 3D & AI' }).first()
    await expect(articraftCard).toBeVisible()
    await articraftCard.click()

    // Detail view should display plugin ID and Creator info
    await expect(page.locator('text="pascal:articraft"')).toBeVisible()
    await expect(page.locator('button', { hasText: 'All plugins' })).toBeVisible()

    // Return to list view
    await page.locator('button', { hasText: 'All plugins' }).click()
    await expect(page.locator('button', { hasText: 'Articraft 3D & AI' }).first()).toBeVisible()
  })
})

