import { resolveMysqlUrl } from '@pascal-app/mcp/storage'
import { db } from '@panel/lib/db'

/**
 * Auth stores users and sessions in the unified database (pascal.db or MySQL).
 * Always available locally and in production via the unified database driver.
 */

interface MysqlQueryable {
  query(sql: string, values?: unknown[]): Promise<[unknown, unknown]>
  execute(sql: string, values?: unknown[]): Promise<[unknown, unknown]>
}

export interface MysqlPool extends MysqlQueryable {
  end(): Promise<void>
}

/** True whenever a database is available. pascal.db is always available. */
export function authAvailable(_env: NodeJS.ProcessEnv = process.env): boolean {
  return true
}

export async function getAuthPool(): Promise<MysqlPool> {
  const pool = db() as unknown as MysqlPool
  await migrate(pool)
  return pool
}

/** Creates the auth tables. Safe to call repeatedly. */
export async function migrateAuth(): Promise<void> {
  await getAuthPool()
}

async function migrate(p: MysqlPool): Promise<void> {
  try {
    await p.query('SELECT 1 FROM users LIMIT 1')
  } catch {
    throw new Error(
      "The console's database schema is missing. Run the panel migrations " +
        '(panel/migrate.ts) against this database first.',
    )
  }
}

