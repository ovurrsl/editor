import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import mysql from 'mysql2/promise'
import * as os from 'node:os'
import * as path from 'node:path'

let mysqlPool: Pool | undefined
let sqliteInstance: any = null

function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

export function resolveDatabasePath(): string {
  const customPath = env('DIGITALTWIN_DB_PATH', 'PASCAL_DB_PATH')
  if (customPath) return customPath

  const dataDir = env('DIGITALTWIN_DATA_DIR', 'PASCAL_DATA_DIR')
  if (dataDir) return path.join(dataDir, 'pascal.db')

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, 'Pascal', 'data', 'pascal.db')
  }

  const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  return path.join(xdg, 'pascal', 'data', 'pascal.db')
}

function fromUrl(): Partial<Record<'host' | 'port' | 'user' | 'password' | 'database', string>> {
  const raw = env('DIGITALTWIN_MYSQL_URL', 'PASCAL_MYSQL_URL', 'DATABASE_URL')
  if (!raw) return {}
  try {
    const url = new URL(raw)
    return {
      host: url.hostname || undefined,
      port: url.port || undefined,
      user: decodeURIComponent(url.username) || undefined,
      password: decodeURIComponent(url.password) || undefined,
      database: url.pathname.replace(/^\//, '') || undefined,
    }
  } catch {
    return {}
  }
}

export function isMysqlConfigured(): boolean {
  if (env('DIGITALTWIN_USE_SQLITE', 'PASCAL_USE_SQLITE') === '1') {
    return false
  }
  return Boolean(
    env('DIGITALTWIN_MYSQL_URL', 'PASCAL_MYSQL_URL', 'DATABASE_URL') ||
    env('DIGITALTWIN_MYSQL_HOST', 'PASCAL_MYSQL_HOST', 'DATABASE_HOST')
  )
}

function normalizeSql(sql: string): string {
  let s = sql
    .replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bUNHEX\s*\(\s*\?\s*\)/gi, '?')
    .replace(/\bHEX\s*\(\s*([^\)]+)\s*\)/gi, '$1')
    .replace(/CAST\(\s*\?\s*AS\s+JSON\)/gi, '?')

  if (/ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(s)) {
    s = s.replace(/^(\s*)INSERT\s+INTO\b/i, '$1INSERT OR REPLACE INTO')
    s = s.replace(/\s+ON\s+DUPLICATE\s+KEY\s+UPDATE[\s\S]*$/i, '')
  }

  return s
}

function getSqliteDb(): any {
  if (sqliteInstance) return sqliteInstance

  const dbPath = resolveDatabasePath()
  if (typeof (globalThis as any).Bun !== 'undefined') {
    const { Database } = require('bun:sqlite')
    const db = new Database(dbPath)
    sqliteInstance = {
      exec: (sql: string) => db.exec(sql),
      query: (sql: string) => {
        const stmt = db.query(sql)
        return {
          all: (...args: any[]) => stmt.all(...args),
          get: (...args: any[]) => stmt.get(...args),
          run: (...args: any[]) => stmt.run(...args),
        }
      },
      close: () => db.close(),
    }
  } else {
    try {
      const { DatabaseSync } = require('node:sqlite')
      const db = new DatabaseSync(dbPath)
      sqliteInstance = {
        exec: (sql: string) => db.exec(sql),
        query: (sql: string) => {
          const stmt = db.prepare(sql)
          return {
            all: (...args: any[]) => stmt.all(...args),
            get: (...args: any[]) => stmt.get(...args),
            run: (...args: any[]) => {
              const res = stmt.run(...args)
              return { lastInsertRowid: res.lastInsertRowid, changes: res.changes }
            },
          }
        },
        close: () => db.close(),
      }
    } catch (e: any) {
      throw new Error(`Failed to load SQLite engine: ${e.message}`)
    }
  }

  sqliteInstance.exec('PRAGMA journal_mode = WAL;')
  sqliteInstance.exec('PRAGMA synchronous = NORMAL;')
  sqliteInstance.exec('PRAGMA busy_timeout = 5000;')
  return sqliteInstance
}

function runSqlite<T>(sql: string, params: unknown[] = []): [T, unknown] {
  const db = getSqliteDb()
  const norm = normalizeSql(sql)
  const trimmed = norm.trim().toUpperCase()
  const isSelect =
    trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH')

  if (isSelect) {
    const rows = db.query(norm).all(...(params as any[]))
    return [rows as T, null]
  } else {
    const res = db.query(norm).run(...(params as any[]))
    const header: ResultSetHeader = {
      insertId: Number(res.lastInsertRowid ?? 0),
      affectedRows: Number(res.changes ?? 0),
    } as any
    return [header as unknown as T, null]
  }
}

export function dbConfig() {
  const url = fromUrl()
  return {
    host:
      env('DIGITALTWIN_MYSQL_HOST', 'PASCAL_MYSQL_HOST', 'DATABASE_HOST') ??
      url.host ??
      '127.0.0.1',
    port: Number(
      env('DIGITALTWIN_MYSQL_PORT', 'PASCAL_MYSQL_PORT', 'DATABASE_PORT') ?? url.port ?? 3306,
    ),
    user: env('DIGITALTWIN_MYSQL_USER', 'PASCAL_MYSQL_USER', 'DATABASE_USER') ?? url.user ?? 'root',
    password:
      env('DIGITALTWIN_MYSQL_PASSWORD', 'PASCAL_MYSQL_PASSWORD', 'DATABASE_PASSWORD') ??
      url.password ??
      '',
    database:
      env('DIGITALTWIN_MYSQL_DATABASE', 'PASCAL_MYSQL_DATABASE', 'DATABASE_NAME') ??
      url.database ??
      'digitaltwin',
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
  }
}

export function db(): Pool {
  if (isMysqlConfigured()) {
    if (!mysqlPool) {
      mysqlPool = mysql.createPool({
        ...dbConfig(),
        waitForConnections: true,
        connectionLimit: 10,
        maxIdle: 10,
        enableKeepAlive: true,
        namedPlaceholders: false,
      })
    }
    return mysqlPool
  }

  // Return SQLite proxy pool
  const sqlitePool: any = {
    async execute(sql: string, params: unknown[] = []): Promise<[any, unknown]> {
      return runSqlite(sql, params)
    },
    async query(sql: string, params: unknown[] = []): Promise<[any, unknown]> {
      return runSqlite(sql, params)
    },
    async getConnection(): Promise<PoolConnection> {
      return {
        async execute(sql: string, params: unknown[] = []) {
          return runSqlite(sql, params)
        },
        async query(sql: string, params: unknown[] = []) {
          return runSqlite(sql, params)
        },
        async beginTransaction() {
          getSqliteDb().exec('BEGIN IMMEDIATE')
        },
        async commit() {
          getSqliteDb().exec('COMMIT')
        },
        async rollback() {
          try {
            getSqliteDb().exec('ROLLBACK')
          } catch {}
        },
        release() {},
      } as any
    },
    async end(): Promise<void> {
      if (sqliteInstance) {
        try {
          sqliteInstance.close()
        } catch {}
        sqliteInstance = null
      }
    },
  }

  return sqlitePool as Pool
}

/** SELECT returning rows. */
export async function query<T extends RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!isMysqlConfigured()) {
    const [rows] = runSqlite<T[]>(sql, params)
    return rows
  }
  const [rows] = (await db().execute(sql, params as never)) as unknown as [T[], unknown]
  return rows
}

/** SELECT returning the first row, or null. */
export async function queryOne<T extends RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

/** INSERT / UPDATE / DELETE. */
export async function exec(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  if (!isMysqlConfigured()) {
    const [res] = runSqlite<ResultSetHeader>(sql, params)
    return res
  }
  const [res] = (await db().execute(sql, params as never)) as unknown as [ResultSetHeader, unknown]
  return res
}

/** Runs `fn` inside a transaction on a dedicated connection. Rolls back on throw. */
export async function transaction<T>(fn: (cx: PoolConnection) => Promise<T>): Promise<T> {
  const cx = await db().getConnection()
  try {
    await cx.beginTransaction()
    const out = await fn(cx)
    await cx.commit()
    return out
  } catch (err) {
    try {
      await cx.rollback()
    } catch {}
    throw err
  } finally {
    cx.release()
  }
}

export type { PoolConnection, ResultSetHeader, RowDataPacket }
