import { db } from './db'
import { goalInclude } from './goal-serialize'
import type { Prisma } from '@prisma/client'
import type { SessionUser } from './auth'

export type GoalWithRelations = Prisma.GoalGetPayload<{ include: typeof goalInclude }>

/**
 * Load one of the signed-in user's goals (with relations), or null.
 * Every /api/goals/[id]/… route goes through this so data stays private
 * per account — your laptop and your phone see the same goals, other
 * accounts see none of them.
 */
export async function ownedGoal(goalId: string, user: SessionUser): Promise<GoalWithRelations | null> {
  return (await db.goal.findFirst({ where: { id: goalId, userId: user.id }, include: goalInclude })) as
    | GoalWithRelations
    | null
}

/** Ownership-only check (no relations fetched). */
export async function ownsGoal(goalId: string, user: SessionUser): Promise<boolean> {
  const found = await db.goal.findFirst({ where: { id: goalId, userId: user.id }, select: { id: true } })
  return found != null
}
