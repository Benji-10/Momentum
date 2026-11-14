import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal } from '@/lib/api-helpers'
import { serializeGoal } from '@/lib/goal-serialize'
import { syncMilestoneReached } from '@/lib/milestones'
import { nodeStatus } from '@/lib/skill-tree'
import { nodeUnlockedById } from '@/lib/pb-credit'
import { propagateDerived } from '@/lib/derive'
import { autoLogAmount, autoLogNote, checkoffUnit } from '@/lib/recording'
import { evaluateStepTriggers, undoStepAdvance } from '@/lib/step-engine'

const doneSchema = z.object({
  /**
   * The day being checked off. Preferred form: "YYYY-MM-DD" — a day in the
   * user's calendar, unambiguous regardless of timezone. Legacy full ISO
   * timestamps (local midnight of the client) are still accepted.
   */
  date: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().datetime()])
    .optional(),
  /** true = remove the done mark (undo) */
  undo: z.boolean().optional(),
})

type Params = { params: Promise<{ id: string; routineId: string }> }

/**
 * POST /api/goals/[id]/routines/[routineId]/done — toggle a day's completion.
 *
 * Checking a routine off also:
 *  - adds its defined amount to the goal's log ("read 20 minutes", "work 2
 *    hours" become real log entries automatically), and
 *  - advances the linked skill checkpoint by `credit` (if it's unlocked).
 * Undoing takes exactly both back out again.
 */
export async function POST(req: Request, { params }: Params) {
  const { id, routineId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = doneSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid done payload' }, { status: 400 })
    const d = parsed.data
    const goalRow = await db.goal.findFirst({ where: { id, userId: auth.user.id }, select: { id: true, type: true, unit: true } })
    if (!goalRow) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const routine = await db.routineItem.findFirst({ where: { id: routineId, goalId: id } })
    if (!routine) return NextResponse.json({ error: 'Routine not found' }, { status: 404 })

    //
    // The day is derived from the client's calendar, never from the server's
    // clock: a client in UTC+2 sending its local midnight as a full ISO used
    // to get truncated to the *server's* midnight, landing the check-off on
    // the previous day ("synced but doesn't show ticked"). Date-only keys
    // remove the guesswork entirely.
    //
    const dayKey = d.date && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null
    const day = dayKey
      ? new Date(`${dayKey}T00:00:00Z`) // canonical: UTC midnight of that day
      : (() => {
          const x = new Date(d.date ?? Date.now())
          x.setHours(0, 0, 0, 0) // legacy path: server-local midnight
          return x
        })()
    const dayEnd = new Date(day.getTime() + 86_400_000)
    // auto-log instant: UTC noon of the same calendar day, so the log entry
    // dayStarts to the right day on any device within ±12h of UTC.
    const logDay = dayKey ? new Date(`${dayKey}T12:00:00Z`) : day

    const existing = await db.routineDone.findFirst({
      where: { routineId, date: { gte: day, lt: dayEnd } },
    })

    let creditSkipped = false
    let autoLog: { id: string; amount: number; unit: string | null; note: string | null } | null = null
    let removedLog = false
    /** steps completed by this check-off / re-opened by this undo */
    let stepsAdvanced: { id: string; title: string }[] = []
    let stepsReverted: { id: string; title: string }[] = []

    if (d.undo && existing) {
      // take back any progress this check-off had credited to the tree
      if (existing.creditedValue && existing.creditedValue > 0 && routine.nodeId) {
        const node = await db.skillNode.findUnique({ where: { id: routine.nodeId } })
        if (node) {
          const next = Math.max(0, node.currentValue - existing.creditedValue)
          const masteredNow = next >= node.targetValue && node.targetValue > 0
          await db.skillNode.update({
            where: { id: node.id },
            data: { currentValue: next, completedAt: masteredNow ? (node.completedAt ?? new Date()) : null },
          })
          await syncMilestoneReached(node.id, next)
          // derived checkpoints give back their share of the conversion too
          await propagateDerived(id, node.id, -existing.creditedValue)
        }
      }
      // …and remove the log entry the check-off created
      if (existing.logId) {
        const gone = await db.progressLog.deleteMany({ where: { id: existing.logId, goalId: id } })
        removedLog = gone.count > 0
      }
      // …and re-open the plan step this check-off closed, if any (it may
      // complete again on re-evaluation when other check-offs still qualify
      // — in which case nothing changed and nothing is reported)
      if (existing.advancedStepId) {
        const reverted = await undoStepAdvance(existing.advancedStepId)
        if (reverted) stepsReverted = [{ id: reverted.stepId, title: reverted.title }]
      }
      await db.routineDone.delete({ where: { id: existing.id } })
      const reAdvances = await evaluateStepTriggers(id)
      // a step that came right back is not worth a toast — net effect: no-op
      const reDone = new Set(reAdvances.map((a) => a.stepId))
      stepsReverted = stepsReverted.filter((s) => !reDone.has(s.id))
    } else if (!d.undo && !existing) {
      // the linked checkpoint (if any), resolved up-front: its unit decides
      // what the check-off records ("25 words" / "0.33 hours" / "20 min")
      let node: { id: string; currentValue: number; targetValue: number; completedAt: Date | null } | null = null
      let nodeUnit: string | null = null
      if (routine.nodeId) {
        const found = await db.skillNode.findUnique({
          where: { id: routine.nodeId },
          include: { path: { select: { unit: true } } },
        })
        if (found) {
          node = found
          nodeUnit = found.unit ?? found.path.unit ?? null
        }
      }
      // the unit this check-off records in, and how much of it — one shared
      // resolution for the checkpoint credit and the auto-log, so the two
      // can never disagree ("Reading · 20m" on an hours checkpoint = 0.33 h
      // credited AND logged; editing the entry moves both)
      const unit = checkoffUnit(goalRow, routine, nodeUnit)
      const amount = autoLogAmount(goalRow, routine, nodeUnit)
      // credit the linked checkpoint (if unlocked and not yet mastered) —
      // the same amount the auto-log records, so later edits by difference
      // stay exact
      let creditedValue: number | null = null
      if (node && nodeStatus(node) !== 'mastered') {
        const perSession = amount != null && amount > 0 ? amount : 1
        if (await nodeUnlockedById(node.id)) {
          const next = Math.min(node.targetValue, node.currentValue + perSession)
          creditedValue = next - node.currentValue
          const masteredNow = next >= node.targetValue && node.targetValue > 0
          await db.skillNode.update({
            where: { id: node.id },
            data: { currentValue: next, completedAt: masteredNow ? (node.completedAt ?? new Date()) : null },
          })
          await syncMilestoneReached(node.id, next)
          // derived checkpoints convert their share automatically (e.g. the
          // pages checkpoint moved → the books checkpoint advances by Δ/300)
          await propagateDerived(id, node.id, creditedValue)
        } else {
          creditSkipped = true // done, but its checkpoint is still gated
        }
      }
      const done = await db.routineDone.create({
        data: { routineId, date: day, creditedValue, logId: null },
      })
      if (amount != null && amount > 0) {
        const log = await db.progressLog.create({
          data: {
            goalId: id,
            amount,
            unit,
            note: autoLogNote(routine, unit),
            date: logDay,
          },
        })
        await db.routineDone.update({ where: { id: done.id }, data: { logId: log.id } })
        autoLog = { id: log.id, amount, unit, note: log.note }
      }

      // step automation: this check-off may close the plan step the session
      // was working toward. The FIRST advance is the one this tick pushed
      // over the line (later ones in the pass were enabled by it) — stamp it
      // on the done row so an undo re-opens exactly that step.
      const advances = await evaluateStepTriggers(id)
      if (advances.length) {
        stepsAdvanced = advances.map((a) => ({ id: a.stepId, title: a.title }))
        if (advances[0].via === 'routine') {
          await db.routineDone.updateMany({
            where: { id: done.id },
            data: { advancedStepId: advances[0].stepId },
          })
        }
      }
    }

    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({
      goal: goal ? serializeGoal(goal) : null,
      creditSkipped,
      autoLog,
      removedLog,
      stepsAdvanced,
      stepsReverted,
    })
  } catch (e) {
    console.error('POST /api/goals/[id]/routines/[routineId]/done failed', e)
    return NextResponse.json({ error: 'Failed to toggle routine done' }, { status: 500 })
  }
}
