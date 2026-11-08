import { db } from './db'

// ---------------------------------------------------------------------------
// Step automation — server-side evaluation engine.
//
// evaluateStepTriggers(goalId) walks a goal's steps in order and completes
// the current one when its trigger is satisfied:
//
//   routine  — `triggerCount` check-offs of the linked routine (or any
//              routine of the goal), made while the step was current
//              (`currentSince`). A check-off only counts for the step that
//              was current at the time, so ticks never "catch up" a future
//              step: when step N completes, step N+1 starts counting from
//              the day AFTER the check-off that closed step N.
//   metric   — the rolling average of the last `metricWindow` attempts of
//              the `metricName` personal best must cross `metricValue`
//              ("under" = drop below, "over" = rise above). The next step
//              counts from the day after the newest attempt.
//   manual   — never auto-completes (the plan tab's tick).
//
// Completing a step stamps completedAt, flips the step after it to
// in_progress with a fresh currentSince, and returns the list of advances
// so callers can toast them. Runs are idempotent: already-done steps are
// skipped, and a partial state simply stops at the first unsatisfied step.
//
// Undo: the routine done route stamps advancedStepId on the RoutineDone row
// that closed a step; undoStepAdvance() re-opens exactly that step (if it
// is still done) before re-evaluating, so an undo takes back precisely what
// the check-off added — never more.
// ---------------------------------------------------------------------------

export interface StepAdvance {
  stepId: string
  title: string
  via: 'routine' | 'metric'
}

/** UTC midnight of the day AFTER the given instant's UTC day. */
function dayAfterUtc(d: Date): Date {
  const key = d.toISOString().slice(0, 10) // UTC YYYY-MM-DD
  const next = new Date(`${key}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return next
}

interface StepRow {
  id: string
  title: string
  order: number
  status: string
  trigger: string | null
  routineId: string | null
  triggerCount: number | null
  metricName: string | null
  metricWindow: number | null
  metricOp: string | null
  metricValue: number | null
  currentSince: Date | null
}

async function loadSteps(goalId: string): Promise<StepRow[]> {
  // Prisma's row type carries these fields (plus extras) — structurally a
  // StepRow, so the goal's ordered plan lands here without a cast dance.
  return db.goalStep.findMany({ where: { goalId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] })
}

/** Check-offs that count toward the current step (its routine, or any). */
async function qualifyingDones(goalId: string, step: StepRow) {
  const routineIds = step.routineId
    ? [step.routineId]
    : (await db.routineItem.findMany({ where: { goalId }, select: { id: true } })).map((r) => r.id)
  if (!routineIds.length) return { count: 0, lastDay: null as Date | null }
  const rows = await db.routineDone.findMany({
    where: { routineId: { in: routineIds }, ...(step.currentSince ? { date: { gte: step.currentSince } } : {}) },
    select: { date: true },
  })
  const lastDay = rows.reduce<Date | null>((m, r) => (!m || r.date > m ? r.date : m), null)
  return { count: rows.length, lastDay }
}

/** Rolling-average state of the step's metric, or null when it can't run. */
async function metricState(goalId: string, step: StepRow) {
  if (!step.metricName) return null
  const pb = await db.personalBest.findFirst({ where: { goalId, name: step.metricName } })
  if (!pb) return null
  let records: { date: string; value: number }[] = []
  try {
    const parsed = JSON.parse(pb.history)
    if (Array.isArray(parsed)) records = parsed
  } catch {
    records = []
  }
  const window = Math.max(1, step.metricWindow ?? 3)
  const value = step.metricValue
  const op = step.metricOp ?? 'under'
  if (value == null || records.length < window) {
    return { satisfied: false as const, lastDay: null as Date | null }
  }
  const sorted = [...records].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  const last = sorted.slice(-window)
  const avg = last.reduce((s, r) => s + (typeof r.value === 'number' ? r.value : 0), 0) / window
  const newest = new Date(last[last.length - 1].date)
  const satisfied = op === 'under' ? avg < value : avg > value
  return { satisfied, lastDay: satisfied ? newest : null }
}

/**
 * Evaluate and complete steps for a goal. Returns the advances that happened
 * this run (empty when nothing changed). Safe to call after any mutation:
 * check-offs, PB records, step edits, imports.
 */
export async function evaluateStepTriggers(goalId: string): Promise<StepAdvance[]> {
  const advances: StepAdvance[] = []
  // bounded: one goal may hold at most 100 steps; every pass completes at
  // least one or stops, so 100 iterations is a hard ceiling
  for (let guard = 0; guard < 100; guard++) {
    const steps = await loadSteps(goalId)
    const idx = steps.findIndex((s) => s.status !== 'done')
    if (idx < 0) break
    const current = steps[idx]
    const kind = current.trigger ?? 'manual'
    if (kind === 'manual') break

    let satisfied = false
    let nextSince: Date | null = null

    if (kind === 'routine') {
      const { count, lastDay } = await qualifyingDones(goalId, current)
      if (count >= Math.max(1, current.triggerCount ?? 1)) {
        satisfied = true
        nextSince = lastDay ? dayAfterUtc(lastDay) : null
      }
    } else if (kind === 'metric') {
      const m = await metricState(goalId, current)
      if (m?.satisfied) {
        satisfied = true
        nextSince = m.lastDay ? dayAfterUtc(m.lastDay) : null
      }
    }
    if (!satisfied) break

    const now = new Date()
    await db.goalStep.update({
      where: { id: current.id },
      data: { status: 'done', completedAt: now },
    })
    advances.push({ stepId: current.id, title: current.title, via: kind as 'routine' | 'metric' })

    // promote the next step: it becomes current as of the day after the
    // event that closed this one (that check-off/attempt was "consumed")
    const next = steps[idx + 1]
    if (next && next.status !== 'done') {
      await db.goalStep.update({
        where: { id: next.id },
        data: {
          status: 'in_progress',
          currentSince: nextSince ?? now,
        },
      })
    }
  }
  return advances
}

/**
 * Undo path: re-open the step a check-off closed (if it is still done), so a
 * re-evaluation can decide its fate from the remaining history. Returns the
 * step that was re-opened, or null.
 */
export async function undoStepAdvance(stepId: string): Promise<StepAdvance | null> {
  const step = await db.goalStep.findUnique({ where: { id: stepId } })
  if (!step || step.status !== 'done') return null
  await db.goalStep.update({
    where: { id: stepId },
    data: { status: 'in_progress', completedAt: null },
  })
  return { stepId: step.id, title: step.title, via: (step.trigger ?? 'routine') as 'routine' | 'metric' }
}
