/**
 * Database package
 * Exports Drizzle ORM and types
 * Note: Supabase clients are kept in the app's lib directory to avoid build-time initialization
 */

// Drizzle exports
export { type Database, db } from './drizzle'
export * from './schema'
export type { Database as SupabaseDatabase } from './types'

import * as dbSchema from './schema'
export const schema = dbSchema
export {
  createId,
  deletedAt,
  id,
  lower,
  timestamps,
  timestampsColumns,
  timestampsColumnsSoftDelete,
} from './helpers'
