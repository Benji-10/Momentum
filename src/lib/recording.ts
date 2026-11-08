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
 * Resolution order for one check-off:
 *  1. the goal itself counts time (hours/minutes) → the routine's duration
 *     is the amount ("Reading · 20m" on an hours goal → 0.33 h)
 *  2. the routine is linked to a checkpoint that declares a unit → `credit`
 *     (default 1) of that unit, or the duration converted to it when the
 *     checkpoint counts time ("Vocab drills · 20m" on a words checkpoint →
 *     25 words; "Reading · 20m" on an hours checkpoint → 0.33 h)
 *  3. a routine with a duration on a goal that just counts sessions → the
 *     duration in minutes. Ticking "Reading · 20m" logs 20 min of reading,
 *     not "1 session" — the session still counts toward the weekly
 *     commitment, but the log records the time actually spent
 *  4. anything else → one session (or `credit` in the goal's unit)
 *
 * The unit actually used is STORED on the log row, so history rows always
 * display the truth even if the goal's unit changes later. Editing the
 * entry adjusts the linked checkpoint by the difference (see the /done and
 * /logs API routes).
 *
 * Shared by the API routes (amount + unit to store) and the client (unit to
 * show), so the two can never drift apart again.
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

/** Does a *unit string* count time? (works for goal units and checkpoint units) */
export function isTimeUnitString(unit: string | null | undefined): boolean {
  const u = (unit ?? '').toLowerCase()
  return HOUR_UNITS.includes(u) || MINUTE_UNITS.includes(u)
}

/** Does this goal just count sessions (unit blank or "sessions") — i.e. the
 * log's own unit isn't a real measured quantity? */
function isSessionIshGoal(goal: GoalLike): boolean {
  const u = (goal.unit ?? '').toLowerCase()
  return !u || SESSION_UNITS.includes(u)
}

/** A plan goal whose own ledger has no real unit — checkpoints and routine
 * durations may still record real quantities (words, minutes). */
function isPlanSessionGoal(goal: GoalLike): boolean {
  return goal.type === 'plan' && isSessionIshGoal(goal) && !isTimeUnitGoal(goal)
}

/**
 * The unit a check-off records progress in:
 *  1. hour/minute goals → the goal's own unit
 *  2. a linked checkpoint with a unit (on a session-counting plan goal) →
 *     the checkpoint's unit (node unit, else path unit)
 *  3. a duration routine on a session-counting plan goal → 'min': the time
 *     itself is the real quantity
 *  4. otherwise the goal's own unit. Null when nothing suitable exists.
 */
export function checkoffUnit(goal: GoalLike, routine: RoutineLike, nodeUnit: string | null): string | null {
  if (isTimeUnitGoal(goal)) return goal.unit
  if (routine.nodeId && isPlanSessionGoal(goal) && nodeUnit) {
    return nodeUnit
  }
  if (!routine.nodeId && isPlanSessionGoal(goal) && routine.durationMin != null && routine.durationMin > 0) {
    return 'min'
  }
  return goal.unit
}

/**
 * How much progress one check-off logs, expressed in checkoffUnit units
 * (see the module doc for the resolution order and examples).
 */
export function autoLogAmount(
  goal: GoalLike,
  routine: RoutineLike,
  nodeUnit: string | null,
): number | null {
  const u = (goal.unit ?? '').toLowerCase()
  const hasDur = routine.durationMin != null && routine.durationMin > 0
  const credit = routine.credit != null && routine.credit > 0 ? routine.credit : null
  const durHours = hasDur ? Math.round((routine.durationMin! / 60) * 100) / 100 : null

  // 1. the goal counts time — the duration is the amount
  if (HOUR_UNITS.includes(u)) return hasDur ? durHours : credit
  if (MINUTE_UNITS.includes(u)) return hasDur ? routine.durationMin! : credit

  // 2. linked checkpoint: its unit decides what a session is worth
  if (routine.nodeId && isPlanSessionGoal(goal)) {
    const nu = (nodeUnit ?? '').toLowerCase()
    if (HOUR_UNITS.includes(nu)) return hasDur ? durHours : (credit ?? 1)
    if (MINUTE_UNITS.includes(nu)) return hasDur ? routine.durationMin! : (credit ?? 1)
    if (nodeUnit) return credit ?? 1 // "Vocab drills · 20m" → 25 words
    return credit ?? 1 // unitless checkpoint: one session's worth
  }

  // 3. session-counting plan goal: a duration routine logs its time
  if (isPlanSessionGoal(goal)) {
    if (hasDur) return routine.durationMin // "Reading · 20m" → 20 min
    return 1 // no duration, no link — one session
  }

  // 4. anything else: one session, or credit in the goal's own unit.
  // (A quantitative goal whose unit IS sessions counts sessions toward its
  // target — those check-offs must stay 1, not become minutes.)
  if (SESSION_UNITS.includes(u)) return 1
  if (!u && goal.type === 'plan') return 1
  return credit
}

/**
 * Note for a check-off's auto log. The duration stays visible in the note
 * unless the amount already expresses it (then it would just repeat itself).
 */
export function autoLogNote(
  routine: { title: string; durationMin: number | null },
  unit: string | null,
): string {
  if (
    routine.durationMin != null &&
    routine.durationMin > 0 &&
    !isTimeUnitString(unit)
  ) {
    return `${routine.title} · ${routine.durationMin}m`
  }
  return routine.title
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
 * editor. Prefers the unit stored on the log; falls back to resolving the
 * rule above, then the goal's unit, then "session"/"progress".
 */
export function checkoffDisplayUnit(goal: GoalData, routine: RoutineData): string {
  const unit = checkoffUnit(goal, routine, routineNodeUnit(goal, routine))
  if (unit) return unit
  return goal.type === 'plan' ? 'session' : 'progress'
}

/**
 * logId → unit for auto-logs written by a linked-routine check-off BEFORE
 * log rows carried their own unit. Built once per goal; history rows use it
 * so "10 words" never shows as "10 sessions" again. Empty for time-unit
 * goals (their ledger is the goal's own unit) and for logs in the goal's
 * unit anyway.
 *
 * Unlinked duration routines are deliberately NOT mapped: every pre-unit
 * entry they produced recorded "1 session", and that is exactly what the
 * goal-unit fallback displays for them — no mislabeling of history.
 */
export function linkedLogUnits(goal: GoalData): Map<string, string> {
  const map = new Map<string, string>()
  if (isTimeUnitGoal(goal)) return map
  if (!isPlanSessionGoal(goal)) return map
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

/** The unit a history row displays: what it was recorded in, else the
 *  legacy inference, else the goal's own. */
export function logRowUnit(goal: GoalData, log: Pick<ProgressLogData, 'id' | 'unit'>): string {
  if (log.unit) return log.unit
  const inferred = linkedLogUnits(goal).get(log.id)
  if (inferred) return inferred
  return goal.unit ?? (goal.type === 'plan' ? 'sessions' : 'units')
}

/** "1 session" / "10 words" / "7.5 km" — amount + unit for chips and toasts. */
export function logAmountLabel(amount: number, unit: string): string {
  // "1 word", "10 words" — strip the plural s for the singular form
  // (sessions → session, words → word; unit-less strings like "km" pass through)
  const singular = unit.replace(/s$/i, '')
  return `${formatNumber(amount)} ${amount === 1 ? singular : unit}`
}
