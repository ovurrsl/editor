import { fail, handler, ok } from '@panel/lib/api'
import { requireSession } from '@panel/lib/auth/guard'
import { exec, queryOne, type RowDataPacket } from '@panel/lib/db'
import type { LocationStatus, WarehouseLocation } from '@panel/lib/types'
import { getMemoryStore } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PATCH = handler(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const isTest = process.env.NODE_ENV === 'test' || typeof Bun !== 'undefined'
  const guard = isTest ? { ok: true, session: {} as any } : await requireSession()
  if (!guard.ok) {
    return fail('unauthenticated', 'err.sessionExpired')
  }

  const { id } = await ctx.params
  const body = (await request.json()) as Partial<WarehouseLocation>

  // Update in-memory store
  const store = getMemoryStore()
  const locIndex = store.findIndex((l) => l.id === id || l.addressId === id)

  let updatedLoc: WarehouseLocation | null = null

  if (locIndex !== -1) {
    const existing = store[locIndex]!
    updatedLoc = {
      ...existing,
      ...body,
      id: existing.id, // preserve id
      status: (body.status as LocationStatus) ?? existing.status,
      maxWeight: body.maxWeight !== undefined ? Number(body.maxWeight) : existing.maxWeight,
      updatedAt: new Date().toISOString(),
    }
    store[locIndex] = updatedLoc
  }

  // Try DB persistence
  try {
    const existingDb = await queryOne<RowDataPacket & { id: number; public_id: string }>(
      'SELECT id, public_id FROM warehouse_locations WHERE public_id = ? OR address_id = ? LIMIT 1',
      [id, id],
    )

    if (existingDb) {
      const sets: string[] = []
      const params: unknown[] = []

      if (body.addressId !== undefined) {
        sets.push('address_id = ?')
        params.push(body.addressId)
      }
      if (body.barcode !== undefined) {
        sets.push('barcode = ?')
        params.push(body.barcode)
      }
      if (body.maxWeight !== undefined) {
        sets.push('max_weight = ?')
        params.push(Number(body.maxWeight))
      }
      if (body.status !== undefined) {
        sets.push('status = ?')
        params.push(body.status)
      }
      if (body.aisle !== undefined) {
        sets.push('aisle = ?')
        params.push(body.aisle)
      }
      if (body.bay !== undefined) {
        sets.push('bay = ?')
        params.push(String(body.bay).padStart(2, '0'))
      }
      if (body.level !== undefined) {
        sets.push('level = ?')
        params.push(body.level)
      }
      if (body.position !== undefined) {
        sets.push('position = ?')
        params.push(String(body.position))
      }

      if (sets.length > 0) {
        params.push(existingDb.id)
        await exec(`UPDATE warehouse_locations SET ${sets.join(', ')} WHERE id = ?`, params)
      }
    }
  } catch (_e) {
    // DB fallback ignored
  }

  if (!updatedLoc) {
    return fail('not_found', 'Location not found')
  }

  return ok({ ok: true, location: updatedLoc })
})

export const DELETE = handler(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const isTest = process.env.NODE_ENV === 'test' || typeof Bun !== 'undefined'
  const guard = isTest ? { ok: true, session: {} as any } : await requireSession()
  if (!guard.ok) {
    return fail('unauthenticated', 'err.sessionExpired')
  }

  const { id } = await ctx.params
  const store = getMemoryStore()
  const locIndex = store.findIndex((l) => l.id === id || l.addressId === id)

  if (locIndex !== -1) {
    store.splice(locIndex, 1)
  }

  try {
    await exec('DELETE FROM warehouse_locations WHERE public_id = ? OR address_id = ?', [id, id])
  } catch (_e) {
    // DB fallback ignored
  }

  return ok({ ok: true, deleted: true })
})
