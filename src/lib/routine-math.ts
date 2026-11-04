import type { RoutineData } from './types'

export const DAY_MS = 86_400_000
export const WEEK_MS = 7 * DAY_MS

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] // Mon-first display order

/** Monday 00:00 of the week containing d. */
export function startOfWeek(d: Date): Date {
  const copy = new Date(d)
  const day = (copy.getDay() + 6) % 7 // Mon = 0
  copy.setDate(copy.getDate() - day)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function endOfWeek(d: Date): Date {
  const s = startOfWeek(d)
  return new Date(s.getTime() + WEEK_MS - 1)
}

/** Normalize any date to midnight of its day (local). */
export function dayStart(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + n)
  return copy
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function isToday(d: Date): boolean {
  return sameDay(d, new Date())
}

/** Effective end date for a routine: its own end, the goal deadline, or +2 years. */
export function routineEffectiveEnd(r: RoutineData, goalDeadline: string | null): Date {
  if (r.endDate) return new Date(r.endDate)
  if (goalDeadline) return new Date(goalDeadline)
  return new Date(Date.now() + 2 * 365 * DAY_MS)
}

function parseWeekdays(csv: string | null): number[] {
  if (!csv) return []
  return csv
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => n >= 0 && n <= 6)
}

/** Normalized in-memory view of a routine. */
export interface RoutineView {
  data: RoutineData
  weekdays: number[]
  start: Date
  end: Date
}

export function routineView(r: RoutineData, goalDeadline: string | null): RoutineView {
  return {
    data: r,
    weekdays: r.cadence === 'weekly' ? (r.weekdays ?? []) : [],
    start: dayStart(new Date(r.startDate)),
    end: routineEffectiveEnd(r, goalDeadline),
  }
}

/** Does the routine have an occurrence on the given day? (Flexible routines
 *  float: they never pin to a day — see weekFlexProgress.) */
export function occursOn(rv: RoutineView, day: Date): boolean {
  const d = dayStart(day)
  if (d < rv.start || d > rv.end) return false
  if (rv.data.cadence === 'flexible') return false
  if (rv.data.cadence === 'interval') {
    const n = rv.data.everyNDays ?? 0
    if (n <= 0) return false
    const diff = Math.round((d.getTime() - rv.start.getTime()) / DAY_MS)
    return diff >= 0 && diff % n === 0
  }
  return rv.weekdays.includes(d.getDay())
}

/** Flexible routines: sessions done vs the weekly target, for one week. */
export function weekFlexProgress(r: RoutineData, weekStart: Date): { done: number; target: number; left: number } {
  const ws = dayStart(weekStart)
  const we = addDays(ws, 7)
  const done = r.dones.filter((d) => {
    const dt = dayStart(new Date(d.date))
    return dt >= ws && dt < we
  }).length
  const target = r.timesPerWeek ?? 0
  return { done, target, left: Math.max(0, target - done) }
}

/** Human description of the recurrence, e.g. "Every 2 days" / "Mon, Wed, Fri". */
export function describeCadence(r: {
  cadence: RoutineData['cadence']
  everyNDays: number | null
  weekdays: number[] | null
  timesPerWeek?: number | null
}): string {
  if (r.cadence === 'flexible') {
    const n = r.timesPerWeek ?? 1
    return `${n}\u00d7 a week \u00b7 any day`
  }
  if (r.cadence === 'interval') {
    const n = r.everyNDays ?? 1
    return n === 1 ? 'Every day' : n === 2 ? 'Every 2 days' : `Every ${n} days`
  }
  const days = r.weekdays ?? []
  if (days.length === 0) return 'Weekly'
  if (days.length === 7) return 'Every day'
  const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  if (sorted.length > 1 && sorted.join(',') === '1,2,3,4,5') return 'Weekdays'
  return sorted.map((d) => WEEKDAY_LABELS[d]).join(', ')
}

export function isRoutineDone(r: RoutineData, day: Date): boolean {
  const t = dayStart(day).getTime()
  return r.dones.some((dn) => dayStart(new Date(dn.date)).getTime() === t)
}

/** Next occurrence strictly after `after` (returns null if none). */
export function nextOccurrence(rv: RoutineView, after: Date = new Date()): Date | null {
  const d = dayStart(after)
  // fast path: check next 400 days
  for (let i = 0; i <= 400; i++) {
    const cand = addDays(d, i)
    if (cand > rv.end) return null
    if (occursOn(rv, cand)) return cand
  }
  return null
}

export interface Occurrence {
  routine: RoutineData
  goalId: string
  date: Date
  done: boolean
  isToday: boolean
  isPast: boolean
  /** days elapsed since the scheduled day (0 = today, only set for past days) */
  daysAgo: number
  /**
   * Kindness system: a missed session older than GRACE_DAYS stops being
   * "work to do" and is quietly forgiven — it no longer shows as open,
   * doesn't count against adherence and never piles up into a backlog.
   */
  forgiven: boolean
  /** derived bucket: done | today | upcoming | open (within grace) | forgiven */
  state: 'done' | 'today' | 'upcoming' | 'open' | 'forgiven'
}

/**
 * Missed sessions are still "open" (softly, catchable) for this many days.
 * After that they're forgiven and disappear from the to-do surface.
 */
export const GRACE_DAYS = 3

/** All occurrences of a set of routines within [from, to] (inclusive), per day. */
export function occurrencesInRange(
  routines: RoutineData[],
  goalDeadline: string | null,
  from: Date,
  to: Date,
): Occurrence[] {
  const out: Occurrence[] = []
  const today = dayStart(new Date())
  for (const r of routines) {
    if (r.archived) continue
    const rv = routineView(r, goalDeadline)
    for (let d = dayStart(from); d <= dayStart(to); d = addDays(d, 1)) {
      if (occursOn(rv, d)) {
        const done = isRoutineDone(r, d)
        const isToday = sameDay(d, today)
        const isPast = d < today
        const daysAgo = isPast ? Math.round((today.getTime() - d.getTime()) / DAY_MS) : 0
        const forgiven = isPast && !done && daysAgo > GRACE_DAYS
        out.push({
          routine: r,
          goalId: r.goalId,
          date: new Date(d),
          done,
          isToday,
          isPast,
          daysAgo,
          forgiven,
          state: done ? 'done' : isToday ? 'today' : isPast ? (forgiven ? 'forgiven' : 'open') : 'upcoming',
        })
      }
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime())
}

export interface RoutineStats {
  /**
   * Kind adherence: done / scheduled over the trailing `weeks` weeks, where
   * forgiven misses (older than GRACE_DAYS) are excluded from the
   * denominator so old slip-ups never drag your score down forever.
   */
  adherencePct: number | null
  doneCount: number
  totalCount: number
  /** unforgiven past occurrences still open (the only "catch-up" there is) */
  openCount: number
  /** missed occurrences quietly forgiven within the window */
  forgivenCount: number
  /** consecutive completed occurrences ending at the most recent scheduled one */
  streak: number
  /** best consecutive run within the window (streaks break — best runs don't) */
  bestStreak: number
  /** next upcoming occurrence from today (or today if not yet done) */
  next: Date | null
}

export function routineStats(
  r: RoutineData,
  goalDeadline: string | null,
  weeks = 4,
  now: Date = new Date(),
): RoutineStats {
  const rv = routineView(r, goalDeadline)
  const today = dayStart(now)
  const from = addDays(startOfWeek(today), -(weeks - 1) * 7)

  // flexible routines: no fixed days — count sessions against the weekly quota
  if (r.cadence === 'flexible') {
    const n = r.timesPerWeek ?? 1
    let totalCount = 0
    for (let w = 0; w < weeks; w++) {
      const ws = addDays(from, w * 7)
      const we = addDays(ws, 6)
      if (rv.start <= we) totalCount += n // the routine was live that week
    }
    const doneCount = r.dones.filter((d) => {
      const dt = dayStart(new Date(d.date))
      return dt >= from && dt <= today
    }).length
    const flex = weekFlexProgress(r, startOfWeek(today))
    return {
      adherencePct: totalCount > 0 ? Math.min(100, Math.round((doneCount / totalCount) * 100)) : null,
      doneCount,
      totalCount,
      openCount: flex.left,
      forgivenCount: 0, // flexible sessions never become "missed days"
      streak: flex.done,
      bestStreak: flex.done,
      next: flex.left > 0 ? today : addDays(startOfWeek(today), 7),
    }
  }

  let doneCount = 0
  let totalCount = 0
  let openCount = 0
  let forgivenCount = 0
  for (let d = dayStart(from); d <= today; d = addDays(d, 1)) {
    if (d < rv.start) continue
    if (!occursOn(rv, d)) continue
    if (isRoutineDone(r, d)) {
      doneCount++
      totalCount++
    } else if (sameDay(d, today)) {
      // today is still in play — not counted as done or missed yet
      totalCount++
    } else {
      const daysAgo = Math.round((today.getTime() - d.getTime()) / DAY_MS)
      if (daysAgo > GRACE_DAYS) {
        forgivenCount++ // excluded from the denominator on purpose
      } else {
        totalCount++
        openCount++
      }
    }
  }

  // current streak: walk backwards over past scheduled days (today counts if done)
  let streak = 0
  for (let d = today; d >= addDays(today, -400); d = addDays(d, -1)) {
    if (d < rv.start) break
    if (!occursOn(rv, d)) continue
    if (isRoutineDone(r, d)) streak++
    else if (sameDay(d, today)) continue // today not done yet — still in play
    else break
  }

  // best streak within the window — celebrates the good run you had
  let bestStreak = 0
  let run = 0
  for (let d = dayStart(from); d <= today; d = addDays(d, 1)) {
    if (d < rv.start) continue
    if (!occursOn(rv, d)) continue
    if (isRoutineDone(r, d)) {
      run++
      bestStreak = Math.max(bestStreak, run)
    } else if (!sameDay(d, today)) {
      run = 0
    }
  }

  // next occurrence: today if today is scheduled & not done, else next future day
  let next: Date | null = null
  if (occursOn(rv, today) && !isRoutineDone(r, today)) {
    next = today
  } else {
    next = nextOccurrence(rv, addDays(today, 1))
  }

  return {
    adherencePct: totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : null,
    doneCount,
    totalCount,
    openCount,
    forgivenCount,
    streak,
    bestStreak: Math.max(bestStreak, streak),
    next,
  }
}

/** Relative label for a nearby date: Today / Tomorrow / weekday name / short date. */
export function relativeDayLabel(d: Date): string {
  const today = new Date()
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, addDays(today, 1))) return 'Tomorrow'
  if (sameDay(d, addDays(today, -1))) return 'Yesterday'
  const diffDays = Math.round((dayStart(d).getTime() - dayStart(today).getTime()) / DAY_MS)
  if (diffDays > 1 && diffDays <= 6) return WEEKDAY_LABELS[d.getDay()]
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
