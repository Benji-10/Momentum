import { PrismaClient, Prisma } from '@prisma/client'
import { PG_BOOTSTRAP_SQL, PG_MIGRATIONS } from './pg-ddl'

/**
 * One database client for two worlds:
 *
 *  - local dev / this preview → SQLite (prisma/schema.prisma), the file at
 *    DATABASE_URL=file:… — everything keeps working offline, no setup needed.
 *  - production on Netlify → Neon Postgres (prisma/schema.pg.prisma) via the
 *    DATABASE_URL connection string you set in your Netlify env vars.
 *
 * Both schemas are identical, and each environment generates the matching
 * client into node_modules/@prisma/client — so the rest of the codebase
 * simply uses `db`.
 */

/** True when running against a real Postgres (Neon) connection string. */
export const isPostgresMode = (process.env.DATABASE_URL ?? '').startsWith('postgres')

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pgBootstrapped: Promise<void> | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? (['error'] as const) : (['query'] as const),
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/** Split a DDL script into single statements (mirrors the .sql file layout). */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/^--[^\n]*\n?/gm, '').trim().length > 0)
}

/** Does a table exist? to_regclass() returns regclass, which Prisma's
 *  queryRaw cannot deserialize — always cast to ::text (P2010). */
async function tableExists(table: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ has: string | null }>>(
    Prisma.sql`SELECT to_regclass(${table})::text as has`,
  )
  return !!rows[0]?.has
}

/** Does a column exist on a table? (Postgres — information_schema) */
async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ has: number }>>(
    Prisma.sql`SELECT COUNT(*)::int as has FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}`,
  )
  return (rows[0]?.has ?? 0) > 0
}

/**
 * Keeping the database ready, with zero migration steps for the user:
 *
 *  - a brand-new Neon database gets the whole schema on the very first
 *    authenticated request (idempotent: checked via the Goal table), and
 *  - a deployment that predates a feature gets each missing table (and,
 *    for column additions, each missing column) from PG_MIGRATIONS — so
 *    upgrading is just "deploy the new code".
 */
export function ensureDbReady(): Promise<void> {
  if (!isPostgresMode) return ensureSqliteReady()
  if (!globalForPrisma.pgBootstrapped) {
    globalForPrisma.pgBootstrapped = (async () => {
      // 1. fresh database → create the whole schema in one transaction
      if (!(await tableExists('public."Goal"'))) {
        try {
          await db.$transaction(splitStatements(PG_BOOTSTRAP_SQL).map((sql) => db.$executeRawUnsafe(sql)))
        } catch {
          // two requests racing on first boot — fine as long as the tables exist now
          if (!(await tableExists('public."Goal"'))) throw new Error('Could not create the database schema')
        }
      }
      // 2. existing deployment → apply whatever per-table migrations are missing
      for (const migration of PG_MIGRATIONS) {
        const table = `public."${migration.table}"`
        let missing: boolean
        if (migration.column) {
          missing = !(await columnExists(migration.table, migration.column))
        } else {
          missing = !(await tableExists(table))
        }
        if (!missing) continue
        try {
          await db.$transaction(splitStatements(migration.sql).map((sql) => db.$executeRawUnsafe(sql)))
        } catch {
          // the DDL is idempotent (IF NOT EXISTS), so a racing request that
          // already applied it is the expected "failure"
          const stillMissing = migration.column
            ? !(await columnExists(migration.table, migration.column))
            : !(await tableExists(table))
          if (stillMissing) {
            throw new Error(`Could not upgrade the database schema (${migration.table})`)
          }
        }
      }
    })().catch((e) => {
      globalForPrisma.pgBootstrapped = undefined // let the next request retry
      throw e
    })
  }
  return globalForPrisma.pgBootstrapped
}

/**
 * SQLite (local dev / preview): the file database is created by
 * `prisma db push`, but an existing file predating a schema change won't
 * have new columns. Add them here so local upgrades are also zero-touch.
 * Mirrors the PG migration list where it applies to SQLite.
 */
function ensureSqliteReady(): Promise<void> {
  if (!globalForPrisma.pgBootstrapped) {
    globalForPrisma.pgBootstrapped = (async () => {
      for (const m of PG_MIGRATIONS) {
        if (!m.column) continue // table-creating migrations don't apply: db push made the tables
        // PRAGMA can't take bind parameters — the identifiers below come from
        // our own constant migration list (never user input), so raw is safe
        const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
          `PRAGMA table_info("${m.table}")`,
        )
        if (rows.some((r) => r.name === m.column)) continue
        try {
          await db.$executeRawUnsafe(`ALTER TABLE "${m.table}" ADD COLUMN "${m.column}" TEXT`)
        } catch {
          // racing request or already added — re-check below
          const recheck = await db.$queryRawUnsafe<Array<{ name: string }>>(
            `PRAGMA table_info("${m.table}")`,
          )
          if (!recheck.some((r) => r.name === m.column)) {
            throw new Error(`Could not upgrade the local database (${m.table}.${m.column})`)
          }
        }
      }
    })().catch((e) => {
      globalForPrisma.pgBootstrapped = undefined
      throw e
    })
  }
  return globalForPrisma.pgBootstrapped
}
