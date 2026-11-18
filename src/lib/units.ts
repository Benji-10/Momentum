/**
 * Unit families and ledger membership — the one place that decides which
 * logged entries speak the goal's own unit.
 *
 * The progress ledger is one system but speaks many units: routine
 * check-offs record checkpoint units ("25 words") or minutes, mirrored
 * metric attempts record results ("128 wpm"), and manual entries can pick
 * any unit ("45 min" of reading on a pages goal). Every row is real,
 * editable history; whether it also moves the goal's own total/pace/time
 * sums is decided HERE, so no sum site can drift from the others.
 */

export const HOUR_UNITS = ['h', 'hr', 'hrs', 'hour', 'hours']
export const MINUTE_UNITS = ['m', 'min', 'mins', 'minute', 'minutes']
export const SESSION_UNITS = ['session', 'sessions']

/** The smallest shape goal-math and the API routes need from a goal row. */
export interface UnitGoalLike {
  type: string
  unit: string | null
}

/** Are these two unit strings the same "family"? h/hr/hours all count as
 *  hours, m/min/minutes as minutes, session/sessions as sessions; anything
 *  else must match exactly. Trim- and case-insensitive. An empty string only
 *  matches another empty string. */
export function sameUnitFamily(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? '').trim().toLowerCase()
  const y = (b ?? '').trim().toLowerCase()
  if (!x || !y) return x === y
  if (HOUR_UNITS.includes(x)) return HOUR_UNITS.includes(y)
  if (MINUTE_UNITS.includes(x)) return MINUTE_UNITS.includes(y)
  if (SESSION_UNITS.includes(x)) return SESSION_UNITS.includes(y)
  return x === y
}

/**
 * Does one ledger entry count toward the goal's own sums — total, weekly
 * bars, pace, projection and the cumulative chart?
 *
 *  - mirrored metric attempts never count: they are recorded results, not
 *    progress amounts (pbId set)
 *  - entries without a unit are in the goal's unit by definition
 *  - session-counting goals (unit blank or "sessions") sum only session-ish
 *    entries; checkpoint units and minutes are history for the tree
 *  - every other goal sums entries whose unit matches its own, family-aware
 *    ("h" ≙ "hours"), so imports and later renames don't orphan rows
 *
 * Time invested (timeSpent) is deliberately broader: it converts ANY
 * time-family entry into hours, whatever the goal counts — see goal-math.
 */
export function countsTowardGoal(
  goal: UnitGoalLike,
  log: { pbId?: string | null; unit?: string | null },
): boolean {
  if (log.pbId != null) return false
  const lu = (log.unit ?? '').trim()
  if (!lu) return true
  const gu = (goal.unit ?? '').trim().toLowerCase()
  if (!gu || SESSION_UNITS.includes(gu)) {
    return SESSION_UNITS.includes(lu.toLowerCase())
  }
  return sameUnitFamily(lu, gu)
}
