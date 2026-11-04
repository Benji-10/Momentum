import { PrismaClient } from '@prisma/client'
import { PG_BOOTSTRAP_SQL } from './pg-ddl'

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

/**
 * On a brand-new Neon database the tables don't exist yet. Instead of asking
 * anyone to run migrations, the very first authenticated request creates the
 * whole schema (idempotent: it checks for the Goal table first).
 */
export function ensureDbReady(): Promise<void> {
  if (!isPostgresMode) return Promise.resolve()
  if (!globalForPrisma.pgBootstrapped) {
    globalForPrisma.pgBootstrapped = (async () => {
      const check = async () =>
        (await db.$queryRaw<Array<{ has: string | null }>>`SELECT to_regclass('public."Goal"') as has`)[0]?.has
      if (await check()) return
      const statements = PG_BOOTSTRAP_SQL.split(/;\s*\n/)
        .map((s) => s.trim())
        .filter((s) => s.replace(/^--[^\n]*\n?/gm, '').trim().length > 0)
      try {
        await db.$transaction(statements.map((sql) => db.$executeRawUnsafe(sql)))
      } catch {
        // two requests racing on first boot — fine as long as the tables exist now
        if (!(await check())) throw new Error('Could not create the database schema')
      }
    })().catch((e) => {
      globalForPrisma.pgBootstrapped = undefined // let the next request retry
      throw e
    })
  }
  return globalForPrisma.pgBootstrapped
}
