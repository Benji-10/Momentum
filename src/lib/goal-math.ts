import type { GoalData, GoalStepData, TrackStatus } from './types'

export const DAY_MS = 86_400_000
export const WEEK_MS = 7 * DAY_MS

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

/** Amount logged during the week containing `ref`. */
export function amountInWeek(logs: GoalData['logs'], ref: Date, weekStartOffset = 0): number {
  const ws = new Date(startOfWeek(ref).getTime() + weekStartOffset * WEEK_MS)
  const we = new Date(ws.getTime() + WEEK_MS)
  return logs
    .filter((l) => {
      const t = new Date(l.date).getTime()
      return t >= ws.getTime() && t < we.getTime()
    })
    .reduce((s, l) => s + l.amount, 0)
}

export interface WeekBucket {
  weekStart: Date
  label: string
  amount: number
}

/** Weekly totals for the last `weeks` weeks (oldest first, current week last). */
export function weeklyHistory(logs: GoalData['logs'], weeks = 8, ref = new Date()): WeekBucket[] {
  const out: WeekBucket[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(startOfWeek(ref).getTime() - i * WEEK_MS)
    const we = new Date(ws.getTime() + WEEK_MS)
    const amount = logs
      .filter((l) => {
        const t = new Date(l.date).getTime()
        return t >= ws.getTime() && t < we.getTime()
      })
      .reduce((s, l) => s + l.amount, 0)
    out.push({
      weekStart: ws,
      label: `${ws.getDate()}/${ws.getMonth() + 1}`,
      amount: Math.round(amount * 100) / 100,
    })
  }
  return out
}

export interface GoalStats {
  /** Sum of all logged amounts. */
  currentValue: number
  /** quantitative: target value. plan: null */
  targetValue: number | null
  /** 0..100 — quantitative: value/target, plan: done steps/total steps */
  progressPct: number
  hasDeadline: boolean
  daysLeft: number | null
  weeksLeft: number | null
  /** Value you should have reached by now to be perfectly on pace. */
  idealValueNow: number | null
  /** Flat weekly pace needed from start to finish (target / total weeks). */
  idealWeeklyPace: number | null
  /** Catch-up pace: (target - current) / weeks remaining. */
  requiredPerWeek: number | null
  requiredPerDay: number | null
  /** Your actual average weekly pace over the trailing 4 weeks. */
  actualPacePerWeek: number
  /** When you'll finish if you keep the current pace. */
  projectedFinishDate: Date | null
  status: TrackStatus
  thisWeekLogged: number
  /** What still needs to be logged this week (>= 0). */
  thisWeekRemaining: number | null
  /** Per-day amount needed for the rest of this week. */
  perDayForWeek: number | null
  stepsTotal: number
  stepsDone: number
  stepsInProgress: number
  nextStep: GoalStepData | null
  /** Steps per week needed to finish the plan by the deadline. */
  requiredStepsPerWeek: number | null
  /** Consecutive weeks (up to now) that met the weekly requirement. */
  streakWeeks: number
  lastActivityDate: Date | null
  logsCount: number
}

export function computeGoalStats(goal: GoalData, now = new Date()): GoalStats {
  const logs = [...goal.logs].sort((a, b) => +new Date(a.date) - +new Date(b.date))
  const currentValue = Math.round(logs.reduce((s, l) => s + l.amount, 0) * 100) / 100
  const created = new Date(goal.createdAt)
  const deadline = goal.deadline ? new Date(goal.deadline) : null
  const hasDeadline = !!deadline
  const daysLeft = deadline ? Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS)) : null
  const weeksLeft = deadline ? Math.max(0, (deadline.getTime() - now.getTime()) / WEEK_MS) : null
  const thisWeekLogged = Math.round(amountInWeek(goal.logs, now) * 100) / 100

  const steps = [...goal.steps].sort((a, b) => a.order - b.order)
  const stepsTotal = steps.length
  const stepsDone = steps.filter((s) => s.status === 'done').length
  const stepsInProgress = steps.filter((s) => s.status === 'in_progress').length
  const nextStep =
    steps.find((s) => s.status === 'in_progress') ?? steps.find((s) => s.status !== 'done') ?? null

  // ---- pace numbers (quantitative) ----
  const target = goal.type === 'quantitative' ? goal.targetValue ?? null : null
  const totalWeeks =
    deadline && deadline.getTime() > created.getTime()
      ? (deadline.getTime() - created.getTime()) / WEEK_MS
      : null
  const weeksElapsed = totalWeeks
    ? Math.min(totalWeeks, Math.max(0, (now.getTime() - created.getTime()) / WEEK_MS))
    : null

  const idealValueNow =
    target != null && totalWeeks != null && weeksElapsed != null
      ? Math.round(target * (weeksElapsed / totalWeeks) * 100) / 100
      : null
  const idealWeeklyPace = target != null && totalWeeks ? Math.round((target / totalWeeks) * 100) / 100 : null
  const remainingValue = target != null ? Math.max(0, target - currentValue) : null
  const requiredPerWeek =
    remainingValue != null && remainingValue > 0 && weeksLeft != null && weeksLeft > 0
      ? Math.ceil((remainingValue / weeksLeft) * 100) / 100
      : remainingValue === 0
        ? 0
        : null
  const requiredPerDay =
    requiredPerWeek != null && requiredPerWeek > 0 ? Math.ceil((requiredPerWeek / 7) * 100) / 100 : null

  // Actual pace: trailing 4 calendar weeks (current + 3 previous), divided by
  // the number of those weeks that have actually elapsed since the goal began.
  const paceWindowStart = startOfWeek(now).getTime() - 3 * WEEK_MS
  const activeSince = Math.max(created.getTime(), paceWindowStart)
  const paceWeeks = Math.max(1, (now.getTime() - activeSince) / WEEK_MS)
  const paceAmount = logs
    .filter((l) => new Date(l.date).getTime() >= paceWindowStart)
    .reduce((s, l) => s + l.amount, 0)
  const actualPacePerWeek = Math.round((paceAmount / paceWeeks) * 100) / 100

  const projectedFinishDate =
    target != null && remainingValue != null && remainingValue > 0 && actualPacePerWeek > 0
      ? new Date(now.getTime() + (remainingValue / actualPacePerWeek) * WEEK_MS)
      : null

  // ---- weekly requirement (for streaks & "this week" focus) ----
  const weeklyRequirement: number | null =
    goal.type === 'quantitative'
      ? hasDeadline && deadline! > now
        ? (idealWeeklyPace ?? goal.weeklyTarget ?? null)
        : goal.weeklyTarget ?? null
      : goal.weeklyTarget ?? null

  // ---- status ----
  let status: TrackStatus
  if (goal.type === 'quantitative' && target != null) {
    if (currentValue >= target) status = 'completed'
    else if (deadline && deadline.getTime() < now.getTime()) status = 'ended'
    else if (idealValueNow == null) status = 'on_track'
    else if (idealValueNow <= 0.01) status = logs.length ? 'on_track' : 'not_started'
    else if (currentValue >= idealValueNow * 1.05) status = 'ahead'
    else if (currentValue >= idealValueNow * 0.9) status = 'on_track'
    else status = 'behind'
  } else {
    // plan goal
    if (stepsTotal > 0 && stepsDone === stepsTotal) status = 'completed'
    else if (deadline && deadline.getTime() < now.getTime()) status = 'ended'
    else if (stepsTotal === 0 && logs.length === 0) status = 'not_started'
    else {
      // pace of finishing steps vs elapsed time
      const expectedNow =
        totalWeeks != null && weeksElapsed != null
          ? stepsTotal * (weeksElapsed / totalWeeks)
          : null
      if (expectedNow == null) status = 'on_track'
      else if (stepsDone >= expectedNow * 1.05) status = 'ahead'
      // allow half a step of slack (also right after creation, when expectedNow ≈ 0)
      else if (stepsDone >= Math.min(expectedNow * 0.9, expectedNow - 0.5)) status = 'on_track'
      else status = 'behind'
    }
  }

  // ---- streak ----
  let streakWeeks = 0
  for (let i = 0; i < 52; i++) {
    const amount = amountInWeek(goal.logs, now, -i)
    const met = weeklyRequirement != null ? amount >= weeklyRequirement * 0.99 : amount > 0
    if (met) streakWeeks++
    else if (i === 0) continue // current week still in progress — don't break the streak
    else break
  }

  const daysLeftInWeek = Math.max(1, Math.ceil((endOfWeek(now).getTime() - now.getTime()) / DAY_MS))
  const thisWeekRemaining =
    weeklyRequirement != null
      ? Math.max(0, Math.round((weeklyRequirement - thisWeekLogged) * 100) / 100)
      : null
  const perDayForWeek =
    thisWeekRemaining != null && thisWeekRemaining > 0
      ? Math.ceil((thisWeekRemaining / daysLeftInWeek) * 100) / 100
      : null

  const requiredStepsPerWeek =
    goal.type === 'plan' && weeksLeft != null && weeksLeft > 0
      ? Math.ceil((stepsTotal - stepsDone) / weeksLeft)
      : null

  const lastActivityDate = logs.length
    ? new Date(logs[logs.length - 1].date)
    : steps.some((s) => s.completedAt)
      ? new Date(
          steps
            .filter((s) => s.completedAt)
            .map((s) => new Date(s.completedAt!).getTime())
            .sort((a, b) => b - a)[0],
        )
      : null

  const progressPct =
    goal.type === 'quantitative'
      ? target
        ? Math.min(100, (currentValue / target) * 100)
        : 0
      : stepsTotal
        ? (stepsDone / stepsTotal) * 100
        : 0

  return {
    currentValue,
    targetValue: target,
    progressPct: Math.round(progressPct * 10) / 10,
    hasDeadline,
    daysLeft,
    weeksLeft,
    idealValueNow,
    idealWeeklyPace,
    requiredPerWeek,
    requiredPerDay,
    actualPacePerWeek,
    projectedFinishDate,
    status,
    thisWeekLogged,
    thisWeekRemaining,
    perDayForWeek,
    stepsTotal,
    stepsDone,
    stepsInProgress,
    nextStep,
    requiredStepsPerWeek,
    streakWeeks,
    lastActivityDate,
    logsCount: logs.length,
  }
}

export interface CumulativePoint {
  date: number // timestamp
  actual: number | null
  ideal: number | null
}

/**
 * Daily cumulative series (actual vs ideal) for a quantitative goal,
 * from goal creation to deadline, capped to <= 160 points.
 */
export function cumulativeSeries(goal: GoalData, now = new Date()): CumulativePoint[] {
  if (goal.type !== 'quantitative' || goal.targetValue == null) return []
  const start = new Date(goal.createdAt)
  const end = goal.deadline ? new Date(goal.deadline) : null
  const target = goal.targetValue
  const spanEnd = end ? Math.min(end.getTime(), now.getTime() + 90 * DAY_MS) : now.getTime() + 60 * DAY_MS
  const span = spanEnd - start.getTime()
  if (span <= 0) return []
  const stepDays = Math.max(1, Math.ceil(span / DAY_MS / 160))

  const logs = [...goal.logs].sort((a, b) => +new Date(a.date) - +new Date(b.date))
  const points: CumulativePoint[] = []
  let cum = 0
  let li = 0
  for (let t = start.getTime(); t <= spanEnd; t += stepDays * DAY_MS) {
    while (li < logs.length && new Date(logs[li].date).getTime() <= t) {
      cum += logs[li].amount
      li++
    }
    const fraction = end ? Math.min(1, Math.max(0, (t - start.getTime()) / (end.getTime() - start.getTime()))) : null
    points.push({
      date: t,
      actual: Math.round(cum * 100) / 100,
      ideal: fraction != null ? Math.round(target * fraction * 100) / 100 : null,
    })
  }
  return points
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString()
}

export function formatDateShort(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function formatDateLong(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
