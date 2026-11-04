import { z } from 'zod'
import type { RoutineCadence } from './types'

// ---------------------------------------------------------------------------
// Import / export JSON format ("roadmap files")
//
// Hand-authored or generated anywhere: paste/upload the JSON and every goal,
// step, skill path and weekly routine is created. Export produces the same
// shape (plus your progress and history).
//
// The parser is deliberately forgiving:
//   • null is accepted anywhere the field may be absent
//   • common aliases are understood (checkpoints→nodes, subCheckpoints→
//     milestones, everyNDays→everyDays, name→title, …)
//   • numbers may be sent as strings ("150")
//   • steps may carry done:true, routines may carry dones:["2026-01-05",…]
//     so an export round-trips losslessly
//
// Scheduling & progression (v1):
//   • nodes may carry requires:["HSK3"] or ["Vocabulary › HSK3"] — the
//     checkpoint stays locked until those are cleared (default: the
//     previous node in the same path, i.e. HSK2 → HSK3)
//   • routines may carry weekdays:["Mon","Tue"] for fixed days,
//     everyDays:2 for intervals, or timesPerWeek:3 for "any 3 days a week"
//   • routines may carry node:"Grammar › HSK3" + credit:10 — each check-off
//     advances that checkpoint in the skill tree automatically
//   • goals may carry pbs:[{ name:"WPM", unit:"wpm", direction:"up",
//     records:[{ date:"2026-01-05", value:128 }] }] — personal-best metrics
//     with their full attempt history ("down" = lower is better, e.g. a
//     BLD solve time in seconds)
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
}

export function weekdayToNumber(w: unknown): number | null {
  if (typeof w === 'number' && Number.isInteger(w) && w >= 0 && w <= 6) return w
  if (typeof w === 'string') {
    const n = WEEKDAY_NAMES[w.trim().toLowerCase()]
    if (n !== undefined) return n
  }
  return null
}

// ---------------------------------------------------------------------------
// Lenient pre-processing (plain JS, before zod): rename aliases, coerce
// numeric strings, drop null array entries, normalise shapes.
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toNum(v: unknown): unknown {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v)
  return v
}

function pick(src: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (src[k] !== undefined) return src[k]
  }
  return undefined
}

/** "150" | 150 | {value: 150} → number | null */
function milestoneValue(m: unknown): number | null {
  if (typeof m === 'number') return m
  if (isPlainObject(m)) {
    const v = toNum(pick(m, ['value', 'at', 'target']))
    if (typeof v === 'number') return v
  }
  if (typeof m === 'string') {
    const v = toNum(m)
    if (typeof v === 'number') return v
  }
  return null
}

function canonMilestone(m: unknown): unknown {
  const value = milestoneValue(m)
  if (value == null) return m // let zod produce the error
  if (isPlainObject(m)) {
    const label = pick(m, ['label', 'title', 'name'])
    return typeof label === 'string' && label.trim() ? { value, label: label.trim() } : { value }
  }
  return value
}

function canonStep(s: unknown): unknown {
  if (typeof s === 'string') return s
  if (!isPlainObject(s)) return s
  const out: Record<string, unknown> = {}
  const title = pick(s, ['title', 'name', 'text'])
  if (title != null) out.title = title
  const notes = pick(s, ['notes', 'note', 'description'])
  if (notes != null) out.notes = notes
  const done = s.done ?? s.completed ?? (s.status === 'done' || s.status === 'complete' ? true : undefined)
  if (done === true || done === 'true' || done === 1) out.done = true
  return out
}

function canonNode(n: unknown): unknown {
  if (!isPlainObject(n)) return n
  const out: Record<string, unknown> = { ...n }
  const title = pick(n, ['title', 'name', 'label'])
  if (title != null) out.title = title
  const desc = pick(n, ['description', 'notes', 'note'])
  if (desc != null) out.description = desc
  const icon = pick(n, ['icon', 'emoji'])
  if (icon != null) out.icon = icon
  const current = toNum(pick(n, ['current', 'currentValue', 'progress', 'done']))
  if (current != null) out.current = current
  const target = toNum(pick(n, ['target', 'targetValue', 'goal', 'total']))
  if (target != null) out.target = target
  const xp = toNum(pick(n, ['xp', 'xpValue', 'points']))
  if (xp != null) out.xp = xp
  // dependencies: titles (or "Path › Node" / "Path/Node") of checkpoints
  // that must be cleared first — e.g. HSK4 requires HSK3. A string is one
  // ref; an array is several.
  const requires = pick(n, ['requires', 'requiresNode', 'dependsOn', 'after', 'unlockAfter', 'needs'])
  if (requires != null) {
    const list = Array.isArray(requires) ? requires : [requires]
    out.requires = list
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .map((x) => x.trim())
  }
  const milestones = pick(n, ['milestones', 'subCheckpoints', 'subcheckpoints', 'sub_checkpoints', 'sub-checkpoints', 'stars', 'checkpoints'])
  if (Array.isArray(milestones)) out.milestones = milestones.filter((m) => m != null).map(canonMilestone)
  else if (milestones != null) out.milestones = [canonMilestone(milestones)]
  else delete out.milestones
  if (out.mastered === 'true' || out.mastered === 1) out.mastered = true
  return out
}

function canonPath(p: unknown): unknown {
  if (!isPlainObject(p)) return p
  const out: Record<string, unknown> = { ...p }
  const title = pick(p, ['title', 'name', 'label'])
  if (title != null) out.title = title
  const icon = pick(p, ['icon', 'emoji'])
  if (icon != null) out.icon = icon
  const nodes = pick(p, ['nodes', 'checkpoints', 'levels', 'tiers'])
  if (Array.isArray(nodes)) out.nodes = nodes.filter((n) => n != null).map(canonNode)
  else if (nodes != null) out.nodes = [canonNode(nodes)]
  else delete out.nodes
  return out
}

function canonRoutine(r: unknown): unknown {
  if (!isPlainObject(r)) return r
  const out: Record<string, unknown> = { ...r }
  const title = pick(r, ['title', 'name', 'label'])
  if (title != null) out.title = title
  const notes = pick(r, ['notes', 'note', 'description'])
  if (notes != null) out.notes = notes
  const everyDays = toNum(pick(r, ['everyDays', 'everyNDays', 'every_days', 'intervalDays']))
  if (everyDays != null) out.everyDays = everyDays
  const timesPerWeek = toNum(pick(r, ['timesPerWeek', 'perWeek', 'timesAWeek', 'xPerWeek', 'sessionsPerWeek']))
  if (timesPerWeek != null) out.timesPerWeek = timesPerWeek
  const weekdays = pick(r, ['weekdays', 'days', 'on'])
  if (Array.isArray(weekdays)) out.weekdays = weekdays.filter((w) => w != null && w !== '')
  const durationMin = toNum(pick(r, ['durationMin', 'duration', 'durationMinutes', 'minutes']))
  if (durationMin != null) out.durationMin = durationMin
  // what this session advances in the skill tree: "Vocabulary › HSK3"
  const node = pick(r, ['node', 'targetNode', 'nodeTitle', 'advances', 'focus', 'skill'])
  if (typeof node === 'string' && node.trim()) out.node = node.trim()
  else if (isPlainObject(node)) {
    const nt = pick(node, ['title', 'name', 'node'])
    const pt = pick(node, ['path', 'branch'])
    if (typeof nt === 'string') out.node = typeof pt === 'string' && pt.trim() ? `${pt.trim()} › ${nt.trim()}` : nt.trim()
  }
  const credit = toNum(pick(r, ['credit', 'adds', 'nodeCredit', 'progressPerSession', 'perSession']))
  if (credit != null) out.credit = credit
  const dones = pick(r, ['dones', 'completedDates', 'history', 'completions'])
  if (Array.isArray(dones)) {
    out.dones = dones
      .map((d) => (typeof d === 'string' ? d : isPlainObject(d) ? pick(d, ['date', 'day']) : null))
      .filter((d): d is string => typeof d === 'string' && d.trim() !== '')
  }
  return out
}

function canonLog(l: unknown): unknown {
  if (!isPlainObject(l)) return l
  const out: Record<string, unknown> = { ...l }
  const amount = toNum(pick(l, ['amount', 'value', 'count']))
  if (amount != null) out.amount = amount
  const daysAgo = toNum(l.daysAgo)
  if (daysAgo != null) out.daysAgo = daysAgo
  return out
}

const DIRECTION_ALIASES: Record<string, 'up' | 'down'> = {
  up: 'up', higher: 'up', high: 'up', max: 'up', greater: 'up', more: 'up',
  down: 'down', lower: 'down', low: 'down', min: 'down', less: 'down',
}

function canonPbRecord(r: unknown): unknown {
  if (typeof r === 'number') return { value: r }
  if (!isPlainObject(r)) return r
  const out: Record<string, unknown> = {}
  const value = toNum(pick(r, ['value', 'score', 'result', 'amount', 'val']))
  if (value != null) out.value = value
  const date = pick(r, ['date', 'day', 'when'])
  if (typeof date === 'string') out.date = date
  const daysAgo = toNum(r.daysAgo)
  if (daysAgo != null) out.daysAgo = daysAgo
  const note = pick(r, ['note', 'notes', 'comment'])
  if (typeof note === 'string') out.note = note
  return out
}

function canonPb(pb: unknown): unknown {
  if (typeof pb === 'string') return { name: pb }
  if (!isPlainObject(pb)) return pb
  const out: Record<string, unknown> = {}
  const name = pick(pb, ['name', 'metric', 'title', 'label'])
  if (name != null) out.name = name
  const unit = pick(pb, ['unit', 'units'])
  if (unit != null) out.unit = unit
  const directionRaw = pick(pb, ['direction', 'dir', 'better'])
  if (typeof directionRaw === 'string') {
    const dir = DIRECTION_ALIASES[directionRaw.trim().toLowerCase()]
    if (dir) out.direction = dir
  }
  const records = pick(pb, ['records', 'entries', 'history', 'values', 'attempts', 'dones'])
  if (Array.isArray(records)) out.records = records.filter((r) => r != null).map(canonPbRecord)
  else if (records != null) out.records = [canonPbRecord(records)]
  else delete out.records
  return out
}

function canonGoal(g: unknown): unknown {
  if (!isPlainObject(g)) return g
  const out: Record<string, unknown> = { ...g }
  const title = pick(g, ['title', 'name'])
  if (title != null) out.title = title
  const targetValue = toNum(pick(g, ['targetValue', 'target']))
  if (targetValue != null) out.targetValue = targetValue
  const weeklyTarget = toNum(pick(g, ['weeklyTarget', 'perWeek']))
  if (weeklyTarget != null) out.weeklyTarget = weeklyTarget
  if (Array.isArray(g.steps)) out.steps = g.steps.filter((s) => s != null).map(canonStep)
  const paths = pick(g, ['paths', 'skillPaths', 'skill_paths', 'maps'])
  if (Array.isArray(paths)) {
    out.paths = paths.filter((p) => p != null).map(canonPath)
  } else {
    // a bare goal with checkpoints/nodes directly on it → one default path
    const bare = pick(g, ['checkpoints', 'nodes'])
    if (Array.isArray(bare) && bare.length) {
      out.paths = [{ title: 'Progress', icon: '🌿', nodes: bare.filter((n) => n != null).map(canonNode) }]
    }
  }
  if (Array.isArray(g.routines)) out.routines = g.routines.filter((r) => r != null).map(canonRoutine)
  if (Array.isArray(g.logs)) out.logs = g.logs.filter((l) => l != null).map(canonLog)
  if (Array.isArray(g.notes)) out.notes = g.notes.filter((n) => typeof n === 'string')
  const pbs = pick(g, ['pbs', 'personalBests', 'bests'])
  if (Array.isArray(pbs)) out.pbs = pbs.filter((p) => p != null).map(canonPb)
  return out
}

/** Accepts: { goals: [...] } | [goal, …] | a single goal object. */
function canonicalizeImport(raw: unknown): unknown {
  if (Array.isArray(raw)) return { goals: raw.map(canonGoal) }
  if (isPlainObject(raw)) {
    if (Array.isArray(raw.goals)) return { ...raw, goals: raw.goals.map(canonGoal) }
    if (raw.title != null || raw.name != null) return { goals: [canonGoal(raw)] }
  }
  return raw
}

// ---------------------------------------------------------------------------
// Validation schemas (canonical shape — everything nullable is nullish)
// ---------------------------------------------------------------------------

const stepSchema = z.union([
  z.string().min(1).max(200),
  z.object({
    title: z.string().min(1).max(200),
    notes: z.string().max(2000).nullish(),
    done: z.boolean().optional(),
  }),
])

const milestoneSchema = z.union([
  z.number().positive().max(1_000_000),
  z.object({
    value: z.number().positive().max(1_000_000),
    label: z.string().max(60).nullish(),
  }),
])

const skillNodeSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1000).nullish(),
  icon: z.string().max(8).nullish(),
  current: z.number().min(0).max(1_000_000).nullish(), // starting progress
  target: z.number().positive().max(1_000_000),
  unit: z.string().max(30).nullish(), // overrides the path unit
  xp: z.number().int().min(1).max(500).nullish(),
  mastered: z.boolean().optional(), // shortcut: sets current = target
  /** sub-checkpoints on the way to the target, e.g. [50, 100] for a 150-word checkpoint */
  milestones: z.array(milestoneSchema).max(30).nullish(),
  /** checkpoint titles (or "Path › Node") that must be mastered first */
  requires: z.array(z.string().min(1).max(160)).max(8).nullish(),
})

const skillPathSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().max(1000).nullish(),
  icon: z.string().max(8).nullish(),
  unit: z.string().max(30).nullish(), // default unit for all nodes
  nodes: z.array(skillNodeSchema).min(1).max(40),
})

const routineSchema = z.object({
  title: z.string().min(1).max(120),
  notes: z.string().max(500).nullish(),
  /** interval cadence: repeat every N days from the start date */
  everyDays: z.number().int().min(1).max(365).nullish(),
  /** weekly cadence: repeat on these weekdays (numbers or names) */
  weekdays: z.array(z.union([z.number(), z.string()])).nullish(),
  /** flexible cadence: N sessions per week, on any day you like */
  timesPerWeek: z.number().int().min(1).max(14).nullish(),
  cadence: z.enum(['interval', 'weekly', 'flexible']).nullish(),
  durationMin: z.number().int().min(1).max(24 * 60).nullish(),
  /** which skill-tree checkpoint this session advances, e.g. "Grammar › HSK3" */
  node: z.string().min(1).max(160).nullish(),
  /** progress auto-added to that checkpoint per completed session */
  credit: z.number().positive().max(100_000).nullish(),
  startDate: z.string().nullish(), // YYYY-MM-DD
  endDate: z.string().nullish(), // YYYY-MM-DD
  /** completion history: ["2026-01-05", …] — restored on import */
  dones: z.array(z.string()).nullish(),
})

const logSchema = z.object({
  daysAgo: z.number().min(0).max(3650).nullish(),
  date: z.string().nullish(), // YYYY-MM-DD
  amount: z.number().positive().max(1_000_000),
  note: z.string().max(500).nullish(),
})

const pbRecordSchema = z.object({
  daysAgo: z.number().min(0).max(3650).nullish(),
  date: z.string().nullish(), // YYYY-MM-DD or ISO
  value: z.number().positive().max(1_000_000),
  note: z.string().max(200).nullish(),
})

const pbSchema = z.object({
  name: z.string().min(1).max(60),
  unit: z.string().max(30).nullish(),
  /** "up" = higher is better (WPM) · "down" = lower is better (solve time) */
  direction: z.enum(['up', 'down']).nullish(),
  records: z.array(pbRecordSchema).max(500).nullish(),
})

const goalSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(2000).nullish(),
  emoji: z.string().max(8).nullish(),
  color: z.string().max(20).nullish(),
  category: z.string().max(40).nullish(),
  type: z.enum(['quantitative', 'plan']).nullish(), // default: plan if paths/steps, else quantitative if targetValue
  targetValue: z.number().positive().nullish(),
  unit: z.string().max(30).nullish(),
  weeklyTarget: z.number().positive().nullish(),
  deadline: z.string().nullish(), // YYYY-MM-DD or ISO
  steps: z.array(stepSchema).max(100).nullish(),
  paths: z.array(skillPathSchema).max(12).nullish(), // the skill map
  routines: z.array(routineSchema).max(30).nullish(),
  pbs: z.array(pbSchema).max(20).nullish(),
  notes: z.array(z.string().min(1).max(2000)).max(50).nullish(),
  logs: z.array(logSchema).max(1000).nullish(),
})

export const importFileSchema = z.object({
  version: z.number().nullish(),
  goals: z.array(goalSchema).min(1).max(50),
})

export type ImportGoalRaw = z.infer<typeof goalSchema>

/** Normalized shape handed to the API. */
export interface NormalizedStep {
  title: string
  notes: string | null
  done: boolean
}
export interface NormalizedMilestone {
  value: number
  label: string | null
}
export interface NormalizedSkillNode {
  title: string
  description: string | null
  icon: string
  currentValue: number
  targetValue: number
  unit: string | null
  xpValue: number
  /** raw dependency refs (node titles or "Path › Node"), resolved on create */
  requires: string[]
  milestones: NormalizedMilestone[]
}
export interface NormalizedSkillPath {
  title: string
  description: string | null
  icon: string
  unit: string | null
  nodes: NormalizedSkillNode[]
}
export interface NormalizedRoutine {
  title: string
  notes: string | null
  cadence: RoutineCadence
  everyNDays: number | null
  weekdays: number[] | null
  timesPerWeek: number | null
  /** raw skill-node ref ("Grammar › HSK3"), resolved on create */
  nodeRef: string | null
  credit: number | null
  durationMin: number | null
  startDate: string | null // ISO
  endDate: string | null
  /** completion history (ISO dates) */
  doneDates: string[]
}
export interface NormalizedLog {
  amount: number
  note: string | null
  date: string // ISO
}
export interface NormalizedPbRecord {
  value: number
  note: string | null
  date: string // ISO
}
export interface NormalizedPb {
  name: string
  unit: string | null
  direction: 'up' | 'down'
  records: NormalizedPbRecord[]
}
export interface NormalizedGoal {
  title: string
  description: string | null
  emoji: string
  color: string
  category: string | null
  type: 'quantitative' | 'plan'
  targetValue: number | null
  unit: string | null
  weeklyTarget: number | null
  deadline: string | null // ISO
  steps: NormalizedStep[]
  paths: NormalizedSkillPath[]
  routines: NormalizedRoutine[]
  pbs: NormalizedPb[]
  notes: string[]
  logs: NormalizedLog[]
}
export interface NormalizedImport {
  goals: NormalizedGoal[]
}

function isoFromFlexibleDate(s: string | null | undefined): string | null {
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00`)
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function isoFromDaysAgoOrDate(daysAgo?: number | null, date?: string | null): string {
  if (date) {
    const iso = isoFromFlexibleDate(date)
    if (iso) return iso
  }
  return new Date(Date.now() - (daysAgo ?? 0) * 86_400_000).toISOString()
}

export function normalizeGoal(g: ImportGoalRaw): NormalizedGoal {
  const hasPaths = (g.paths?.length ?? 0) > 0
  const hasSteps = (g.steps?.length ?? 0) > 0
  const hasTarget = g.targetValue != null && g.targetValue > 0
  const type: 'quantitative' | 'plan' = g.type ?? (hasTarget && !hasPaths ? 'quantitative' : 'plan')

  const steps: NormalizedStep[] = (g.steps ?? []).map((s) =>
    typeof s === 'string'
      ? { title: s.trim(), notes: null, done: false }
      : { title: s.title.trim(), notes: s.notes ?? null, done: s.done === true },
  )

  const paths: NormalizedSkillPath[] = (g.paths ?? []).map((p) => ({
    title: p.title.trim(),
    description: p.description ?? null,
    icon: p.icon ?? '🌿',
    unit: p.unit?.trim() || null,
    nodes: p.nodes.map((n) => {
      const currentValue = n.mastered ? n.target : Math.max(0, n.current ?? 0)
      // normalize milestones: numbers or {value,label} → sorted, deduped, below target
      const rawMilestones = (n.milestones ?? []).map((m) =>
        typeof m === 'number' ? { value: m, label: null } : { value: m.value, label: m.label?.trim() || null },
      )
      const byValue = new Map<number, string | null>()
      for (const m of rawMilestones) {
        if (m.value > 0 && m.value < n.target && !byValue.has(m.value)) byValue.set(m.value, m.label)
      }
      return {
        title: n.title.trim(),
        description: n.description ?? null,
        icon: n.icon ?? '✨',
        currentValue,
        targetValue: n.target,
        unit: n.unit?.trim() || null,
        xpValue: n.xp ?? 20,
        requires: [...new Set(n.requires ?? [])].slice(0, 8),
        milestones: [...byValue.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([value, label]) => ({ value, label })),
      }
    }),
  }))

  const routines: NormalizedRoutine[] = (g.routines ?? []).map((r) => {
    let cadence: RoutineCadence =
      r.cadence ?? (r.timesPerWeek != null ? 'flexible' : r.everyDays != null ? 'interval' : 'weekly')
    if (r.timesPerWeek != null && (r.cadence == null || r.cadence === 'flexible')) cadence = 'flexible'
    if (cadence === 'flexible' && r.timesPerWeek == null) cadence = r.everyDays != null ? 'interval' : 'weekly'
    if (r.everyDays == null && !r.weekdays?.length && cadence !== 'flexible') cadence = 'weekly'
    const weekdays =
      cadence === 'weekly'
        ? [...new Set((r.weekdays ?? [1]).map(weekdayToNumber).filter((n): n is number => n !== null))].sort()
        : null
    return {
      title: r.title.trim(),
      notes: r.notes ?? null,
      cadence,
      everyNDays: cadence === 'interval' ? (r.everyDays ?? 2) : null,
      weekdays: cadence === 'weekly' ? weekdays : null,
      timesPerWeek: cadence === 'flexible' ? (r.timesPerWeek ?? 2) : null,
      nodeRef: r.node?.trim() || null,
      credit: r.credit ?? null,
      durationMin: r.durationMin ?? null,
      startDate: isoFromFlexibleDate(r.startDate) ?? new Date().toISOString(),
      endDate: isoFromFlexibleDate(r.endDate ?? null),
      doneDates: (r.dones ?? [])
        .map((d) => isoFromFlexibleDate(d))
        .filter((d): d is string => d !== null),
    }
  })

  return {
    title: g.title.trim(),
    description: g.description ?? null,
    emoji: g.emoji ?? '🎯',
    color: g.color ?? 'emerald',
    category: g.category?.trim() || null,
    type,
    targetValue: type === 'quantitative' ? (g.targetValue ?? null) : null,
    unit: g.unit?.trim() || null,
    weeklyTarget: g.weeklyTarget ?? null,
    deadline: isoFromFlexibleDate(g.deadline ?? null),
    steps,
    paths,
    routines,
    pbs: (g.pbs ?? []).map((pb) => ({
      name: pb.name.trim(),
      unit: pb.unit?.trim() || null,
      direction: pb.direction ?? 'up',
      records: (pb.records ?? []).map((r) => ({
        value: r.value,
        note: r.note ?? null,
        date: isoFromDaysAgoOrDate(r.daysAgo, r.date),
      })),
    })),
    notes: (g.notes ?? []).map((n) => n.trim()).filter(Boolean),
    logs: (g.logs ?? []).map((l) => ({
      amount: l.amount,
      note: l.note ?? null,
      date: isoFromDaysAgoOrDate(l.daysAgo, l.date),
    })),
  }
}

// ---------------------------------------------------------------------------
// Friendly validation errors
// ---------------------------------------------------------------------------

function humanizePath(path: PropertyKey[]): string {
  if (path.length === 0) return ''
  return path
    .map((p) => (typeof p === 'number' ? `#${p + 1}` : String(p)))
    .join(' › ')
}

function describeIssue(issue: z.ZodIssue): string {
  // unions swallow their children — dig out the most specific message
  const anyIssue = issue as unknown as {
    expected?: string
    received?: string
    errors?: unknown[][]
  }
  if (issue.code === 'invalid_union' && Array.isArray(anyIssue.errors)) {
    const nested = anyIssue.errors.flat().find((e) => e && typeof e === 'object') as z.ZodIssue | undefined
    if (nested) {
      const nestedWhere = humanizePath(nested.path.slice(issue.path.length))
      const nestedWhat = describeIssue(nested)
      return nestedWhere ? `${nestedWhat} (at ${nestedWhere})` : nestedWhat
    }
  }
  if (issue.code === 'invalid_type' && anyIssue.expected) {
    const received = anyIssue.received && anyIssue.received !== 'unknown' ? `, found ${anyIssue.received}` : ''
    return `expected ${anyIssue.expected}${received}`
  }
  if (issue.code === 'invalid_type') {
    return 'wrong type'
  }
  return issue.message
}

/** Parse + normalize a pasted/uploaded roadmap JSON. Throws Error with a readable message. */
export function parseImportFile(raw: unknown): NormalizedImport {
  const canonical = canonicalizeImport(raw)
  const parsed = importFileSchema.safeParse(canonical)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3)
    const details = issues.map((i) => {
      const where = humanizePath(i.path)
      return where ? `${where}: ${describeIssue(i)}` : describeIssue(i)
    })
    let msg = details.join(' · ')
    const looksEmpty = isPlainObject(raw) && raw.goals == null && raw.title == null && raw.name == null
    if (looksEmpty) {
      msg = `This doesn't look like a roadmap file yet — expected { "goals": [ … ] }, an array of goals, or a single goal object. ${msg}`
    }
    throw new Error(msg)
  }
  const goalsRaw = Array.isArray(parsed.data) ? parsed.data : parsed.data.goals
  return { goals: goalsRaw.map(normalizeGoal) }
}

/** Goal-scoped import: add steps/paths/routines to an existing goal. */
export const goalScopeImportSchema = z.object({
  steps: z.array(stepSchema).max(100).nullish(),
  paths: z.array(skillPathSchema).max(12).nullish(),
  routines: z.array(routineSchema).max(30).nullish(),
})

export interface NormalizedGoalScopeImport {
  steps: NormalizedStep[]
  paths: NormalizedSkillPath[]
  routines: NormalizedRoutine[]
}

export function parseGoalScopeImport(raw: unknown): NormalizedGoalScopeImport {
  // accept the raw scoped shape or a full goal object (paths/steps/routines
  // are pulled out of it) — canonicalized with the same lenient aliases
  const scoped = isPlainObject(raw)
    ? Array.isArray(raw.goals) && isPlainObject(raw.goals[0])
      ? raw.goals[0]
      : raw
    : Array.isArray(raw) && isPlainObject(raw[0])
      ? raw[0]
      : {}
  const parsed = goalScopeImportSchema.safeParse({
    steps: Array.isArray(scoped.steps) ? scoped.steps.map(canonStep) : undefined,
    paths: Array.isArray(scoped.paths) ? scoped.paths.map(canonPath) : undefined,
    routines: Array.isArray(scoped.routines) ? scoped.routines.map(canonRoutine) : undefined,
  })
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3)
    const details = issues.map((i) => {
      const where = humanizePath(i.path)
      return where ? `${where}: ${describeIssue(i)}` : describeIssue(i)
    })
    throw new Error(details.join(' · '))
  }
  const g = normalizeGoal({
    title: 'scope',
    steps: parsed.data.steps ?? undefined,
    paths: parsed.data.paths ?? undefined,
    routines: parsed.data.routines ?? undefined,
  })
  return { steps: g.steps, paths: g.paths, routines: g.routines }
}

/** Stats about an import, for the preview step in the dialog. */
export function describeImport(imp: NormalizedImport): {
  goals: number
  steps: number
  paths: number
  nodes: number
  milestones: number
  routines: number
  notes: number
  history: number
} {
  return {
    goals: imp.goals.length,
    steps: imp.goals.reduce((s, g) => s + g.steps.length, 0),
    paths: imp.goals.reduce((s, g) => s + g.paths.length, 0),
    nodes: imp.goals.reduce((s, g) => s + g.paths.reduce((x, p) => x + p.nodes.length, 0), 0),
    milestones: imp.goals.reduce(
      (s, g) => s + g.paths.reduce((x, p) => x + p.nodes.reduce((y, n) => y + n.milestones.length, 0), 0),
      0,
    ),
    routines: imp.goals.reduce((s, g) => s + g.routines.length, 0),
    notes: imp.goals.reduce((s, g) => s + g.notes.length, 0),
    history: imp.goals.reduce(
      (s, g) => s + g.routines.reduce((x, r) => x + r.doneDates.length, 0) + g.logs.length,
      0,
    ),
  }
}

// ---------------------------------------------------------------------------
// Reference example (shown in the Import dialog)
// ---------------------------------------------------------------------------

export const IMPORT_EXAMPLE_JSON = `{
  "version": 1,
  "goals": [
    {
      "title": "Learn Mandarin",
      "description": "Read, write and hold conversations in Mandarin.",
      "emoji": "🀄", "color": "rose", "category": "Language", "type": "plan",
      "deadline": "2027-06-30",
      "paths": [
        {
          "title": "Vocabulary", "icon": "📖", "unit": "words",
          "nodes": [
            { "title": "HSK1", "current": 150, "target": 150, "xp": 20, "milestones": [50, 100] },
            { "title": "HSK2", "current": 300, "target": 300, "xp": 40, "milestones": [100, 200] },
            { "title": "HSK3", "current": 30, "target": 600, "xp": 60,
              "description": "600 most common HSK3 words, recall within 3s",
              "milestones": [ { "value": 100, "label": "First 100" },
                { "value": 300, "label": "Halfway!" }, { "value": 500 } ] },
            { "title": "HSK4", "target": 1200, "xp": 90, "requires": ["HSK3"],
              "description": "Sealed until HSK3 is cleared" }
          ]
        },
        {
          "title": "Grammar", "icon": "🧩",
          "nodes": [
            { "title": "HSK1", "current": 70, "target": 70, "xp": 20 },
            { "title": "HSK2", "current": 75, "target": 75, "xp": 30 },
            { "title": "HSK3", "current": 21, "target": 96, "xp": 40, "milestones": [48] }
          ]
        },
        {
          "title": "Speaking", "icon": "🗣️", "unit": "min",
          "nodes": [
            { "title": "HSK1", "current": 100, "target": 100, "xp": 20 },
            { "title": "HSK2", "current": 80, "target": 100, "xp": 40, "milestones": [50] },
            { "title": "HSK3", "target": 100, "xp": 60,
              "requires": ["Vocabulary › HSK3", "Grammar › HSK3"],
              "description": "Needs the words and grammar first — cross-path lock" }
          ]
        },
        {
          "title": "Reading", "icon": "📜", "unit": "pages",
          "nodes": [
            { "title": "HSK1", "current": 150, "target": 150, "xp": 20 },
            { "title": "HSK2", "current": 280, "target": 300, "xp": 40, "milestones": [150] },
            { "title": "HSK3", "current": 80, "target": 600, "xp": 60,
              "requires": ["HSK2"], "milestones": [200, 400] }
          ]
        }
      ],
      "routines": [
        { "title": "Flashcards — vocab", "weekdays": ["Mon", "Tue", "Thu"],
          "durationMin": 20, "node": "Vocabulary › HSK3", "credit": 25,
          "notes": "Anki deck, focus on the 3-star leeches" },
        { "title": "Grammar practice", "weekdays": ["Tue"], "durationMin": 30,
          "node": "Grammar › HSK3", "credit": 10 },
        { "title": "Speaking practice", "weekdays": ["Sun"], "durationMin": 45,
          "node": "Speaking › HSK2", "credit": 20,
          "notes": "Read aloud + record myself" }
      ],
      "notes": ["Textbook: HSK Standard Course 3. Different focus each day: Mon vocab, Tue vocab + grammar, Sun speaking."]
    },
    {
      "title": "Get stronger", "emoji": "💪", "color": "indigo",
      "category": "Fitness", "type": "plan",
      "paths": [
        { "title": "Strength", "icon": "🏋️", "unit": "sessions",
          "nodes": [
            { "title": "Foundation", "current": 12, "target": 24, "xp": 30, "milestones": [12, 18] },
            { "title": "Intermediate", "target": 48, "xp": 60, "requires": ["Foundation"] }
          ] }
      ],
      "routines": [
        { "title": "Gym — full body", "timesPerWeek": 3, "durationMin": 60,
          "node": "Strength › Foundation", "credit": 1,
          "notes": "3× a week, any day — rest days are part of the plan" }
      ],
      "pbs": [
        { "name": "Deadlift", "unit": "kg", "direction": "up",
          "records": [ { "date": "2026-01-05", "value": 120 } ] }
      ]
    }
  ]
}`
