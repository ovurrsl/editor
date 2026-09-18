import { describe, expect, test, beforeEach } from 'bun:test'
import { GET, POST, DELETE as DELETE_ALL, getMemoryStore, setMemoryStore } from '../../app/api/locations/route'
import { PATCH, DELETE } from '../../app/api/locations/[id]/route'
import { POST as POST_BULK } from '../../app/api/locations/bulk/route'

describe('Warehouse Locations API Endpoints (Milestone M3)', () => {
  beforeEach(() => {
    // Reset memory store before each test
    setMemoryStore(undefined as any)
  })

  describe('1. GET /api/locations', () => {
    test('returns seeded warehouse locations with summary metadata', async () => {
      const req = new Request('http://localhost/api/locations')
      const res = await GET(req)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.locations).toBeDefined()
      expect(Array.isArray(body.locations)).toBe(true)
      expect(body.locations.length).toBeGreaterThan(0)
      expect(body.summary).toBeDefined()
      expect(body.summary.total).toBe(body.total)
      expect(body.summary.active).toBeGreaterThan(0)
    })

    test('filters locations by aisle', async () => {
      const req = new Request('http://localhost/api/locations?aisle=A')
      const res = await GET(req)
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.locations.length).toBeGreaterThan(0)
      for (const loc of body.locations) {
        expect(loc.aisle).toBe('A')
      }
    })

    test('filters locations by status (Quarantine, Blocked)', async () => {
      const req = new Request('http://localhost/api/locations?status=Quarantine')
      const res = await GET(req)
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.locations.length).toBeGreaterThan(0)
      for (const loc of body.locations) {
        expect(loc.status).toBe('Quarantine')
      }
    })

    test('searches locations by query string', async () => {
      const req = new Request('http://localhost/api/locations?q=A-01-A1')
      const res = await GET(req)
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.locations.length).toBeGreaterThan(0)
      expect(body.locations[0].addressId).toBe('A-01-A1')
    })

    test('paginates results using limit and offset', async () => {
      const req1 = new Request('http://localhost/api/locations?limit=5&offset=0')
      const res1 = await GET(req1)
      expect(res1.status).toBe(200)
      const body1 = await res1.json()

      expect(body1.locations.length).toBe(5)

      const req2 = new Request('http://localhost/api/locations?limit=5&offset=5')
      const res2 = await GET(req2)
      expect(res2.status).toBe(200)
      const body2 = await res2.json()

      expect(body2.locations.length).toBe(5)
      expect(body1.locations[0].id).not.toBe(body2.locations[0].id)
    })
  })

  describe('2. POST /api/locations', () => {
    test('creates a new warehouse location', async () => {
      const newLoc = {
        aisle: 'D',
        bay: '01',
        level: 'A',
        position: '1',
        maxWeight: 1100,
        status: 'Active',
      }
      const req = new Request('http://localhost/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLoc),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.location).toBeDefined()
      expect(body.location.addressId).toBe('D-01-A1')
      expect(body.location.barcode).toBe('LOC-D01A1')
      expect(body.location.maxWeight).toBe(1100)
    })

    test('rejects duplicate address ID creation', async () => {
      const duplicateLoc = {
        aisle: 'A',
        bay: '01',
        level: 'A',
        position: '1',
      }
      const req = new Request('http://localhost/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(duplicateLoc),
      })

      const res = await POST(req)
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toBeDefined()
      expect(body.error.code).toBe('conflict')
    })
  })

  describe('3. PATCH & DELETE /api/locations/[id]', () => {
    test('updates location status and maxWeight via PATCH', async () => {
      const store = getMemoryStore()
      const target = store[0]!
      const ctx = { params: Promise.resolve({ id: target.id }) }

      const patchReq = new Request(`http://localhost/api/locations/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Blocked', maxWeight: 2500 }),
      })

      const res = await PATCH(patchReq, ctx)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.location.status).toBe('Blocked')
      expect(body.location.maxWeight).toBe(2500)
    })

    test('deletes location via DELETE', async () => {
      const store = getMemoryStore()
      const target = store[0]!
      const initialCount = store.length
      const ctx = { params: Promise.resolve({ id: target.id }) }

      const deleteReq = new Request(`http://localhost/api/locations/${target.id}`, {
        method: 'DELETE',
      })

      const res = await DELETE(deleteReq, ctx)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.deleted).toBe(true)

      const updatedStore = getMemoryStore()
      expect(updatedStore.length).toBe(initialCount - 1)
      expect(updatedStore.find((l) => l.id === target.id)).toBeUndefined()
    })
  })

  describe('4. POST /api/locations/bulk', () => {
    test('bulk upserts locations and calculates created/updated counts', async () => {
      const bulkPayload = {
        locations: [
          // Update existing A-01-A1
          {
            aisle: 'A',
            bay: '01',
            level: 'A',
            position: '1',
            maxWeight: 1800,
            status: 'Maintenance',
          },
          // Create new location in aisle E
          {
            aisle: 'E',
            bay: '01',
            level: 'A',
            position: '1',
            maxWeight: 1000,
            status: 'Active',
          },
        ],
      }

      const req = new Request('http://localhost/api/locations/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bulkPayload),
      })

      const res = await POST_BULK(req)
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.created).toBe(1)
      expect(body.updated).toBe(1)
      expect(body.errors).toHaveLength(0)

      // Verify memory store reflects changes
      const store = getMemoryStore()
      const updated = store.find((l) => l.addressId === 'A-01-A1')
      expect(updated?.maxWeight).toBe(1800)
      expect(updated?.status).toBe('Maintenance')

      const created = store.find((l) => l.addressId === 'E-01-A1')
      expect(created).toBeDefined()
      expect(created?.status).toBe('Active')
    })
  })

  describe('5. DELETE /api/locations (Clear All Addresses)', () => {
    test('clears all locations for specific siteId', async () => {
      // Ensure store has initial items
      const initialStore = getMemoryStore()
      expect(initialStore.length).toBeGreaterThan(0)
      const targetSiteId = initialStore[0]?.siteId || '01JM1SITE00000000000000001'

      const req = new Request(`http://localhost/api/locations?siteId=${encodeURIComponent(targetSiteId)}`, {
        method: 'DELETE',
      })

      const res = await DELETE_ALL(req)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.cleared).toBe(true)
      expect(body.deletedCount).toBeGreaterThan(0)

      // Verify no remaining locations with targetSiteId
      const afterStore = getMemoryStore()
      const remainingForSite = afterStore.filter((l) => l.siteId === targetSiteId)
      expect(remainingForSite.length).toBe(0)
    })
  })
})

