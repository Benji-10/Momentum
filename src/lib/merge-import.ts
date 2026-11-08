import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { db } from './db'
import { goalInclude } from './goal-serialize'
import {
  isoFromFlexibleDate,
  isoFromDaysAgoOrDate,
  normalizeGoal,
  weekdayToNumber,
  type ImportGoalRaw,
  type RawGoalScopeImport,
} from './import-format'
import { resolveNodeRef, filterCyclicEdges, idsCsv, type NodeRefEntry } from './resolve-refs'
import { canonicalDayUtc } from './routine-math'
import { resyncDerivedMeters, setNodeDerivation } from './derive'
import type { MergeSummary } from './types'

// ---------------------------------------------------------------------------
// Merge import ("upsert by name")
//
// Re-importing an updated roadmap file updates matching goals, branches and
// checkpoints in place instead of duplicating them. One principle drives every
// rule below:
//
//     DEFINITIONS follow the file · PROGRESS survives wherever it still fits.
//
// Matching keys (titles/names, case-insensitive + whitespace-normalized):
//   goal ← title · path ← title (within the goal) · node ← title (within path)
//   step ← title (within the goal) · routine ← title (within the goal)
//   pb ← name (within the goal)
//
// Field presence semantics on matched items:
//   absent from the file → keep the existing value (a partial file only
//   touches what it mentions) · null → clear it · a value → set it.
//
// Progress fields are never removed by a merge:
//   node.current     → max(existing, incoming) — progress can only grow
//   node.completedAt → kept when the node is still cleared, stamped when it
//                      newly reaches (a raised) target, cleared only when the
//                      new target outruns the progress
//   step.done        → existing OR incoming (a merge never un-ticks)
//   routine.dones    → union of days (deduped)
//   pb.records       → appended, deduped by day + value
//   logs / notes     → appended, deduped by day+amount+note / exact content
//   milestones       → synced to the file's list, but a kept value keeps its
//                      reachedAt (and gets stamped if progress now covers it)
//
// Derivation follows the file like any definition (value → set, null → clear,
// absent → keep); the meter itself is re-synced upward only — existing
// progress on the meter is never taken away when the source/factor changes.
//
// Items that exist in the database but are NOT in the file are kept untouched
// (renaming a checkpoint in the file therefore creates a new one rather than
// deleting the old one's progress). Existing dependency edges are locked in;
// new "requires" edges from the file are added on top, cycle-safe.
// ---------------------------------------------------------------------------

type GoalRow = Prisma.GoalGetPayload<{ include: typeof goalInclude }>
type PathRow = GoalRow['skillPaths'][number]
type NodeRow = PathRow['nodes'][number]
type RoutineRow = GoalRow['routines'][number]
type RawPath = NonNullable<ImportGoalRaw['paths']>[number]
type RawNode = RawPath['nodes'][number]
type RawRoutine = NonNullable<ImportGoalRaw['routines']>[number]

function normTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function emptySummary(): MergeSummary {
  return {
    goalsCreated: 0,
    goalsUpdated: 0,
    pathsCreated: 0,
    pathsUpdated: 0,
    pathsKept: 0,
    nodesCreated: 0,
    nodesUpdated: 0,
    nodesKept: 0,
    milestonesAdded: 0,
    milestonesRemoved: 0,
    stepsCreated: 0,
    stepsUpdated: 0,
    stepsKept: 0,
    routinesCreated: 0,
    routinesUpdated: 0,
    donesAdded: 0,
    pbsCreated: 0,
    pbsUpdated: 0,
    recordsAdded: 0,
    logsAdded: 0,
    notesAdded: 0,
  }
}

function dayKey(d: Date | string): string {
  return (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
}

/** Normalized milestone definitions from a raw node (sorted, deduped, < target). */
function milestoneDefs(n: RawNode): { value: number; label: string | null }[] {
  const target = n.target
  const raw = (n.milestones ?? []).map((m) =>
    typeof m === 'number' ? { value: m, label: null } : { value: m.value, label: m.label?.trim() || null },
  )
  const byValue = new Map<number, string | null>()
  for (const m of raw) {
    if (m.value > 0 && m.value < target && !byValue.has(m.value)) byValue.set(m.value, m.label)
  }
  return [...byValue.entries()].sort((a, b) => a[0] - b[0]).map(([value, label]) => ({ value, label }))
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Full-file merge: match goals by title (active goals first), update them in
 *  place, create the ones that don't exist yet. */
export async function mergeImportGoals(userId: string, goals: ImportGoalRaw[]): Promise<MergeSummary> {
  const summary = emptySummary()
  const existing = await db.goal.findMany({ where: { userId }, include: goalInclude, orderBy: { createdAt: 'asc' } })
  // active goals match first — a stale archived copy shouldn't swallow the merge
  const ordered = [...existing].sort((a, b) =>
    a.status === b.status ? 0 : a.status === 'active' ? -1 : 1,
  )
  const byTitle = new Map<string, GoalRow>()
  for (const g of ordered) {
    const key = normTitle(g.title)
    if (!byTitle.has(key)) byTitle.set(key, g)
  }

  for (const g of goals) {
    const match = byTitle.get(normTitle(g.title))
    if (match) {
      await mergeGoalLevel(match, g)
      await mergeEntitiesIntoGoal(match.id, g, summary)
      summary.goalsUpdated++
    } else {
      // brand-new goal: create-mode defaults for the goal level
      const n = normalizeGoal(g)
      const created = await db.goal.create({
        data: {
          userId,
          title: n.title,
          description: n.description,
          emoji: n.emoji,
          color: n.color,
          category: n.category,
          type: n.type,
          targetValue: n.targetValue,
          unit: n.unit,
          weeklyTarget: n.weeklyTarget,
          deadline: n.deadline ? new Date(n.deadline) : null,
        },
      })
      await mergeEntitiesIntoGoal(created.id, g, summary)
      summary.goalsCreated++
    }
  }
  return summary
}

/** Goal-scoped merge ("import into this goal"): upserts steps/paths/routines
 *  by name inside one goal, keeping all progress. */
export async function mergeIntoGoal(goalId: string, scope: RawGoalScopeImport): Promise<MergeSummary> {
  const summary = emptySummary()
  await mergeEntitiesIntoGoal(goalId, scope, summary)
  return summary
}

// ---------------------------------------------------------------------------
// Goal level
// ---------------------------------------------------------------------------

async function mergeGoalLevel(goal: GoalRow, g: ImportGoalRaw): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (g.description !== undefined) patch.description = g.description
  if (g.emoji !== undefined) patch.emoji = g.emoji ?? '🎯'
  if (g.color !== undefined) patch.color = g.color ?? 'emerald'
  if (g.category !== undefined) patch.category = g.category?.trim() || null
  if (g.type != null) patch.type = g.type
  const effectiveType = g.type ?? goal.type
  if (g.targetValue !== undefined) patch.targetValue = effectiveType === 'quantitative' ? (g.targetValue ?? null) : null
  if (g.unit !== undefined) patch.unit = g.unit?.trim() || null
  if (g.weeklyTarget !== undefined) patch.weeklyTarget = g.weeklyTarget ?? null
  if (g.deadline !== undefined) patch.deadline = isoFromFlexibleDate(g.deadline)
  if (Object.keys(patch).length > 0) {
    await db.goal.update({ where: { id: goal.id }, data: patch as Prisma.GoalUpdateInput })
  }
}

// ---------------------------------------------------------------------------
// Entities (steps · paths+nodes · requires · routines · pbs · logs · notes)
// ---------------------------------------------------------------------------

type EntityScope = {
  steps?: ImportGoalRaw['steps']
  paths?: ImportGoalRaw['paths']
  routines?: ImportGoalRaw['routines']
  pbs?: ImportGoalRaw['pbs']
  logs?: ImportGoalRaw['logs']
  notes?: ImportGoalRaw['notes']
}

async function mergeEntitiesIntoGoal(goalId: string, scope: EntityScope, summary: MergeSummary): Promise<void> {
  const goal = await db.goal.findUnique({ where: { id: goalId }, include: goalInclude })
  if (!goal) return

  await mergeSteps(goal, scope.steps, summary)

  // existing dependency edges (captured before any update — nodes' requiresIds
  // are only written by syncRequires below)
  const existingRequires = new Map<string, string[]>()
  for (const p of goal.skillPaths) {
    for (const n of p.nodes) {
      existingRequires.set(n.id, n.requiresIds ? n.requiresIds.split(',').map((s) => s.trim()).filter(Boolean) : [])
    }
  }

  // derivation changes asked for by the file, applied once every node exists
  // (refs may point at kept, updated or newly created checkpoints)
  const pendingDerive = new Map<string, { ref: string | null | undefined; factor: number | null | undefined }>()

  const fileRequires = await mergePaths(goal, scope.paths, summary, pendingDerive)
  const entries = await nodeEntries(goal.id)
  await syncRequires(goal.id, fileRequires, existingRequires, entries)
  await syncDerive(goal.id, pendingDerive, entries)
  // final pass: every meter reflects its source's (possibly updated) progress —
  // one deterministic sweep instead of order-dependent per-node propagation
  await resyncDerivedMeters(goal.id)

  await mergeRoutines(goal, scope.routines, entries, summary)
  await mergePbs(goal, scope.pbs, summary)
  await mergeLogs(goal, scope.logs, summary)
  await mergeNotes(goal, scope.notes, summary)
}

async function mergeSteps(goal: GoalRow, steps: ImportGoalRaw['steps'], summary: MergeSummary): Promise<void> {
  if (!steps?.length) return
  const byTitle = new Map<string, GoalRow['steps'][number]>()
  for (const s of goal.steps) {
    const key = normTitle(s.title)
    if (!byTitle.has(key)) byTitle.set(key, s)
  }
  let maxOrder = goal.steps.reduce((m, s) => Math.max(m, s.order), -1)
  let matched = 0

  for (const s of steps) {
    const raw = typeof s === 'string' ? { title: s } : s
    const m = byTitle.get(normTitle(raw.title))
    if (m) {
      matched++
      const patch: Record<string, unknown> = {}
      if (raw.notes !== undefined) patch.notes = raw.notes
      if (raw.done === true && m.status !== 'done') {
        patch.status = 'done'
        patch.completedAt = new Date()
      }
      if (Object.keys(patch).length > 0) {
        await db.goalStep.update({ where: { id: m.id }, data: patch as Prisma.GoalStepUpdateInput })
      }
      summary.stepsUpdated++
    } else {
      const [ns] = normalizeGoal({ title: 'scope', steps: [s] }).steps
      await db.goalStep.create({
        data: {
          goalId: goal.id,
          title: ns.title,
          notes: ns.notes,
          order: ++maxOrder,
          status: ns.done ? 'done' : 'pending',
          completedAt: ns.done ? new Date() : null,
        },
      })
      summary.stepsCreated++
    }
  }
  summary.stepsKept += goal.steps.length - matched
}

/** Merge paths + their nodes. Returns nodeId → file "requires" refs for every
 *  node whose gating the file defines (matched with a requires key, or newly
 *  created with one). Derivation requests are collected into `pendingDerive`
 *  for a later syncDerive pass. */
async function mergePaths(
  goal: GoalRow,
  paths: ImportGoalRaw['paths'],
  summary: MergeSummary,
  pendingDerive: Map<string, { ref: string | null | undefined; factor: number | null | undefined }>,
): Promise<Map<string, string[]>> {
  const fileRequires = new Map<string, string[]>()
  if (!paths?.length) {
    summary.pathsKept += goal.skillPaths.length
    for (const p of goal.skillPaths) summary.nodesKept += p.nodes.length
    return fileRequires
  }

  const byTitle = new Map<string, PathRow>()
  for (const p of goal.skillPaths) {
    const key = normTitle(p.title)
    if (!byTitle.has(key)) byTitle.set(key, p)
  }
  let matchedPaths = 0

  for (const p of paths) {
    const m = byTitle.get(normTitle(p.title))
    if (m) {
      matchedPaths++
      const patch: Record<string, unknown> = {}
      if (p.description !== undefined) patch.description = p.description
      if (p.icon !== undefined) patch.icon = p.icon ?? '🌿'
      if (p.unit !== undefined) patch.unit = p.unit?.trim() || null
      if (Object.keys(patch).length > 0) {
        await db.skillPath.update({ where: { id: m.id }, data: patch as Prisma.SkillPathUpdateInput })
      }
      summary.pathsUpdated++
      await mergeNodes(goal.id, m, p, summary, fileRequires, pendingDerive)
    } else {
      // brand-new branch: create-mode semantics (normalizeGoal defaults)
      const [np] = normalizeGoal({ title: 'scope', paths: [p] }).paths
      const maxOrder = await db.skillPath.aggregate({ where: { goalId: goal.id }, _max: { order: true } })
      const created = await db.skillPath.create({
        data: {
          goalId: goal.id,
          title: np.title,
          description: np.description,
          icon: np.icon,
          unit: np.unit,
          order: (maxOrder._max.order ?? -1) + 1,
          nodes: {
            create: np.nodes.map((n, i) => ({
              goalId: goal.id,
              title: n.title,
              description: n.description,
              icon: n.icon,
              order: i,
              currentValue: n.currentValue,
              targetValue: n.targetValue,
              unit: n.unit,
              xpValue: n.xpValue,
              completedAt: n.currentValue >= n.targetValue ? new Date() : null,
              milestones: {
                create: n.milestones.map((ms) => ({
                  value: ms.value,
                  label: ms.label,
                  reachedAt: n.currentValue >= ms.value ? new Date() : null,
                })),
              },
            })),
          },
        },
        include: { nodes: { orderBy: { order: 'asc' } } },
      })
      // pair created nodes with the file's requires (if any)
      np.nodes.forEach((n, i) => {
        const createdNode = created.nodes[i]
        if (createdNode && n.requires.length > 0) fileRequires.set(createdNode.id, n.requires)
        // …and with the file's derivation, when fully specified
        if (createdNode && n.deriveFromRef && n.deriveFactor != null) {
          pendingDerive.set(createdNode.id, { ref: n.deriveFromRef, factor: n.deriveFactor })
        }
      })
      summary.pathsCreated++
      summary.nodesCreated += np.nodes.length
    }
  }
  summary.pathsKept += goal.skillPaths.length - matchedPaths
  return fileRequires
}

async function mergeNodes(
  goalId: string,
  path: PathRow,
  p: RawPath,
  summary: MergeSummary,
  fileRequires: Map<string, string[]>,
  pendingDerive: Map<string, { ref: string | null | undefined; factor: number | null | undefined }>,
): Promise<void> {
  const byTitle = new Map<string, NodeRow>()
  for (const n of path.nodes) {
    const key = normTitle(n.title)
    if (!byTitle.has(key)) byTitle.set(key, n)
  }
  const existingOrders = path.nodes.map((n) => n.order)
  const minOrder = existingOrders.length ? Math.min(...existingOrders) : 0
  let anchor: number | null = null
  let seq = 0
  let matched = 0
  const createdIds: string[] = []

  for (const n of p.nodes) {
    const m = byTitle.get(normTitle(n.title))
    if (m) {
      matched++
      anchor = m.order
      seq = 0
      await updateMatchedNode(m, n, summary)
      if (n.requires !== undefined) fileRequires.set(m.id, n.requires ?? [])
      if (n.deriveFrom !== undefined || n.derivePer !== undefined) {
        pendingDerive.set(m.id, { ref: n.deriveFrom, factor: n.derivePer })
      }
    } else {
      // insert the new checkpoint right after its file predecessor (or at the
      // top of the path if it comes first); orders are re-indexed afterwards
      seq++
      const order = anchor == null ? minOrder - seq : anchor + seq * 0.001
      const [nn] = normalizeGoal({ title: 'scope', paths: [{ title: path.title, nodes: [n] }] }).paths
      const node = nn.nodes[0]
      const created = await db.skillNode.create({
        data: {
          goalId,
          pathId: path.id,
          title: node.title,
          description: node.description,
          icon: node.icon,
          order,
          currentValue: node.currentValue,
          targetValue: node.targetValue,
          unit: node.unit,
          xpValue: node.xpValue,
          completedAt: node.currentValue >= node.targetValue ? new Date() : null,
          milestones: {
            create: node.milestones.map((ms) => ({
              value: ms.value,
              label: ms.label,
              reachedAt: node.currentValue >= ms.value ? new Date() : null,
            })),
          },
        },
      })
      createdIds.push(created.id)
      if (n.requires !== undefined) fileRequires.set(created.id, n.requires ?? [])
      if (node.deriveFromRef && node.deriveFactor != null) {
        pendingDerive.set(created.id, { ref: node.deriveFromRef, factor: node.deriveFactor })
      }
      anchor = order
      summary.nodesCreated++
    }
  }
  summary.nodesKept += path.nodes.length - matched

  // re-index to clean integers (only when new nodes were squeezed in)
  if (createdIds.length > 0) {
    const fresh = await db.skillPath.findUnique({ where: { id: path.id }, include: { nodes: true } })
    if (fresh) {
      const sorted = [...fresh.nodes].sort((a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].order !== i) {
          await db.skillNode.update({ where: { id: sorted[i].id }, data: { order: i } })
        }
      }
    }
  }
}

async function updateMatchedNode(
  m: NodeRow,
  n: RawNode,
  summary: MergeSummary,
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (n.description !== undefined) patch.description = n.description
  if (n.icon !== undefined) patch.icon = n.icon ?? '✨'
  if (n.unit !== undefined) patch.unit = n.unit?.trim() || null
  if (n.xp !== undefined) patch.xpValue = n.xp ?? 20
  patch.targetValue = n.target // required in the file — always definitional

  // progress: never lose it — the merge can only add
  const incomingCurrent = n.mastered ? n.target : Math.max(0, n.current ?? 0)
  const current = Math.max(m.currentValue, incomingCurrent)
  patch.currentValue = current
  if (current >= n.target) {
    patch.completedAt = m.completedAt ?? new Date() // keep the original clear date
  } else {
    patch.completedAt = null // the (raised) target outruns progress: back in progress
  }
  await db.skillNode.update({ where: { id: m.id }, data: patch as Prisma.SkillNodeUpdateInput })
  summary.nodesUpdated++

  // milestones: definitions follow the file, reachedAt survives matching values
  if (n.milestones !== undefined) {
    const defs = milestoneDefs(n)
    const byValue = new Map(m.milestones.map((ms) => [ms.value, ms]))
    const keep = new Set<number>()
    for (const def of defs) {
      keep.add(def.value)
      const ex = byValue.get(def.value)
      if (ex) {
        const msPatch: Record<string, unknown> = {}
        if (ex.label !== def.label) msPatch.label = def.label
        if (!ex.reachedAt && current >= def.value) msPatch.reachedAt = new Date()
        if (Object.keys(msPatch).length > 0) {
          await db.skillMilestone.update({ where: { id: ex.id }, data: msPatch as Prisma.SkillMilestoneUpdateInput })
        }
      } else {
        await db.skillMilestone.create({
          data: {
            nodeId: m.id,
            value: def.value,
            label: def.label,
            reachedAt: current >= def.value ? new Date() : null,
          },
        })
        summary.milestonesAdded++
      }
    }
    for (const ex of m.milestones) {
      if (!keep.has(ex.value)) {
        await db.skillMilestone.delete({ where: { id: ex.id } })
        summary.milestonesRemoved++
      }
    }
  }
}

/** All nodes of a goal (after merging), for ref resolution. */
async function nodeEntries(goalId: string): Promise<NodeRefEntry[]> {
  const paths = await db.skillPath.findMany({
    where: { goalId },
    include: { nodes: true },
    orderBy: { order: 'asc' },
  })
  return paths.flatMap((p) => p.nodes.map((n) => ({ id: n.id, title: n.title, pathTitle: p.title })))
}

/** Apply the derivation changes the file asked for (presence semantics like
 *  every other definition: value → set, null → clear, absent → keep). Invalid
 *  requests — unknown refs, a source that is itself derived, a missing factor —
 *  are quietly dropped, like unknown requires refs. */
async function syncDerive(
  goalId: string,
  pending: Map<string, { ref: string | null | undefined; factor: number | null | undefined }>,
  entries: NodeRefEntry[],
): Promise<void> {
  if (pending.size === 0) return
  for (const [nodeId, req] of pending) {
    const node = await db.skillNode.findUnique({ where: { id: nodeId } })
    if (!node || node.goalId !== goalId) continue

    // which source is being asked for?
    let sourceId: string | null | undefined = undefined // undefined = leave the link as-is
    if (req.ref === null) sourceId = null // explicit clear
    else if (typeof req.ref === 'string') {
      const src = resolveNodeRef(req.ref, null, entries)
      if (!src || src === nodeId) continue // unknown or self → drop quietly
      const srcRow = await db.skillNode.findUnique({ where: { id: src } })
      if (!srcRow || srcRow.goalId !== goalId) continue
      if (srcRow.deriveFromId != null) continue // a meter can't be a source — no chains
      sourceId = src
    }

    const effectiveSource = sourceId === undefined ? node.deriveFromId : sourceId
    const effectiveFactor = req.factor !== undefined ? req.factor : node.deriveFactor

    if (effectiveSource == null) {
      if (sourceId === null) {
        // the file asked to clear it
        await setNodeDerivation(goalId, nodeId, null, null)
      }
      continue
    }
    if (effectiveFactor == null || effectiveFactor <= 0) continue
    if (effectiveSource === node.deriveFromId && effectiveFactor === node.deriveFactor) continue // unchanged
    const err = await setNodeDerivation(goalId, nodeId, effectiveSource, effectiveFactor)
    if (err) continue // validation failed — drop quietly, the merge stays lenient
  }
}

/** Re-resolve gating for the nodes the file defines requires on. Existing
 *  edges (from nodes the file doesn't mention) are locked in first, so new
 *  edges that would close a cycle are the ones dropped. */
async function syncRequires(
  goalId: string,
  fileRequires: Map<string, string[]>,
  existingRequires: Map<string, string[]>,
  entries: NodeRefEntry[],
): Promise<void> {
  if (fileRequires.size === 0) return
  void goalId

  const edges: { from: string; to: string }[] = []
  const seen = new Set<string>()
  const add = (from: string, to: string) => {
    const key = `${from}->${to}`
    if (from !== to && !seen.has(key)) {
      seen.add(key)
      edges.push({ from, to })
    }
  }
  // locked-in existing edges first
  for (const [nodeId, ids] of existingRequires) {
    if (fileRequires.has(nodeId)) continue // replaced by the file's definition
    for (const id of ids) add(id, nodeId)
  }
  // then the file's edges (refs may point at kept, updated or new nodes)
  const pathOf = new Map(entries.map((e) => [e.id, e.pathTitle]))
  for (const [nodeId, refs] of fileRequires) {
    for (const ref of refs) {
      const dep = resolveNodeRef(ref, pathOf.get(nodeId) ?? null, entries)
      if (dep) add(dep, nodeId)
    }
  }

  const accepted = filterCyclicEdges(edges)
  const byTo = new Map<string, string[]>()
  for (const e of accepted) {
    const list = byTo.get(e.to)
    if (list) list.push(e.from)
    else byTo.set(e.to, [e.from])
  }
  for (const nodeId of fileRequires.keys()) {
    await db.skillNode.update({ where: { id: nodeId }, data: { requiresIds: idsCsv(byTo.get(nodeId) ?? []) } })
  }
}

async function mergeRoutines(
  goal: GoalRow,
  routines: ImportGoalRaw['routines'],
  entries: NodeRefEntry[],
  summary: MergeSummary,
): Promise<void> {
  if (!routines?.length) return
  const byTitle = new Map<string, RoutineRow>()
  for (const r of goal.routines) {
    const key = normTitle(r.title)
    if (!byTitle.has(key)) byTitle.set(key, r)
  }

  for (const r of routines as RawRoutine[]) {
    const m = byTitle.get(normTitle(r.title))
    if (m) {
      const patch: Record<string, unknown> = {}

      if (r.notes !== undefined) patch.notes = r.notes
      if (r.durationMin !== undefined) patch.durationMin = r.durationMin
      // extra credit: nice to do, never a penalty when skipped
      if ((r as RawRoutine).optional !== undefined) patch.optional = (r as RawRoutine).optional === true

      // cadence: presence-aware, falling back to the existing values
      const cadenceInput =
        r.cadence !== undefined || r.weekdays !== undefined || r.everyDays !== undefined || r.timesPerWeek !== undefined
      if (cadenceInput) {
        let cadence: string =
          r.cadence ??
          (r.timesPerWeek != null
            ? 'flexible'
            : r.everyDays != null
              ? 'interval'
              : r.weekdays != null
                ? 'weekly'
                : m.cadence)
        if (cadence === 'flexible' && r.timesPerWeek == null && m.cadence !== 'flexible') {
          cadence = r.everyDays != null ? 'interval' : 'weekly'
        }
        patch.cadence = cadence
        if (cadence === 'weekly') {
          let days: number[]
          if (r.weekdays != null) {
            days = [...new Set(r.weekdays.map(weekdayToNumber).filter((x): x is number => x !== null))].sort((a, b) => a - b)
          } else if (m.cadence === 'weekly' && m.weekdays) {
            days = m.weekdays.split(',').map(Number).sort((a, b) => a - b)
          } else {
            days = [1]
          }
          patch.weekdays = (days.length ? days : [1]).join(',')
          patch.everyNDays = null
          patch.timesPerWeek = null
        } else if (cadence === 'interval') {
          patch.everyNDays = r.everyDays ?? (m.cadence === 'interval' ? m.everyNDays : null) ?? 2
          patch.weekdays = null
          patch.timesPerWeek = null
        } else {
          // flexible
          patch.timesPerWeek = r.timesPerWeek ?? (m.cadence === 'flexible' ? m.timesPerWeek : null) ?? 2
          patch.weekdays = null
          patch.everyNDays = null
        }
      }

      // which checkpoint this session advances
      if (r.node !== undefined) {
        const nodeId = r.node ? resolveNodeRef(r.node, null, entries) : null
        patch.nodeId = nodeId
        patch.credit = nodeId ? (r.credit !== undefined ? r.credit : m.credit) : null
      } else if (r.credit !== undefined) {
        patch.credit = m.nodeId ? r.credit : null
      }

      if (r.startDate !== undefined) patch.startDate = isoFromFlexibleDate(r.startDate) ?? m.startDate
      if (r.endDate !== undefined) patch.endDate = isoFromFlexibleDate(r.endDate) // null clears = repeat forever

      if (Object.keys(patch).length > 0) {
        await db.routineItem.update({ where: { id: m.id }, data: patch as Prisma.RoutineItemUpdateInput })
      }
      summary.routinesUpdated++

      // check-off history: union of days, never shrunk
      if (r.dones?.length) {
        const existingDays = new Set(m.dones.map((d) => dayKey(d.date)))
        const fresh = new Set<string>()
        for (const d of r.dones) {
          const iso = isoFromFlexibleDate(d)
          const day = iso ? iso.slice(0, 10) : null
          if (day && !existingDays.has(day)) fresh.add(day)
        }
        if (fresh.size > 0) {
          await db.routineDone.createMany({
            data: [...fresh].map((day) => ({ routineId: m.id, date: canonicalDayUtc(day) })),
          })
          summary.donesAdded += fresh.size
        }
      }
    } else {
      // brand-new routine: create-mode semantics
      const [nr] = normalizeGoal({ title: 'scope', routines: [r] }).routines
      const nodeId = nr.nodeRef ? resolveNodeRef(nr.nodeRef, null, entries) : null
      const created = await db.routineItem.create({
        data: {
          goalId: goal.id,
          title: nr.title,
          notes: nr.notes,
          cadence: nr.cadence,
          everyNDays: nr.everyNDays,
          weekdays: nr.weekdays ? [...nr.weekdays].sort((a, b) => a - b).join(',') : null,
          timesPerWeek: nr.timesPerWeek,
          nodeId,
          credit: nodeId ? nr.credit : null,
          durationMin: nr.durationMin,
          startDate: nr.startDate ? new Date(nr.startDate) : new Date(),
          endDate: nr.endDate ? new Date(nr.endDate) : null,
          optional: nr.optional,
        },
      })
      if (nr.doneDates.length) {
        const seenDays = new Set<string>()
        const rows = nr.doneDates
          .map((d) => d.slice(0, 10))
          .filter((day) => {
            if (seenDays.has(day)) return false
            seenDays.add(day)
            return true
          })
          .map((day) => ({ routineId: created.id, date: canonicalDayUtc(day) }))
        if (rows.length) {
          await db.routineDone.createMany({ data: rows })
          summary.donesAdded += rows.length
        }
      }
      summary.routinesCreated++
    }
  }
}

async function mergePbs(goal: GoalRow, pbs: ImportGoalRaw['pbs'], summary: MergeSummary): Promise<void> {
  if (!pbs?.length) return
  const byName = new Map(goal.pbs.map((pb) => [normTitle(pb.name), pb]))

  for (const pb of pbs) {
    const m = byName.get(normTitle(pb.name))
    if (m) {
      const patch: Record<string, unknown> = {}
      if (pb.unit !== undefined) patch.unit = pb.unit?.trim() || null
      if (pb.direction !== undefined) patch.direction = pb.direction ?? 'up'
      if (Object.keys(patch).length > 0) {
        await db.personalBest.update({ where: { id: m.id }, data: patch as Prisma.PersonalBestUpdateInput })
      }
      summary.pbsUpdated++

      // attempts: appended, deduped by day + value (idempotent re-imports)
      if (pb.records?.length) {
        let history: { id: string; date: string; value: number; note: string | null }[] = []
        try {
          const parsed = JSON.parse(m.history)
          if (Array.isArray(parsed)) history = parsed
        } catch {
          history = []
        }
        const seen = new Set(history.map((r) => `${dayKey(r.date)}|${r.value}`))
        const added: { id: string; date: string; value: number; note: string | null }[] = []
        for (const rec of pb.records) {
          const date = isoFromDaysAgoOrDate(rec.daysAgo, rec.date)
          const key = `${date.slice(0, 10)}|${rec.value}`
          if (seen.has(key)) continue
          seen.add(key)
          added.push({ id: randomUUID(), date, value: rec.value, note: rec.note ?? null })
        }
        if (added.length) {
          await db.personalBest.update({
            where: { id: m.id },
            data: { history: JSON.stringify([...history, ...added]) },
          })
          summary.recordsAdded += added.length
        }
      }
    } else {
      // brand-new metric: create-mode semantics (needs at least one record)
      if (!pb.records?.length) continue
      const [np] = normalizeGoal({ title: 'scope', pbs: [pb] }).pbs
      await db.personalBest.create({
        data: {
          goalId: goal.id,
          name: np.name,
          unit: np.unit,
          direction: np.direction,
          history: JSON.stringify(
            np.records.map((r) => ({ id: randomUUID(), date: r.date, value: r.value, note: r.note })),
          ),
        },
      })
      summary.pbsCreated++
    }
  }
}

async function mergeLogs(goal: GoalRow, logs: ImportGoalRaw['logs'], summary: MergeSummary): Promise<void> {
  if (!logs?.length) return
  const nls = normalizeGoal({ title: 'scope', logs }).logs
  const seen = new Set(goal.logs.map((l) => `${dayKey(l.date)}|${l.amount}|${l.note ?? ''}`))
  const fresh = nls.filter((l) => {
    const key = `${l.date.slice(0, 10)}|${l.amount}|${l.note ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (fresh.length) {
    await db.progressLog.createMany({
      data: fresh.map((l) => ({ goalId: goal.id, amount: l.amount, note: l.note, date: new Date(l.date), unit: l.unit ?? null })),
    })
    summary.logsAdded += fresh.length
  }
}

async function mergeNotes(goal: GoalRow, notes: ImportGoalRaw['notes'], summary: MergeSummary): Promise<void> {
  if (!notes?.length) return
  const existing = new Set(goal.notes.map((n) => n.content))
  const fresh: string[] = []
  for (const n of notes) {
    const content = n.trim()
    if (content && !existing.has(content)) {
      existing.add(content)
      fresh.push(content)
    }
  }
  if (fresh.length) {
    await db.goalNote.createMany({ data: fresh.map((content) => ({ goalId: goal.id, content })) })
    summary.notesAdded += fresh.length
  }
}
