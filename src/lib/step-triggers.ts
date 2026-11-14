import type { GoalData, GoalStepData, MetricOp, PersonalBestData, RoutineData, RoutineDoneData, StepTriggerType } from './types'
import { formatNumber } from './goal-math'
import { dayKeyOf } from './app-time'
import { parseDayKey } from './routine-math'

// ---------------------------------------------------------------------------
// Step automation — the shared vocabulary between the plan and the calendar.
//
// A step can complete itself instead of waiting for a manual tick:
//
//   trigger "routine" — after N check-offs of one routine (or, with no
//                       routine picked, any routine of the goal). Only
//                       check-offs made while the step was current count,
//                       so ticking never "catches up" a future step.
//   trigger "metric"   — when the rolling average of a personal-best metric
//                       crosses a threshold ("under" = avg must drop below
//                       it, e.g. inspection time < 15s; "over" = avg must
//                       rise above it, e.g. WPM > 60).
//   trigger "manual"   — the classic checklist tick (the default).
//
// This module is CLIENT-SAFE (pure functions over wire data) so routine rows
// can show "what this session is for" without touching the server. The
// evaluation engine that actually completes steps lives in step-engine.ts.
// ---------------------------------------------------------------------------

export interface StepTriggerInfo {
  kind: StepTriggerType
  /** routine trigger: the routine whose check-offs count (title; null = any) */
  routineTitle: string | null
  /** routine trigger: how many check-offs complete the step */
  count: number
  /** routine trigger: qualifying check-offs so far (only while current) */
  doneCount: number
  /** metric trigger: PB metric name */
  metricName: string | null
  /** metric trigger: rolling-average window (default 3) */
  window: number
  /** metric trigger: threshold direction */
  op: MetricOp | null
  /** metric trigger: the threshold value */
  value: number | null
  /** metric trigger: unit of the metric (for display) */
  unit: string | null
  /** metric trigger: current rolling average (null = not enough attempts yet) */
  avg: number | null
  /** metric trigger: attempts recorded so far */
  attempts: number
  /** the condition holds right now (step should be / have been completed) */
  satisfied: boolean
  /** the referenced metric (or linked routine) doesn't exist any more */
  missing: boolean
  /** one-line human description, e.g. "after 10 × Flying lesson" */
  label: string
  /** live progress line, e.g. "7/10" or "avg 18.4s → under 15s" (null: n/a) */
  status: string | null
}

/** The day a check-off happened on, as a comparable "YYYY-MM-DD" key. */
function doneDayKey(d: RoutineDoneData): string {
  return dayKeyOf(parseDayKey(d.date))
}

/** The day a step became current, as a comparable key (null = all history). */
function sinceDayKey(step: GoalStepData): string | null {
  if (!step.currentSince) return null
  return dayKeyOf(new Date(step.currentSince))
}

/** Check-offs that count toward completing `step` (its routine, or any
 *  routine of the goal when none is linked), made while it was current. */
function qualifyingDones(goal: GoalData, step: GoalStepData): RoutineDoneData[] {
  const since = sinceDayKey(step)
  const out: RoutineDoneData[] = []
  for (const r of goal.routines) {
    if (step.routineId && r.id !== step.routineId) continue
    for (const d of r.dones) {
      if (since && doneDayKey(d) < since) continue
      out.push(d)
    }
  }
  return out
}

function pbRecordsSorted(pb: PersonalBestData): { date: string; value: number }[] {
  return [...pb.records].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

/** Everything the UI needs to know about how one step completes. */
export function stepTriggerInfo(goal: GoalData, step: GoalStepData): StepTriggerInfo {
  const kind = step.trigger ?? 'manual'

  if (kind === 'routine') {
    const linked = step.routineId ? goal.routines.find((r) => r.id === step.routineId) ?? null : null
    const missing = !!step.routineId && !linked
    const count = Math.max(1, step.triggerCount ?? 1)
    const dones = qualifyingDones(goal, step)
    const doneCount = dones.length
    const satisfied = doneCount >= count
    return {
      kind,
      routineTitle: linked ? linked.title : null,
      count,
      doneCount,
      metricName: null,
      window: 3,
      op: null,
      value: null,
      unit: null,
      avg: null,
      attempts: 0,
      satisfied,
      missing,
      label: `after ${count} × ${linked ? linked.title : 'any session'}`,
      status: missing ? 'routine missing — tick manually' : `${Math.min(doneCount, count)}/${count}`,
    }
  }

  if (kind === 'metric') {
    const name = step.metricName ?? null
    const pb = name ? goal.pbs.find((p) => p.name === name) ?? null : null
    const window = Math.max(1, step.metricWindow ?? 3)
    const op = step.metricOp ?? 'under'
    const value = step.metricValue ?? null
    const unit = pb?.unit ?? null
    let avg: number | null = null
    let satisfied = false
    let attempts = 0
    if (pb) {
      const records = pbRecordsSorted(pb)
      attempts = records.length
      if (records.length >= window && value != null) {
        const last = records.slice(-window)
        avg = last.reduce((s, r) => s + r.value, 0) / window
        satisfied = op === 'under' ? avg < value : avg > value
      }
    }
    const missing = !pb
    const dir = op === 'under' ? 'drops below' : 'rises above'
    const u = unit ? ` ${unit}` : ''
    return {
      kind,
      routineTitle: null,
      count: 1,
      doneCount: 0,
      metricName: name,
      window,
      op,
      value,
      unit,
      avg,
      attempts,
      satisfied,
      missing,
      label: `when avg of last ${window} ${name ?? '—'}${u ? ` (${unit})` : ''} ${dir} ${value != null ? formatNumber(value) : '—'}${u}`,
      status: missing
        ? 'metric missing — tick manually'
        : avg != null && value != null
          ? `avg ${formatNumber(Math.round(avg * 10) / 10)}${u} → ${op === 'under' ? 'under' : 'over'} ${formatNumber(value)}${u}`
          : `needs ${window} attempts · ${attempts} so far`,
    }
  }

  return {
    kind: 'manual',
    routineTitle: null,
    count: 1,
    doneCount: 0,
    metricName: null,
    window: 3,
    op: null,
    value: null,
    unit: null,
    avg: null,
    attempts: 0,
    satisfied: false,
    missing: false,
    label: 'tick it off by hand',
    status: null,
  }
}

// ---------------------------------------------------------------------------
// What a routine occurrence is "for" right now
// ---------------------------------------------------------------------------

export interface RoutineStepContext {
  step: GoalStepData
  info: StepTriggerInfo
  /** 1-based position among the goal's steps ("Step 2 of 5") */
  index: number
  total: number
}

/**
 * The goal's current step, shown on a routine's occurrences — but only when
 * the routine actually advances it: a routine-trigger step linked to this
 * routine (or to any), or a metric-trigger step (which every session works
 * toward). Manual steps stay in the plan tab where ticking them means
 * something — a routine row must never imply its tick closes the step.
 */
export function currentStepForRoutine(goal: GoalData, routine: RoutineData): RoutineStepContext | null {
  const steps = [...goal.steps].sort((a, b) => a.order - b.order)
  const current = steps.find((s) => s.status !== 'done')
  if (!current) return null
  const kind = current.trigger ?? 'manual'
  if (kind === 'manual') return null
  if (kind === 'routine' && current.routineId && current.routineId !== routine.id) return null
  return {
    step: current,
    info: stepTriggerInfo(goal, current),
    index: steps.findIndex((s) => s.id === current.id) + 1,
    total: steps.length,
  }
}

/** Compact one-liner for routine rows: "Step 2/5 · Fly with instructor · 7/10". */
export function routineStepLine(ctx: RoutineStepContext): string {
  const title = ctx.step.title
  const status =
    ctx.info.kind === 'routine'
      ? ctx.info.status
      : ctx.info.kind === 'metric'
        ? ctx.info.status
        : null
  return `Step ${ctx.index}/${ctx.total} · ${title}${status ? ` · ${status}` : ''}`
}

// ---------------------------------------------------------------------------
// The explicit routine → step link (set from either editor)
// ---------------------------------------------------------------------------

export interface RoutineLinkedStepContext {
  step: GoalStepData
  /** 1-based position among the goal's steps */
  index: number
  total: number
}

/**
 * The step this routine is explicitly linked to (its routine trigger points
 * at this routine) and that isn't done yet — shown on routine rows so the
 * link is visible even before the step becomes current. `currentStepForRoutine`
 * covers the current step; this covers the "booked for later" case.
 */
export function linkedStepForRoutine(goal: GoalData, routine: RoutineData): RoutineLinkedStepContext | null {
  const steps = [...goal.steps].sort((a, b) => a.order - b.order)
  const linked = steps.find((s) => s.trigger === 'routine' && s.routineId === routine.id && s.status !== 'done')
  if (!linked) return null
  return {
    step: linked,
    index: steps.findIndex((s) => s.id === linked.id) + 1,
    total: steps.length,
  }
}

/** Compact one-liner for a not-yet-current link: "Step 3/5 · First solo". */
export function linkedStepLine(ctx: RoutineLinkedStepContext): string {
  return `Step ${ctx.index}/${ctx.total} · ${ctx.step.title}`
}
