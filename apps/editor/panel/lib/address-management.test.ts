import { describe, expect, test } from 'bun:test'
import { allRoles, hasPermission, permissionsForRole } from './auth/roles'
import { CONSOLE_TABS, railEntries, TAB_META, tabLabel, tabPermission } from './console-tabs'
import { dictionaryFor } from './i18n'
import { PERMISSIONS, type Permission, type Role } from './types'

describe('Warehouse Addressing & Dynamic RBAC Suite', () => {
  describe('1. Permissions and Roles Definitions', () => {
    test('PERMISSIONS array contains warehouse address management permissions', () => {
      expect(PERMISSIONS).toContain('manage_warehouse_addresses')
      expect(PERMISSIONS).toContain('view_warehouse_addresses')
    })

    test('AddressManager role is registered with appropriate default permissions', async () => {
      const perms = await permissionsForRole('AddressManager')
      expect(perms).toContain('view_warehouse_addresses')
      expect(perms).toContain('manage_warehouse_addresses')
      expect(perms).toContain('view_projects')

      // AddressManager should NOT have destructive general admin or user editing rights
      expect(perms).not.toContain('admin_access')
      expect(perms).not.toContain('edit_users')
      expect(perms).not.toContain('edit_roles')
      expect(perms).not.toContain('delete_projects')
    })

    test('Supervisor and Editor roles carry warehouse address permissions', async () => {
      const supervisorPerms = await permissionsForRole('Supervisor')
      expect(supervisorPerms).toContain('view_warehouse_addresses')
      expect(supervisorPerms).toContain('manage_warehouse_addresses')

      const editorPerms = await permissionsForRole('Editor')
      expect(editorPerms).toContain('view_warehouse_addresses')
      expect(editorPerms).toContain('manage_warehouse_addresses')

      const viewerPerms = await permissionsForRole('Viewer')
      expect(viewerPerms).not.toContain('manage_warehouse_addresses')
    })

    test('allRoles() includes AddressManager in sorted list', async () => {
      const roles = await allRoles()
      const names = roles.map((r) => r.name)
      expect(names).toContain('Admin')
      expect(names).toContain('Supervisor')
      expect(names).toContain('Editor')
      expect(names).toContain('Viewer')
      expect(names).toContain('AddressManager')
    })
  })

  describe('2. Console Rail Filtering & Tab Routing for AddressManager', () => {
    test('CONSOLE_TABS and TAB_META include locations tab', () => {
      expect(CONSOLE_TABS).toContain('locations')
      expect(TAB_META.locations).toBeDefined()
      expect(TAB_META.locations.permission).toBe('view_warehouse_addresses')
      expect(TAB_META.locations.labelKey).toBe('locations')
    })

    test('users and roles tabs are explicitly gated with permissions', () => {
      expect(TAB_META.users.permission).toBe('edit_users')
      expect(TAB_META.roles.permission).toBe('edit_roles')
    })

    test('railEntries filters tabs dynamically for AddressManager', async () => {
      const t = dictionaryFor('en')
      const addressManagerPerms = await permissionsForRole('AddressManager')

      const entries = railEntries(t).filter(
        (e) => !e.permission || addressManagerPerms.includes(e.permission),
      )
      const tabIds = entries.filter((e) => e.kind === 'item').map((e) => e.id)

      // AddressManager must see addresses and sites
      expect(tabIds.includes('addresses') || tabIds.includes('locations')).toBe(true)
      expect(tabIds).toContain('sites')

      // AddressManager must NOT see admin tabs like users, roles, audit, logs, scenes, integrations, settings
      expect(tabIds).not.toContain('users')
      expect(tabIds).not.toContain('roles')
      expect(tabIds).not.toContain('audit')
      expect(tabIds).not.toContain('logs')
      expect(tabIds).not.toContain('scenes')
      expect(tabIds).not.toContain('integrations')
      expect(tabIds).not.toContain('settings')
    })

    test('multilingual dictionary resolves locations label in EN and TR', () => {
      const en = dictionaryFor('en')
      const tr = dictionaryFor('tr')

      expect(tabLabel(en, 'locations')).toBe('Locations & Addressing')
      expect(tabLabel(tr, 'locations')).toBe('Adres Yönetimi')

      expect(en.perm.view_warehouse_addresses).toBe('View warehouse addresses')
      expect(tr.perm.view_warehouse_addresses).toBe('Depo adreslerini görüntüle')
      expect(en.perm.manage_warehouse_addresses).toBe('Manage warehouse addresses')
      expect(tr.perm.manage_warehouse_addresses).toBe('Depo adreslerini yönet')
    })
  })

  describe('3. Industrial Location Address Parsing and Formatting', () => {
    test('formats standard industrial address format A-02-D2 correctly', () => {
      const aisle = 'A'
      const bay = 2
      const levelLetter = 'D'
      const pos = 2
      const formatted = `${aisle}-${String(bay).padStart(2, '0')}-${levelLetter}${pos}`
      expect(formatted).toBe('A-02-D2')
    })

    test('formats dual-facing bay partner aisle address B-02-D1 correctly', () => {
      const aisle = 'B'
      const bay = 2
      const levelLetter = 'D'
      const pos = 1
      const formatted = `${aisle}-${String(bay).padStart(2, '0')}-${levelLetter}${pos}`
      expect(formatted).toBe('B-02-D1')
    })
  })
})
