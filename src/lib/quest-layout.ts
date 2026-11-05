import type { GoalData, SkillMilestoneData, SkillNodeData, SkillPathData } from './types'
import { buildNodeIndex, depsLocked, nodeDependencies, nodeStatus, type NodeDep } from './skill-tree'

// ---------------------------------------------------------------------------
// Quest map layout: a game-style skill tree. The goal is the root; each skill
// path grows outward as a winding branch; checkpoints (skill nodes) sit along
// the branch and sub-checkpoints (milestones) sprout between them.
//
// Segments are numbered like the node they lead TO: segment 0 runs from the
// root to node 0, segment k runs from node k-1 to node k. A node's milestones
// live on its leading segment at t = value/target.
// ---------------------------------------------------------------------------

export interface Pt {
  x: number
  y: number
}

export interface QuestMilestone {
  data: SkillMilestoneData
  reached: boolean
  /** position along the leading segment (0..1) */
  t: number
  x: number
  y: number
}

/** mastered | active (frontier, can log) | locked (deps unmet) | next (one ahead, dimmed) | ghost (beyond) */
export type QuestNodeView = 'mastered' | 'active' | 'locked' | 'next' | 'ghost'

export interface QuestNode {
  node: SkillNodeData
  path: SkillPathData
  unit: string | null
  status: 'not_started' | 'in_progress' | 'mastered'
  view: QuestNodeView
  progressPct: number
  tier: number
  x: number
  y: number
  milestones: QuestMilestone[]
  /** checkpoints that must be cleared before this one opens */
  deps: NodeDep[]
  /** deps not yet met — logging is blocked until they are */
  locked: boolean
  unlocked: boolean
}

export interface QuestSegment {
  /** node index this segment leads to */
  toIndex: number
  pathIndex: number
  from: Pt
  to: Pt
  c1: Pt
  c2: Pt
  /** svg path d */
  d: string
  /** lit fraction (progress of the node it leads to) */
  lit: number
  /** unlocked = the checkpoint it leads to has its dependencies met */
  unlocked: boolean
}

/** A dashed dependency edge: "to" stays locked until "from" is cleared. */
export interface QuestDepEdge {
  id: string
  from: Pt
  to: Pt
  fromPathIndex: number
  toPathIndex: number
  /** tier of the target node — used for reveal animation timing */
  toTier: number
  met: boolean
  crossPath: boolean
  fromTitle: string
  toTitle: string
}

export interface QuestPathLayout {
  path: SkillPathData
  nodes: QuestNode[]
  segments: QuestSegment[]
  /** point of the frontier (active node) for auto-focus */
  activePoint: Pt | null
  /** anchor for the path label chip (beside the first node) */
  labelPoint: Pt
}

export interface QuestLayout {
  root: Pt
  rootLabel: string
  paths: QuestPathLayout[]
  /** explicit dependency edges (cross-path, or skipping tiers) */
  depEdges: QuestDepEdge[]
  width: number
  height: number
  /** content origin (min x/y of nodes) — content div spans [0..width]x[0..height] */
  offset: Pt
}

const TIER_GAP = 200
const COLUMN_GAP = 330
const ZAG = 62 // lateral zigzag amplitude within a path's column
const PAD = 150

/** Cubic bezier point at t. */
export function cubicAt(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t
  const w1 = u * u * u
  const w2 = 3 * u * u * t
  const w3 = 3 * u * t * t
  const w4 = t * t * t
  return {
    x: a.x * w1 + c1.x * w2 + c2.x * w3 + b.x * w4,
    y: a.y * w1 + c1.y * w2 + c2.y * w3 + b.y * w4,
  }
}

function fmt(n: number): string {
  return Math.round(n * 10) / 10 + ''
}

/**
 * A gentle S-curve between two points. Control points are offset along the
 * perpendicular, alternating sides per tier so the branch winds like a vine.
 */
function segmentCurve(from: Pt, to: Pt, tier: number): { c1: Pt; c2: Pt; d: string } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const side = tier % 2 === 0 ? 1 : -1
  const bow = Math.min(44, len * 0.22) * side
  const c1: Pt = { x: from.x + dx * 0.3 + nx * bow * 0.7, y: from.y + dy * 0.3 + ny * bow * 0.7 }
  const c2: Pt = { x: from.x + dx * 0.7 + nx * bow * 0.7, y: from.y + dy * 0.7 + ny * bow * 0.7 }
  const d = `M ${fmt(from.x)} ${fmt(from.y)} C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(to.x)} ${fmt(to.y)}`
  return { c1, c2, d }
}

export function buildQuestLayout(goal: GoalData): QuestLayout {
  const root: Pt = { x: 0, y: 0 }
  const paths = [...goal.skillPaths].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
  const index = buildNodeIndex(paths)

  const N = Math.max(1, paths.length)

  const allPts: Pt[] = [root]

  const pathLayouts: QuestPathLayout[] = paths.map((p, pi) => {
    const nodesRaw = [...p.nodes].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))

    // 1. positions: each path owns a vertical column; nodes wind up the
    //    column in a gentle zigzag (vine-like, overlap-free by construction)
    const colX = (pi - (N - 1) / 2) * COLUMN_GAP
    const pts: Pt[] = nodesRaw.map((_, k) => ({
      x: colX + Math.sin(k * 2.1 + pi * 0.9) * ZAG * (k === 0 ? 0.5 : 1),
      y: -(k + 1) * TIER_GAP,
    }))

    // 2. dependencies & statuses — derived checkpoints are meters, never gated
    const depInfo = nodesRaw.map((n, k) =>
      n.deriveFromId != null
        ? { deps: [] as NodeDep[], explicit: false }
        : nodeDependencies(n, k > 0 ? nodesRaw[k - 1] : null, index),
    )
    const unlockedFlags = depInfo.map(({ deps }) => !depsLocked(deps))

    // the frontier: first node that isn't mastered and has its deps met
    const activeIdx = nodesRaw.findIndex((n, k) => nodeStatus(n) !== 'mastered' && unlockedFlags[k])
    const qNodes: QuestNode[] = nodesRaw.map((n, k) => {
      const status = nodeStatus(n)
      const { deps } = depInfo[k]
      const unlocked = unlockedFlags[k]
      const view: QuestNodeView =
        status === 'mastered'
          ? 'mastered'
          : k === activeIdx
            ? 'active'
            : !unlocked
              ? 'locked'
              : k === activeIdx + 1
                ? 'next'
                : 'ghost'
      return {
        node: n,
        path: p,
        unit: n.unit ?? p.unit ?? null,
        status,
        view,
        progressPct: n.targetValue > 0 ? Math.min(100, (n.currentValue / n.targetValue) * 100) : 0,
        tier: k,
        x: pts[k].x,
        y: pts[k].y,
        milestones: [],
        deps,
        locked: status !== 'mastered' && !unlocked,
        unlocked: status === 'mastered' || unlocked,
      }
    })

    // 3. segments (segment k leads to node k) + milestones on the curve
    const segments: QuestSegment[] = []
    const nodePts = [root, ...pts]
    for (let k = 0; k < qNodes.length; k++) {
      const from = nodePts[k]
      const to = nodePts[k + 1]
      const { c1, c2, d } = segmentCurve(from, to, k)
      const n = qNodes[k]
      segments.push({
        toIndex: k,
        pathIndex: pi,
        from,
        to,
        c1,
        c2,
        d,
        lit: n.status === 'mastered' ? 1 : n.progressPct / 100,
        unlocked: k === 0 ? true : unlockedFlags[k],
      })

      // milestones of node k sit along this leading segment, on the road
      // (like midway flags on a level-select path)
      n.milestones = [...n.node.milestones]
        .sort((a, b) => a.value - b.value)
        .map((m) => {
          const t =
            n.node.targetValue > 0
              ? Math.min(0.8, Math.max(0.14, m.value / n.node.targetValue))
              : 0.5
          const pt = cubicAt(from, c1, c2, to, t)
          return {
            data: m,
            reached: n.node.currentValue >= m.value,
            t,
            x: pt.x,
            y: pt.y,
          }
        })
      allPts.push(to, ...n.milestones.map((m) => ({ x: m.x, y: m.y })))
    }

    // frontier point for auto-focus: the active node, or the first thing
    // still standing (a locked checkpoint worth seeing) or the top
    const firstStanding = qNodes.findIndex((q) => q.status !== 'mastered')
    const focusIdx = activeIdx !== -1 ? activeIdx : firstStanding !== -1 ? firstStanding : qNodes.length - 1
    const activePoint = pts[Math.max(0, focusIdx)] ?? null
    // label beside the first node, on the side away from the tree's centre
    const first = pts[0] ?? { x: colX, y: -TIER_GAP }
    const outward = colX === 0 ? 1 : Math.sign(colX)
    const labelPoint: Pt = { x: first.x + outward * 104, y: first.y - 10 }
    return { path: p, nodes: qNodes, segments, activePoint, labelPoint }
  })

  // 3b. explicit dependency edges: cross-path ("Reading HSK3 needs Vocab
  //     HSK2") or same-path skips. The plain in-path ladder is already the
  //     branch, so those edges are not drawn.
  const byId = new Map<string, { pi: number; tier: number; pt: Pt; node: SkillNodeData; path: SkillPathData }>()
  pathLayouts.forEach((pl, pi) =>
    pl.nodes.forEach((qn) => byId.set(qn.node.id, { pi, tier: qn.tier, pt: { x: qn.x, y: qn.y }, node: qn.node, path: qn.path })),
  )
  const depEdges: QuestDepEdge[] = []
  for (const pl of pathLayouts) {
    for (const qn of pl.nodes) {
      if (!qn.deps.length) continue
      const target = byId.get(qn.node.id)!
      for (const dep of qn.deps) {
        const src = byId.get(dep.id)
        if (!src) continue
        if (src.pi === target.pi && src.tier === target.tier - 1) continue // the branch itself
        depEdges.push({
          id: `${dep.id}->${qn.node.id}`,
          from: src.pt,
          to: target.pt,
          fromPathIndex: src.pi,
          toPathIndex: target.pi,
          toTier: target.tier,
          met: dep.mastered,
          crossPath: src.pi !== target.pi,
          fromTitle: dep.pathTitle ? `${dep.pathIcon} ${dep.pathTitle} · ${dep.title}` : dep.title,
          toTitle: qn.node.title,
        })
      }
    }
  }

  // 4. bounds
  const minX = Math.min(...allPts.map((p) => p.x)) - PAD
  const maxX = Math.max(...allPts.map((p) => p.x)) + PAD
  const minY = Math.min(...allPts.map((p) => p.y)) - PAD - 30
  const maxY = Math.max(...allPts.map((p) => p.y)) + PAD

  return {
    root,
    rootLabel: goal.emoji,
    paths: pathLayouts,
    depEdges,
    width: maxX - minX,
    height: maxY - minY,
    offset: { x: minX, y: minY },
  }
}

/** Shift layout coordinates into content space (0..width, 0..height). */
export function toContent(layout: QuestLayout, p: Pt): Pt {
  return { x: p.x - layout.offset.x, y: p.y - layout.offset.y }
}
