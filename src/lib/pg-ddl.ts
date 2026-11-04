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

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalStep" ADD CONSTRAINT "GoalStep_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "SkillMilestone" ADD CONSTRAINT "SkillMilestone_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "SkillNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PersonalBest" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'up',
    "history" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalBest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalBest_goalId_idx" ON "PersonalBest"("goalId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalBest_goalId_name_key" ON "PersonalBest"("goalId", "name");

-- AddForeignKey
ALTER TABLE "PersonalBest" ADD CONSTRAINT "PersonalBest_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

`

/**
 * Incremental upgrades for databases deployed BEFORE a feature existed.
 * The bootstrap check above only looks at the "Goal" table, so an existing
 * deployment would never receive new tables — each entry here is checked
 * and applied on its own, and is written idempotently (IF NOT EXISTS) so
 * racing cold starts can't fight over it.
 */
export const PG_MIGRATIONS: { table: string; sql: string }[] = [
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
]
