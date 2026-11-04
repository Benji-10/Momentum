import type { GoalData, SkillMilestoneData, SkillNodeData, SkillNodeStatus, SkillPathData } from './types'

// ---------------------------------------------------------------------------
// Path-based skill map: each goal has parallel paths (e.g. Vocabulary,
// Grammar, Fluency) and each path is an ordered ladder of tiers with
// measurable progress ("HSK3 · 30/600 words").
// ---------------------------------------------------------------------------

export interface MilestoneView {
  data: SkillMilestoneData
  reached: boolean
  /** progress fraction (0..1) of the owning node at which this milestone sits */
  t: number
}

/** A resolved dependency: another checkpoint that must be mastered first. */
export interface NodeDep {
  id: string
  title: string
  icon: string
  pathTitle: string
  pathIcon: string
  mastered: boolean
}

export interface SkillNodeView {
  node: SkillNodeData
  path: SkillPathData
  status: SkillNodeStatus
  /** effective unit for display: node.unit ?? path.unit ?? null */
  unit: string | null
  progressPct: number // 0..100
  milestones: MilestoneView[]
  reachedMilestones: number
  /** checkpoints that must be mastered before progress is allowed here */
  deps: NodeDep[]
  /** true = deps contain an unmastered checkpoint (progress locked) */
  locked: boolean
  /** true = requiresIds was set explicitly (vs the default in-path ladder) */
  explicitDeps: boolean
}

export interface SkillPathView {
  path: SkillPathData
  nodes: SkillNodeView[] // ordered by tier
  current: number // sum of current values
  target: number // sum of target values
  progressPct: number
  masteredCount: number
  /** next (lowest-order) node not yet mastered */
  nextNode: SkillNodeView | null
  status: SkillNodeStatus // derived for the whole path
}

export interface SkillMapStats {
  totalNodes: number
  mastered: number
  inProgress: number
  notStarted: number
  locked: number
  current: number
  target: number
  progressPct: number
  xpEarned: number
  xpTotal: number
  milestonesReached: number
  milestonesTotal: number
  /** expected overall progress (0..100) by now, if the goal has a deadline */
  expectedPct: number | null
  pace: 'ahead' | 'on_track' | 'behind' | 'none'
}

export interface SkillMap {
  paths: SkillPathView[]
  /** tiers[i] = nodes at tier index i across all paths (for grid layout) */
  tiers: SkillNodeView[][]
  stats: SkillMapStats
}

export function nodeStatus(n: { currentValue: number; targetValue: number }): SkillNodeStatus {
  if (n.targetValue > 0 && n.currentValue >= n.targetValue) return 'mastered'
  if (n.currentValue > 0) return 'in_progress'
  return 'not_started'
}

export function nodeUnit(n: SkillNodeData, p: SkillPathData): string | null {
  return n.unit ?? p.unit ?? null
}

// ---------------------------------------------------------------------------
// Dependencies / unlocking
//
// Structural input types: both client data (requiresIds: string[]) and
// raw Prisma rows (requiresIds: string | null, csv) satisfy them, so the
// server routes can gate progress with the same logic the UI uses.
// ---------------------------------------------------------------------------

export interface DepNodeShape {
  id: string
  title: string
  icon: string
  currentValue: number
  targetValue: number
  requiresIds?: string | string[] | null
}
export interface DepPathShape {
  title: string
  icon: string
  nodes: DepNodeShape[]
}

/** Index of every node in a goal, for resolving requires ids and titles. */
export interface NodeIndexEntry {
  node: DepNodeShape
  path: DepPathShape
}

export function buildNodeIndex(paths: DepPathShape[]): Map<string, NodeIndexEntry> {
  const m = new Map<string, NodeIndexEntry>()
  for (const p of paths) for (const n of p.nodes) m.set(n.id, { node: n, path: p })
  return m
}

function requireIdList(n: DepNodeShape): string[] {
  if (Array.isArray(n.requiresIds)) return n.requiresIds
  if (typeof n.requiresIds === 'string' && n.requiresIds.trim()) {
    return n.requiresIds.split(',').map((s) => s.trim()).filter(Boolean)
  }
  return []
}

/**
 * The dependencies of a node: its explicit requiresIds if set (cross-path
 * allowed), otherwise the previous node in its own path — the natural
 * HSK2 → HSK3 ladder. Unknown ids are quietly dropped.
 */
export function nodeDependencies(
  n: DepNodeShape,
  prevInPath: DepNodeShape | null,
  index: Map<string, NodeIndexEntry>,
): { deps: NodeDep[]; explicit: boolean } {
  const ids = requireIdList(n)
  if (ids.length > 0) {
    const seen = new Set<string>()
    const deps: NodeDep[] = []
    for (const id of ids) {
      if (id === n.id || seen.has(id)) continue
      const e = index.get(id)
      if (!e) continue
      seen.add(id)
      deps.push({
        id,
        title: e.node.title,
        icon: e.node.icon,
        pathTitle: e.path.title,
        pathIcon: e.path.icon,
        mastered: nodeStatus(e.node) === 'mastered',
      })
    }
    return { deps, explicit: true }
  }
  if (prevInPath) {
    return {
      deps: [
        {
          id: prevInPath.id,
          title: prevInPath.title,
          icon: prevInPath.icon,
          pathTitle: '',
          pathIcon: '',
          mastered: nodeStatus(prevInPath) === 'mastered',
        },
      ],
      explicit: false,
    }
  }
  return { deps: [], explicit: false }
}

export function depsLocked(deps: NodeDep[]): boolean {
  return deps.some((d) => !d.mastered)
}

export function buildSkillMap(goal: GoalData, now: Date = new Date()): SkillMap {
  const paths = [...goal.skillPaths].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
  const index = buildNodeIndex(paths)
  const pathViews: SkillPathView[] = paths.map((p) => {
    const sortedNodes = [...p.nodes].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
    const nodes = sortedNodes.map<SkillNodeView>((n, k) => {
      const { deps, explicit } = nodeDependencies(n, k > 0 ? sortedNodes[k - 1] : null, index)
      return {
        node: n,
        path: p,
        status: nodeStatus(n),
        unit: nodeUnit(n, p),
        progressPct: n.targetValue > 0 ? Math.min(100, (n.currentValue / n.targetValue) * 100) : 0,
        milestones: [...n.milestones]
          .sort((a, b) => a.value - b.value)
          .map((m) => ({
            data: m,
            reached: n.currentValue >= m.value,
            t: n.targetValue > 0 ? Math.min(0.92, Math.max(0.08, m.value / n.targetValue)) : 0.5,
          })),
        reachedMilestones: n.milestones.filter((m) => n.currentValue >= m.value).length,
        deps,
        locked: depsLocked(deps),
        explicitDeps: explicit,
      }
    })
    const current = nodes.reduce((s, v) => s + v.node.currentValue, 0)
    const target = nodes.reduce((s, v) => s + v.node.targetValue, 0)
    const masteredCount = nodes.filter((v) => v.status === 'mastered').length
    const nextNode = nodes.find((v) => v.status !== 'mastered' && !v.locked) ?? null
    return {
      path: p,
      nodes,
      current,
      target,
      progressPct: target > 0 ? Math.round((current / target) * 100) : 0,
      masteredCount,
      nextNode,
      status:
        masteredCount === nodes.length && nodes.length > 0
          ? 'mastered'
          : current > 0
            ? 'in_progress'
            : 'not_started',
    }
  })

  const allNodes = pathViews.flatMap((p) => p.nodes)
  const maxTier = Math.max(0, ...allNodes.map((v) => v.node.order))
  const tiers: SkillNodeView[][] = Array.from({ length: maxTier + 1 }, () => [])
  for (const v of allNodes) tiers[v.node.order].push(v)

  const current = allNodes.reduce((s, v) => s + v.node.currentValue, 0)
  const target = allNodes.reduce((s, v) => s + v.node.targetValue, 0)
  const mastered = allNodes.filter((v) => v.status === 'mastered')
  const inProgress = allNodes.filter((v) => v.status === 'in_progress')
  const reachedMilestoneCount = allNodes.reduce((s, v) => s + v.reachedMilestones, 0)
  const xpEarned =
    mastered.reduce((s, v) => s + v.node.xpValue, 0) + reachedMilestoneCount * XP_PER_MILESTONE
  const xpTotal =
    allNodes.reduce((s, v) => s + v.node.xpValue, 0) +
    allNodes.reduce((s, v) => s + v.milestones.length, 0) * XP_PER_MILESTONE
  const progressPct = target > 0 ? Math.round((current / target) * 100) : 0

  let expectedPct: number | null = null
  if (goal.deadline && target > 0) {
    const start = new Date(goal.createdAt).getTime()
    const end = new Date(goal.deadline).getTime()
    if (end > start) {
      const frac = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)))
      expectedPct = Math.round(frac * 100)
    }
  }
  let pace: SkillMapStats['pace'] = 'none'
  if (expectedPct != null) {
    if (progressPct >= expectedPct + 5) pace = 'ahead'
    else if (progressPct >= expectedPct - 10) pace = 'on_track'
    else pace = 'behind'
  } else if (target > 0 && progressPct >= 100) {
    pace = 'ahead'
  }

  return {
    paths: pathViews,
    tiers,
    stats: {
      totalNodes: allNodes.length,
      mastered: mastered.length,
      inProgress: inProgress.length,
      notStarted: allNodes.filter((v) => v.status === 'not_started').length,
      locked: allNodes.filter((v) => v.locked && v.status !== 'mastered').length,
      current,
      target,
      progressPct,
      xpEarned,
      xpTotal,
      expectedPct,
      pace,
      milestonesReached: reachedMilestoneCount,
      milestonesTotal: allNodes.reduce((s, v) => s + v.milestones.length, 0),
    },
  }
}

/** Parse a csv weekdays string ("0,3") into numbers. */
export function parseWeekdaysCsv(csv: string | null): number[] {
  if (!csv) return []
  return csv
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => n >= 0 && n <= 6)
}

/** Parse a csv node-id string into ids. */
function parseIdsCsv(csv: string | null): string[] {
  if (!csv) return []
  return csv.split(',').map((s) => s.trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------
// XP & levels (global gamification)
// ---------------------------------------------------------------------------

export const XP_PER_STEP_DONE = 10
export const XP_PER_LOG = 2
export const XP_PER_ROUTINE_DONE = 5
export const XP_PER_MILESTONE = 5

export interface GlobalXp {
  xp: number
  level: number
  xpForNext: number
  levelProgress: number // 0..1 within current level
  breakdown: { steps: number; skills: number; routines: number; logs: number }
}

/** XP needed in total to *reach* level L (L >= 1). Level 1 starts at 0 XP. */
export function xpToReachLevel(level: number): number {
  if (level <= 1) return 0
  // each level-up costs 100 + 50 * (L-2): L1→2 = 100, L2→3 = 150, ...
  let total = 0
  for (let l = 2; l <= level; l++) total += 100 + 50 * (l - 2)
  return total
}

export function computeXp(goals: GoalData[]): GlobalXp {
  const steps = goals.reduce(
    (s, g) => s + g.steps.filter((st) => st.status === 'done').length * XP_PER_STEP_DONE,
    0,
  )
  const skills = goals.reduce(
    (s, g) =>
      s +
      g.skillPaths.reduce(
        (x, p) =>
          x +
          p.nodes.reduce((y, n) => {
            const masteredXp = n.targetValue > 0 && n.currentValue >= n.targetValue ? n.xpValue : 0
            const milestoneXp = n.milestones.filter((m) => n.currentValue >= m.value).length * XP_PER_MILESTONE
            return y + masteredXp + milestoneXp
          }, 0),
        0,
      ),
    0,
  )
  const routines = goals.reduce(
    (s, g) => s + g.routines.reduce((x, r) => x + r.dones.length * XP_PER_ROUTINE_DONE, 0),
    0,
  )
  const logs = goals.reduce((s, g) => s + g.logs.length * XP_PER_LOG, 0)
  const xp = steps + skills + routines + logs

  let level = 1
  while (xp >= xpToReachLevel(level + 1)) level++
  const curBase = xpToReachLevel(level)
  const nextBase = xpToReachLevel(level + 1)
  return {
    xp,
    level,
    xpForNext: nextBase - xp,
    levelProgress: Math.max(0, Math.min(1, (xp - curBase) / (nextBase - curBase))),
    breakdown: { steps, skills, routines, logs },
  }
}
