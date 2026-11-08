export type GoalType = 'quantitative' | 'plan'
export type StepStatus = 'pending' | 'in_progress' | 'done'
export type GoalArchivedStatus = 'active' | 'archived'

/** How a step completes: by hand, after N routine check-offs, or when a
 *  personal-best metric's rolling average crosses a threshold. */
export type StepTriggerType = 'manual' | 'routine' | 'metric'
export type MetricOp = 'under' | 'over'

/** Computed tracking status shown in the UI. */
export type TrackStatus =
  | 'completed'
  | 'ahead'
  | 'on_track'
  | 'behind'
  | 'ended'
  | 'not_started'

export type RoutineCadence = 'interval' | 'weekly' | 'flexible'

/** Derived skill node status. */
export type SkillNodeStatus = 'not_started' | 'in_progress' | 'mastered'

export interface GoalStepData {
  id: string
  goalId: string
  title: string
  notes: string | null
  order: number
  status: StepStatus
  completedAt: string | null
  // ---- automation (how this step completes) ----
  trigger: StepTriggerType
  /** routine trigger: the routine whose check-offs count (null = any) */
  routineId: string | null
  /** routine trigger: how many check-offs complete the step */
  triggerCount: number
  /** metric trigger: PB metric name (unique per goal) */
  metricName: string | null
  /** metric trigger: rolling average over the last N attempts (null = 3) */
  metricWindow: number | null
  /** metric trigger: "under" = avg must drop below metricValue (solve times),
   *  "over" = avg must rise above it (WPM, distance) */
  metricOp: MetricOp | null
  metricValue: number | null
  /** when this step became current — check-offs before it count for the
   *  previous step (null = the whole history counts; day-granular) */
  currentSince: string | null
  createdAt: string
}

export interface ProgressLogData {
  id: string
  goalId: string
  date: string
  amount: number
  note: string | null
  /** The unit this amount was recorded in ("words", "min", …) — null = the
   * goal's own unit (manual entries and pre-v1.5 check-offs). */
  unit: string | null
  createdAt: string
}

export interface GoalNoteData {
  id: string
  goalId: string
  content: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export interface RoutineDoneData {
  id: string
  routineId: string
  /** calendar day "YYYY-MM-DD" (parsed as local midnight); legacy rows may
   *  still carry a full ISO timestamp — parseDayKey() handles both */
  date: string
  /** progress that was auto-added to the linked skill node (for undo) */
  creditedValue: number | null
  /** the auto-created progress log entry (amount edits flow into the node) */
  logId: string | null
  /** the step this check-off completed, if any (undo re-opens it) */
  advancedStepId: string | null
}

export interface RoutineData {
  id: string
  goalId: string
  title: string
  notes: string | null
  cadence: RoutineCadence
  everyNDays: number | null
  weekdays: number[] | null // 0=Sun .. 6=Sat
  /** flexible cadence: N sessions per week, on any day */
  timesPerWeek: number | null
  /** the skill node this session advances, e.g. Tuesday = grammar */
  nodeId: string | null
  /** progress auto-added to the linked node per completed session */
  credit: number | null
  durationMin: number | null
  startDate: string
  endDate: string | null
  archived: boolean
  /** extra credit: nice to do, never a penalty when skipped */
  optional: boolean
  createdAt: string
  dones: RoutineDoneData[]
}

export interface SkillMilestoneData {
  id: string
  nodeId: string
  value: number
  label: string | null
  reachedAt: string | null
}

export interface SkillNodeData {
  id: string
  goalId: string
  pathId: string
  title: string
  description: string | null
  icon: string
  order: number
  currentValue: number
  targetValue: number
  unit: string | null
  xpValue: number
  /** ids of nodes that must be mastered before this unlocks ([] = previous in path) */
  requiresIds: string[]
  /** derived checkpoint: source node id whose progress auto-converts into ours */
  deriveFromId: string | null
  /** how many source units make 1 of this node's unit (e.g. 300 pages = 1 book) */
  deriveFactor: number | null
  completedAt: string | null
  createdAt: string
  milestones: SkillMilestoneData[]
}

export interface SkillPathData {
  id: string
  goalId: string
  title: string
  description: string | null
  icon: string
  unit: string | null
  order: number
  createdAt: string
  nodes: SkillNodeData[]
}

/** One attempt at a personal-best metric, e.g. 128 WPM on 2026-10-31. */
export interface PbRecordData {
  id: string
  date: string
  value: number
  note: string | null
}

/** A personal-best metric on a goal — "WPM" (higher = better) or "BLD
 *  solve" (lower = better). The current PB is derived from `records`. */
export interface PersonalBestData {
  id: string
  goalId: string
  name: string
  unit: string | null
  direction: 'up' | 'down'
  records: PbRecordData[]
  createdAt: string
  updatedAt: string
}

export interface GoalData {
  id: string
  title: string
  description: string | null
  emoji: string
  color: string
  category: string | null
  type: GoalType
  targetValue: number | null
  unit: string | null
  weeklyTarget: number | null
  deadline: string | null
  status: GoalArchivedStatus
  createdAt: string
  updatedAt: string
  steps: GoalStepData[]
  logs: ProgressLogData[]
  notes: GoalNoteData[]
  routines: RoutineData[]
  skillPaths: SkillPathData[]
  pbs: PersonalBestData[]
}

export interface StepInput {
  title: string
  notes?: string | null
}

export interface RoutineInput {
  title: string
  notes?: string | null
  cadence?: RoutineCadence
  everyNDays?: number | null
  weekdays?: number[] | null
  timesPerWeek?: number | null
  nodeId?: string | null
  credit?: number | null
  durationMin?: number | null
  startDate?: string | null
  endDate?: string | null
  optional?: boolean
}

export interface CreateGoalInput {
  title: string
  description?: string | null
  emoji?: string
  color?: string
  category?: string | null
  type: GoalType
  targetValue?: number | null
  unit?: string | null
  weeklyTarget?: number | null
  deadline?: string | null
  steps?: StepInput[]
}

/** Outcome of a merge-mode import (matching by name, progress kept).
 *  "Kept" counts existing items the file didn't mention — they are untouched. */
export interface MergeSummary {
  goalsCreated: number
  goalsUpdated: number
  pathsCreated: number
  pathsUpdated: number
  pathsKept: number
  nodesCreated: number
  nodesUpdated: number
  nodesKept: number
  milestonesAdded: number
  milestonesRemoved: number
  stepsCreated: number
  stepsUpdated: number
  stepsKept: number
  routinesCreated: number
  routinesUpdated: number
  donesAdded: number
  pbsCreated: number
  pbsUpdated: number
  recordsAdded: number
  logsAdded: number
  notesAdded: number
}
