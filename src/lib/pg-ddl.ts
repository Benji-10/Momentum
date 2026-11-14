/**
 * DDL that creates every table on a fresh Neon (Postgres) database.
 * Generated from prisma/schema.pg.prisma via `prisma migrate diff --from-empty`.
 * Applied automatically on first request — deploying needs no migration step.
 */
export const PG_BOOTSTRAP_SQL = `-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "settings" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT NOT NULL DEFAULT '🎯',
    "color" TEXT NOT NULL DEFAULT 'emerald',
    "category" TEXT,
    "type" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION,
    "unit" TEXT,
    "weeklyTarget" DOUBLE PRECISION,
    "deadline" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalStep" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "routineId" TEXT,
    "triggerCount" INTEGER NOT NULL DEFAULT 1,
    "metricName" TEXT,
    "metricWindow" INTEGER,
    "metricOp" TEXT,
    "metricValue" DOUBLE PRECISION,
    "currentSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressLog" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalNote" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineItem" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "cadence" TEXT NOT NULL DEFAULT 'weekly',
    "everyNDays" INTEGER,
    "weekdays" TEXT,
    "timesPerWeek" INTEGER,
    "nodeId" TEXT,
    "credit" DOUBLE PRECISION,
    "durationMin" INTEGER,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutineDone" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "creditedValue" DOUBLE PRECISION,
    "logId" TEXT,
    "advancedStepId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutineDone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillPath" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT '🌿',
    "unit" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillPath_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillNode" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT '✨',
    "order" INTEGER NOT NULL DEFAULT 0,
    "currentValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetValue" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "unit" TEXT,
    "xpValue" INTEGER NOT NULL DEFAULT 20,
    "requiresIds" TEXT,
    "deriveFromId" TEXT,
    "deriveFactor" DOUBLE PRECISION,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillMilestone" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "label" TEXT,
    "reachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalBest" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'up',
    "history" TEXT NOT NULL DEFAULT '[]',
    "nodeId" TEXT,
    "nodeMode" TEXT,
    "nodeWindow" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalBest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "GoalStep_goalId_order_idx" ON "GoalStep"("goalId", "order");

-- CreateIndex
CREATE INDEX "ProgressLog_goalId_date_idx" ON "ProgressLog"("goalId", "date");

-- CreateIndex
CREATE INDEX "GoalNote_goalId_createdAt_idx" ON "GoalNote"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "RoutineItem_goalId_idx" ON "RoutineItem"("goalId");

-- CreateIndex
CREATE INDEX "RoutineDone_routineId_date_idx" ON "RoutineDone"("routineId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RoutineDone_routineId_date_key" ON "RoutineDone"("routineId", "date");

-- CreateIndex
CREATE INDEX "SkillPath_goalId_order_idx" ON "SkillPath"("goalId", "order");

-- CreateIndex
CREATE INDEX "SkillNode_pathId_order_idx" ON "SkillNode"("pathId", "order");

-- CreateIndex
CREATE INDEX "SkillNode_goalId_idx" ON "SkillNode"("goalId");

-- CreateIndex
CREATE INDEX "SkillMilestone_nodeId_idx" ON "SkillMilestone"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillMilestone_nodeId_value_key" ON "SkillMilestone"("nodeId", "value");

-- CreateIndex
CREATE INDEX "PersonalBest_goalId_idx" ON "PersonalBest"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalBest_goalId_name_key" ON "PersonalBest"("goalId", "name");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalStep" ADD CONSTRAINT "GoalStep_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalStep" ADD CONSTRAINT "GoalStep_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "RoutineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressLog" ADD CONSTRAINT "ProgressLog_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalNote" ADD CONSTRAINT "GoalNote_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineItem" ADD CONSTRAINT "RoutineItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineItem" ADD CONSTRAINT "RoutineItem_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SkillNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineDone" ADD CONSTRAINT "RoutineDone_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "RoutineItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillPath" ADD CONSTRAINT "SkillPath_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillNode" ADD CONSTRAINT "SkillNode_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillNode" ADD CONSTRAINT "SkillNode_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "SkillPath"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillNode" ADD CONSTRAINT "SkillNode_deriveFromId_fkey" FOREIGN KEY ("deriveFromId") REFERENCES "SkillNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillMilestone" ADD CONSTRAINT "SkillMilestone_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SkillNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalBest" ADD CONSTRAINT "PersonalBest_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

`

/**
 * Incremental upgrades for databases deployed BEFORE a feature existed.
 * The bootstrap check above only looks at the "Goal" table, so an existing
 * deployment would never receive new tables — each entry here is checked
 * and applied on its own, and is written idempotently (IF NOT EXISTS) so
 * racing cold starts can't fight over it.
 *
 * Two shapes:
 *  - { table, sql }            — applied when the *table* is missing
 *  - { table, column, sql }    — applied when the *column* is missing
 *    (for features that add a column to an existing table)
 */
export const PG_MIGRATIONS: { table: string; column?: string; sql: string; sqliteType?: string }[] = [
  {
    table: 'PersonalBest',
    sql: `-- v1.1: personal-best metrics (PB WPM, PB BLD, …)
CREATE TABLE IF NOT EXISTS "PersonalBest" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'up',
    "history" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PersonalBest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PersonalBest_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PersonalBest_goalId_idx" ON "PersonalBest"("goalId");
CREATE UNIQUE INDEX IF NOT EXISTS "PersonalBest_goalId_name_key" ON "PersonalBest"("goalId", "name");`,
  },
  {
    // v1.2: per-account app settings (theme + timezone), synced across devices
    table: 'User',
    column: 'settings',
    sql: `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "settings" TEXT;`,
  },
  {
    // v1.3: extra-credit routines — nice to do, never a penalty when skipped
    table: 'RoutineItem',
    column: 'optional',
    sql: `ALTER TABLE "RoutineItem" ADD COLUMN IF NOT EXISTS "optional" BOOLEAN NOT NULL DEFAULT false;`,
    sqliteType: 'INTEGER NOT NULL DEFAULT 0',
  },
  {
    // v1.4: derived checkpoints — a node that auto-converts another node's
    // progress into its own unit (pages → books). Factor: how many source
    // units make 1 of the derived node's unit.
    table: 'SkillNode',
    column: 'deriveFromId',
    sql: `ALTER TABLE "SkillNode" ADD COLUMN IF NOT EXISTS "deriveFromId" TEXT;`,
  },
  {
    table: 'SkillNode',
    column: 'deriveFactor',
    sql: `ALTER TABLE "SkillNode" ADD COLUMN IF NOT EXISTS "deriveFactor" DOUBLE PRECISION;`,
    sqliteType: 'REAL',
  },
  {
    // v1.5: the unit a log entry was recorded in — routine check-offs whose
    // unit differs from the goal's own (a linked checkpoint's "words", a
    // duration routine's "min") store it here so history rows always show
    // the truth. Null = the goal's unit (all pre-existing rows).
    table: 'ProgressLog',
    column: 'unit',
    sql: `ALTER TABLE "ProgressLog" ADD COLUMN IF NOT EXISTS "unit" TEXT;`,
  },
  {
    // v1.6: step automation — a step can complete itself. "routine": after
    // N check-offs of a (specific or any) routine; "metric": when the
    // rolling average of a personal-best metric crosses a threshold.
    // advancedStepId on RoutineDone lets an undo re-open exactly the step
    // that check-off completed. The FK is Postgres-only (SQLite can't add
    // constraints to an existing table); deleting a routine nulls the link
    // via the app's delete route, which also resets those steps to manual.
    table: 'GoalStep',
    column: 'trigger',
    sql: `ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "trigger" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "routineId" TEXT;
ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "triggerCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "metricName" TEXT;
ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "metricWindow" INTEGER;
ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "metricOp" TEXT;
ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "metricValue" DOUBLE PRECISION;
ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "currentSince" TIMESTAMP(3);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoalStep_routineId_fkey') THEN
    ALTER TABLE "GoalStep" ADD CONSTRAINT "GoalStep_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "RoutineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;`,
    sqliteType: "TEXT NOT NULL DEFAULT 'manual'",
  },
  {
    table: 'GoalStep',
    column: 'routineId',
    sql: `ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "routineId" TEXT;`,
  },
  {
    table: 'GoalStep',
    column: 'triggerCount',
    sql: `ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "triggerCount" INTEGER NOT NULL DEFAULT 1;`,
    sqliteType: 'INTEGER NOT NULL DEFAULT 1',
  },
  {
    table: 'GoalStep',
    column: 'metricName',
    sql: `ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "metricName" TEXT;`,
  },
  {
    table: 'GoalStep',
    column: 'metricWindow',
    sql: `ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "metricWindow" INTEGER;`,
    sqliteType: 'INTEGER',
  },
  {
    table: 'GoalStep',
    column: 'metricOp',
    sql: `ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "metricOp" TEXT;`,
  },
  {
    table: 'GoalStep',
    column: 'metricValue',
    sql: `ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "metricValue" DOUBLE PRECISION;`,
    sqliteType: 'REAL',
  },
  {
    table: 'GoalStep',
    column: 'currentSince',
    sql: `ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "currentSince" TIMESTAMP(3);`,
    sqliteType: 'DATETIME',
  },
  {
    table: 'RoutineDone',
    column: 'advancedStepId',
    sql: `ALTER TABLE "RoutineDone" ADD COLUMN IF NOT EXISTS "advancedStepId" TEXT;`,
  },
  {
    // v1.8: progression links — step target dates ("dates on steps"), and
    // personal-best metrics that feed a skill checkpoint. sum: every attempt
    // adds its value; average: the checkpoint mirrors the rolling average of
    // the last nodeWindow attempts ("up" metrics only). The FK is
    // Postgres-only (SQLite can't add constraints to an existing table);
    // deleting a checkpoint nulls the link via the app's delete route.
    table: 'GoalStep',
    column: 'dueDate',
    sql: `ALTER TABLE "GoalStep" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);`,
    sqliteType: 'DATETIME',
  },
  {
    table: 'PersonalBest',
    column: 'nodeId',
    sql: `ALTER TABLE "PersonalBest" ADD COLUMN IF NOT EXISTS "nodeId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PersonalBest_nodeId_fkey') THEN
    ALTER TABLE "PersonalBest" ADD CONSTRAINT "PersonalBest_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SkillNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;`,
  },
  {
    table: 'PersonalBest',
    column: 'nodeMode',
    sql: `ALTER TABLE "PersonalBest" ADD COLUMN IF NOT EXISTS "nodeMode" TEXT;`,
  },
  {
    table: 'PersonalBest',
    column: 'nodeWindow',
    sql: `ALTER TABLE "PersonalBest" ADD COLUMN IF NOT EXISTS "nodeWindow" INTEGER;`,
    sqliteType: 'INTEGER',
  },
]

/**
 * Split a DDL script into single statements, each executable on its own.
 * Lives here (not in db.ts) so scripts/verify-pg-bootstrap.ts exercises the
 * exact logic ensureDbReady runs against Neon — a private copy in the harness
 * once drifted from the real one and a broken statement shipped.
 *
 * A statement ends at a top-level `;` — one that is NOT inside any of:
 *   - '…' / "…"   string literals and quoted identifiers ('' and "" double
 *                 as escapes, so 'it''s' never closes early)
 *   - $tag$…$tag$ dollar-quoted bodies — DO blocks live here. The v1.6
 *                 step-trigger migration adds its FK inside DO $$ … $$, and
 *                 the previous regex splitter (/;\s*\n/) cut that block at the
 *                 internal ";" after "ON UPDATE CASCADE", shipping Postgres
 *                 the fragment "DO $$ BEGIN … CASCADE" → 42601 "unterminated
 *                 dollar-quoted string" (the 8 Nov 2026 Neon incident).
 *   - -- line comments and block comments (slash-star … star-slash)
 * Comment-only fragments are dropped; everything else is trimmed.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = []
  let buf = ''
  let i = 0
  const end = sql.length
  let lineComment = false
  let blockComment = false
  let quote = '' // "'" / '"' while inside a literal or quoted identifier
  let dollar = '' // "$…$" tag while inside a dollar-quoted body

  const flush = () => {
    const s = buf.trim()
    buf = ''
    if (s.replace(/--[^\n]*/g, '').trim()) out.push(s)
  }

  while (i < end) {
    const ch = sql[i]
    const next = i + 1 < end ? sql[i + 1] : ''

    // ---- inside a context: copy verbatim until it closes ----
    if (lineComment) {
      buf += ch
      if (ch === '\n') lineComment = false
      i++
      continue
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { buf += '*/'; blockComment = false; i += 2; continue }
      buf += ch
      i++
      continue
    }
    if (quote) {
      if (ch === quote && next === quote) { buf += ch + next; i += 2; continue } // doubled = escaped
      if (ch === quote) { buf += ch; quote = ''; i++; continue }
      buf += ch
      i++
      continue
    }
    if (dollar) {
      if (sql.startsWith(dollar, i)) { buf += dollar; i += dollar.length; dollar = ''; continue }
      buf += ch
      i++
      continue
    }

    // ---- top level: detect context openers and the statement end ----
    if (ch === '-' && next === '-') { lineComment = true; buf += '--'; i += 2; continue }
    if (ch === '/' && next === '*') { blockComment = true; buf += '/*'; i += 2; continue }
    if (ch === "'" || ch === '"') { quote = ch; buf += ch; i++; continue }
    const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
    if (tag) { dollar = tag[0]; buf += tag[0]; i += tag[0].length; continue }
    if (ch === ';') { flush(); i++; continue }

    buf += ch
    i++
  }
  flush()
  return out
}
