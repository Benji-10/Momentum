import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal } from '@/lib/api-helpers'
import { serializeGoal } from '@/lib/goal-serialize'
import { syncMilestoneReached } from '@/lib/milestones'
import { nodeDependencies, buildNodeIndex, nodeStatus } from '@/lib/skill-tree'
import { propagateDerived } from '@/lib/derive'

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

const HOUR_UNITS = ['h', 'hr', 'hrs', 'hour', 'hours']
const MINUTE_UNITS = ['m', 'min', 'mins', 'minute', 'minutes']
const SESSION_UNITS = ['session', 'sessions']

/**
 * The amount a check-off logs, expressed in the goal's unit:
 *  - hour/minute goals get the routine's duration (90m → 1.5 hours)
 *  - session-counting goals (and unit-less plan goals) log one session —
 *    the note keeps the duration visible ("Shooting drills · 45m")
 *  - other units (km, books, words…) only log when the routine defines a
 *    per-session credit — minutes can't be conjured into books
 */
function autoLogAmount(
  goal: { type: string; unit: string | null },
  routine: { durationMin: number | null; credit: number | null },
): number | null {
  const unit = (goal.unit ?? '').toLowerCase()
  const hasDur = routine.durationMin != null && routine.durationMin > 0
  const credit = routine.credit != null && routine.credit > 0 ? routine.credit : null
  if (SESSION_UNITS.includes(unit)) return 1
  if (HOUR_UNITS.includes(unit)) return hasDur ? Math.round((routine.durationMin! / 60) * 100) / 100 : credit
  if (MINUTE_UNITS.includes(unit)) return hasDur ? routine.durationMin! : credit
  if (!unit && goal.type === 'plan') return 1
  return credit
}

/** Note for the auto log — keeps the duration visible unless the amount
 *  already expresses it (then it would just repeat itself). */
function autoLogNote(
  goal: { type: string; unit: string | null },
  routine: { title: string; durationMin: number | null },
): string {
  const unit = (goal.unit ?? '').toLowerCase()
  if (routine.durationMin != null && routine.durationMin > 0 && !HOUR_UNITS.includes(unit) && !MINUTE_UNITS.includes(unit)) {
    return `${routine.title} · ${routine.durationMin}m`
  }
  return routine.title
}

/**
 * Is the node unlocked right now? (all of its dependencies mastered).
 * Mirrors the client-side logic so crediting can never bypass gating.
 */
async function nodeUnlocked(nodeId: string): Promise<boolean> {
  const node = await db.skillNode.findUnique({ where: { id: nodeId }, include: { path: { include: { nodes: true } } } })
  if (!node) return false
  const paths = [node.path]
  const index = buildNodeIndex(
    paths.map((p) => ({ ...p, nodes: p.nodes.sort((a, b) => a.order - b.order) })),
  )
  const sorted = [...node.path.nodes].sort((a, b) => a.order - b.order)
  const prev = sorted[sorted.findIndex((n) => n.id === nodeId) - 1] ?? null
  const { deps } = nodeDependencies(node, prev, index)
  return deps.every((d) => d.mastered)
}

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
    let autoLog: { id: string; amount: number; note: string | null } | null = null
    let removedLog = false

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
      await db.routineDone.delete({ where: { id: existing.id } })
    } else if (!d.undo && !existing) {
      // credit the linked checkpoint, if the routine points at one that is unlocked
      let creditedValue: number | null = null
      if (routine.nodeId && routine.credit && routine.credit > 0) {
        const node = await db.skillNode.findUnique({ where: { id: routine.nodeId } })
        if (node && nodeStatus(node) !== 'mastered') {
          if (await nodeUnlocked(node.id)) {
            const next = Math.min(node.targetValue, node.currentValue + routine.credit)
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
      }
      // log the defined amount automatically ("read 20 minutes" → log entry)
      const amount = autoLogAmount(goalRow, routine)
      const done = await db.routineDone.create({
        data: { routineId, date: day, creditedValue, logId: null },
      })
      if (amount != null && amount > 0) {
        const log = await db.progressLog.create({
          data: {
            goalId: id,
            amount,
            note: autoLogNote(goalRow, routine),
            date: logDay,
          },
        })
        await db.routineDone.update({ where: { id: done.id }, data: { logId: log.id } })
        autoLog = { id: log.id, amount, note: log.note }
      }
    }

    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null, creditSkipped, autoLog, removedLog })
  } catch (e) {
    console.error('POST /api/goals/[id]/routines/[routineId]/done failed', e)
    return NextResponse.json({ error: 'Failed to toggle routine done' }, { status: 500 })
  }
}
