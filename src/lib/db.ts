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

/**
 * Keeping the database ready, with zero migration steps for the user:
 *
 *  - a brand-new Neon database gets the whole schema on the very first
 *    authenticated request (idempotent: checked via the Goal table), and
 *  - a deployment that predates a feature gets each missing table from
 *    PG_MIGRATIONS — so upgrading is just "deploy the new code".
 */
export function ensureDbReady(): Promise<void> {
  if (!isPostgresMode) return Promise.resolve()
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
        if (await tableExists(table)) continue
        try {
          await db.$transaction(splitStatements(migration.sql).map((sql) => db.$executeRawUnsafe(sql)))
        } catch {
          // the DDL is idempotent (IF NOT EXISTS), so a racing request that
          // already created the table is the expected "failure"
          if (!(await tableExists(table))) {
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
