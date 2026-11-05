export type GoalType = 'quantitative' | 'plan'
export type StepStatus = 'pending' | 'in_progress' | 'done'
export type GoalArchivedStatus = 'active' | 'archived'

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
  createdAt: string
}

export interface ProgressLogData {
  id: string
  goalId: string
  date: string
  amount: number
  note: string | null
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
