import { db } from './db'

// ---------------------------------------------------------------------------
// Danger zone — the two big red buttons.
//
//   resetAllProgress: zero out every progress field but keep the roadmap
//     (goals, steps, branches, checkpoints, sub-checkpoints, routines, PB
//     definitions and notes all stay; values, history and check-offs go).
//   wipeAllData: delete every goal (and, by cascade, everything under them).
//     The account and its synced settings survive.
//
// Both are exposed through /api/danger, which requires the user to type a
// confirmation word — these functions assume the caller already checked it.
// ---------------------------------------------------------------------------

export interface ResetProgressStats {
  goals: number
  nodesReset: number
  milestonesReset: number
  stepsReset: number
  routines: number
  donesDeleted: number
  logsDeleted: number
  pbRecordsCleared: number
}

/** Zero all progress across every goal of the user; keep the structure. */
export async function resetAllProgress(userId: string): Promise<ResetProgressStats> {
  const goals = await db.goal.findMany({ where: { userId }, select: { id: true } })
  const ids = goals.map((g) => g.id)
  if (ids.length === 0) {
    return {
      goals: 0,
      nodesReset: 0,
      milestonesReset: 0,
      stepsReset: 0,
      routines: 0,
      donesDeleted: 0,
      logsDeleted: 0,
      pbRecordsCleared: 0,
    }
  }

  const [nodesReset, milestonesReset, stepsReset, routines, donesDeleted, logsDeleted, pbs] =
    await Promise.all([
      db.skillNode.count({ where: { goalId: { in: ids } } }),
      db.skillMilestone.count({ where: { node: { goalId: { in: ids } }, reachedAt: { not: null } } }),
      db.goalStep.count({ where: { goalId: { in: ids }, status: 'done' } }),
      db.routineItem.count({ where: { goalId: { in: ids } } }),
      db.routineDone.count({ where: { routine: { goalId: { in: ids } } } }),
      db.progressLog.count({ where: { goalId: { in: ids } } }),
      db.personalBest.findMany({ where: { goalId: { in: ids } }, select: { history: true } }),
    ])

  let pbRecordsCleared = 0
  for (const pb of pbs) {
    try {
      const parsed = JSON.parse(pb.history)
      if (Array.isArray(parsed)) pbRecordsCleared += parsed.length
    } catch {
      // corrupt history counts as nothing to clear
    }
  }

  await db.$transaction([
    db.skillNode.updateMany({
      where: { goalId: { in: ids } },
      data: { currentValue: 0, completedAt: null },
    }),
    db.skillMilestone.updateMany({
      where: { node: { goalId: { in: ids } } },
      data: { reachedAt: null },
    }),
    db.goalStep.updateMany({
      where: { goalId: { in: ids } },
      data: { status: 'pending', completedAt: null },
    }),
    db.routineDone.deleteMany({ where: { routine: { goalId: { in: ids } } } }),
    db.progressLog.deleteMany({ where: { goalId: { in: ids } } }),
    db.personalBest.updateMany({ where: { goalId: { in: ids } }, data: { history: '[]' } }),
  ])

  return {
    goals: ids.length,
    nodesReset,
    milestonesReset,
    stepsReset,
    routines,
    donesDeleted,
    logsDeleted,
    pbRecordsCleared,
  }
}

export interface WipeStats {
  goalsDeleted: number
}

/** Delete every goal (cascades to steps, logs, notes, routines, dones, paths,
 *  nodes, milestones and PBs). Account + settings stay. */
export async function wipeAllData(userId: string): Promise<WipeStats> {
  const res = await db.goal.deleteMany({ where: { userId } })
  return { goalsDeleted: res.count }
}
