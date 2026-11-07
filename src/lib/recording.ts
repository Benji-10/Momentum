import type { GoalData, ProgressLogData, RoutineData } from './types'
import { formatNumber } from './goal-math'

/**
 * What a routine check-off RECORDS, and in which unit.
 *
 * Two ledgers meet here:
 *  - the goal's own log (history, weekly commitment, pace) — in the goal's
 *    unit, e.g. "sessions", "hours", "km"
 *  - the linked skill checkpoint — measured in the checkpoint's unit, e.g.
 *    "words" (node unit, or the path's unit)
 *
 * When a routine is linked to a checkpoint, one check-off is worth `credit`
 * (default 1) of that checkpoint's unit, the auto-log entry is written in
 * that unit, and editing the entry adjusts the checkpoint by the difference
 * (see the /done and /logs API routes). Time-counting goals (hours/minutes)
 * keep their duration-based ledger regardless — minutes can't be conjured
 * into words.
 *
 * Shared by the API routes (amount to store) and the client (unit to show),
 * so the two can never drift apart again.
 */

const HOUR_UNITS = ['h', 'hr', 'hrs', 'hour', 'hours']
const MINUTE_UNITS = ['m', 'min', 'mins', 'minute', 'minutes']
const SESSION_UNITS = ['session', 'sessions']

/** Minimal structural types: Prisma rows and client wire data both fit. */
interface GoalLike {
  type: string
  unit: string | null
}
interface RoutineLike {
  nodeId: string | null
  durationMin: number | null
  credit: number | null
}

export function isTimeUnitGoal(goal: GoalLike): boolean {
  const u = (goal.unit ?? '').toLowerCase()
  return HOUR_UNITS.includes(u) || MINUTE_UNITS.includes(u)
}

/**
 * The unit a linked check-off records progress in: the checkpoint's unit
 * (node unit, else path unit) when the goal itself just counts sessions;
 * otherwise the goal's own unit. Null when nothing suitable exists.
 */
export function checkoffUnit(goal: GoalLike, routine: RoutineLike, nodeUnit: string | null): string | null {
  const u = (goal.unit ?? '').toLowerCase()
  if (HOUR_UNITS.includes(u) || MINUTE_UNITS.includes(u)) return goal.unit
  if (routine.nodeId && goal.type === 'plan' && (!u || SESSION_UNITS.includes(u)) && nodeUnit) {
    return nodeUnit
  }
  return goal.unit
}

/**
 * How much progress one check-off logs, expressed in checkoffUnit units:
 *  - hour/minute goals log the routine's duration (90m → 1.5 hours)
 *  - a routine linked to a checkpoint logs `credit` per session (default 1)
 *    — "Vocab drills · 25 words" — editable right after check-off
 *  - session-counting goals (and unit-less plan goals) log one session
 *  - other units (km, books…) only log when the routine defines a credit
 */
export function autoLogAmount(
  goal: GoalLike,
  routine: RoutineLike,
  nodeUnit: string | null,
): number | null {
  const u = (goal.unit ?? '').toLowerCase()
  const hasDur = routine.durationMin != null && routine.durationMin > 0
  const credit = routine.credit != null && routine.credit > 0 ? routine.credit : null
  if (HOUR_UNITS.includes(u)) {
    return hasDur ? Math.round((routine.durationMin! / 60) * 100) / 100 : credit
  }
  if (MINUTE_UNITS.includes(u)) return hasDur ? routine.durationMin! : credit
  if (routine.nodeId) return credit ?? 1 // a session is worth credit (default 1) of the linked unit
  if (SESSION_UNITS.includes(u)) return 1
  if (!u && goal.type === 'plan') return 1
  return credit
}

/** The linked checkpoint's unit for a routine, from wire data (client side). */
export function routineNodeUnit(goal: GoalData, routine: Pick<RoutineData, 'nodeId'>): string | null {
  if (!routine.nodeId) return null
  for (const p of goal.skillPaths) {
    for (const n of p.nodes) {
      if (n.id === routine.nodeId) return n.unit ?? p.unit ?? null
    }
  }
  return null
}

/**
 * Display unit for a check-off's auto-log, as shown in toasts and the log
 * editor. Falls back to the goal's unit, then "session"/"progress".
 */
export function checkoffDisplayUnit(goal: GoalData, routine: RoutineData): string {
  const unit = checkoffUnit(goal, routine, routineNodeUnit(goal, routine))
  if (unit) return unit
  return goal.type === 'plan' ? 'session' : 'progress'
}

/**
 * logId → unit for every auto-log written by a linked-routine check-off.
 * Built once per goal; history rows use it so "10 words" never shows as
 * "10 sessions" again. Empty for time-unit goals (their ledger is the
 * goal's own unit) and for logs in the goal's unit anyway.
 */
export function linkedLogUnits(goal: GoalData): Map<string, string> {
  const map = new Map<string, string>()
  if (isTimeUnitGoal(goal)) return map
  const u = (goal.unit ?? '').toLowerCase()
  if (!(goal.type === 'plan' && (!u || SESSION_UNITS.includes(u)))) return map
  const nodeUnitById = new Map<string, string>()
  for (const p of goal.skillPaths) {
    for (const n of p.nodes) nodeUnitById.set(n.id, (n.unit ?? p.unit ?? '').trim())
  }
  for (const r of goal.routines) {
    if (!r.nodeId) continue
    const unit = nodeUnitById.get(r.nodeId) ?? ''
    if (!unit) continue
    for (const d of r.dones) {
      if (d.logId) map.set(d.logId, unit)
    }
  }
  return map
}

/** "1 session" / "10 words" / "7.5 km" — amount + unit for chips and toasts. */
export function logAmountLabel(amount: number, unit: string): string {
  // "1 word", "10 words" — strip the plural s for the singular form
  // (sessions → session, words → word; unit-less strings like "km" pass through)
  const singular = unit.replace(/s$/i, '')
  return `${formatNumber(amount)} ${amount === 1 ? singular : unit}`
}
