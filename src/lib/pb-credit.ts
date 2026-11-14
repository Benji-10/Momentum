import { db } from './db'
import { syncMilestoneReached } from './milestones'
import { propagateDerived } from './derive'
import { buildNodeIndex, nodeDependencies, nodeStatus } from './skill-tree'

// ---------------------------------------------------------------------------
// PB → roadmap checkpoint crediting.
//
// A personal-best metric can FEED a skill checkpoint (PersonalBest.nodeId):
//
//   nodeMode "sum"      every logged attempt adds its value to the checkpoint
//                       ("25 new words" → Vocabulary +25). Edits adjust by the
//                       difference, deletes take exactly the credited share
//                       back out. Each record stores how much it actually
//                       contributed (`creditedValue` in the history JSON), so
//                       pre-link attempts never count and undo stays exact.
//   nodeMode "average"  the checkpoint MIRRORS the rolling average of the last
//                       `nodeWindow` attempts (typing speed climbing toward a
//                       bar). Any change recomputes the value; the checkpoint
//                       masters once the full-window average reaches the
//                       target. "up" metrics only — a checkpoint masters at
//                       currentValue >= targetValue, so a falling average
//                       could never get there.
//
// Rules shared with routine check-offs (the /done route): a locked checkpoint
// is never credited (its gates would be bypassed), an already-mastered one
// never overflows (value caps at target on the way up, floors at 0 on the way
// down), milestones re-sync, and derived checkpoints convert their share via
// propagateDerived.
//
// Unlinking keeps earned progress — exactly like unlinking a routine from a
// checkpoint. Deleting the metric takes the summed contributions back out.
// ---------------------------------------------------------------------------

export interface PbNodeEffect {
  nodeTitle: string
  nodeUnit: string | null
  mode: 'sum' | 'average'
  /** sum: the delta actually applied · average: value change (new − old) */
  delta: number
  /** the checkpoint's value after the change */
  value: number
  target: number
  /** average mode: the rolling average now shown on the checkpoint */
  average: number | null
  /** average mode: attempts behind the average / the window it needs */
  attempts: number
  window: number
  /** the checkpoint is mastered after this change */
  mastered: boolean
  /** why nothing was applied (null = the change went through) */
  skipped: 'linked-node-missing' | 'locked' | 'mastered' | 'short-window' | null
}

/** What the routes know about the record that changed. For 'add'/'edit' the
 *  PB's history JSON must ALREADY carry the NEW state; 'edit'/'remove' also
 *  pass what the record looked like before (its credited share). 'resync'
 *  recomputes an average-mode mirror without a record change. */
export type PbCreditChange =
  | { kind: 'resync' }
  | { kind: 'add'; recordId: string }
  | { kind: 'edit'; recordId: string; prev: { value: number; creditedValue: number | null } }
  | { kind: 'remove'; prev: { value: number; creditedValue: number | null } }

/** The PB columns this module needs (a Prisma PersonalBest row fits). */
export interface PbCreditRow {
  id: string
  goalId: string
  nodeId: string | null
  nodeMode: string | null
  nodeWindow: number | null
  history: string
}

interface HistoryRecord {
  id: string
  date: string
  value: number
  note?: string | null
  /** sum mode: how much this record contributed to the checkpoint (set by
   *  this module; absent = never contributed, e.g. logged before the link) */
  creditedValue?: number | null
}

function parseHistory(history: string): HistoryRecord[] {
  try {
    const parsed = JSON.parse(history)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is HistoryRecord =>
        typeof r?.id === 'string' && typeof r?.date === 'string' && typeof r?.value === 'number',
    )
  } catch {
    return []
  }
}

const round2 = (x: number) => Math.round(x * 100) / 100

/**
 * Is the node unlocked right now? (all of its dependencies mastered).
 * Shared by the routine check-off route and PB crediting so neither path can
 * bypass gating.
 */
export async function nodeUnlockedById(nodeId: string): Promise<boolean> {
  const node = await db.skillNode.findUnique({ where: { id: nodeId }, include: { path: { include: { nodes: true } } } })
  if (!node) return false
  const sorted = [...node.path.nodes].sort((a, b) => a.order - b.order)
  const index = buildNodeIndex([{ ...node.path, nodes: sorted }])
  const prev = sorted[sorted.findIndex((n) => n.id === nodeId) - 1] ?? null
  const { deps } = nodeDependencies(node, prev, index)
  return deps.every((d) => d.mastered)
}

/** Write a checkpoint's new value: mastery stamp, milestones, derived share.
 *  Returns the delta actually applied. */
async function setNodeValue(
  goalId: string,
  node: { id: string; currentValue: number; targetValue: number; completedAt: Date | null },
  next: number,
  mastered: boolean,
): Promise<number> {
  await db.skillNode.update({
    where: { id: node.id },
    data: { currentValue: next, completedAt: mastered ? (node.completedAt ?? new Date()) : null },
  })
  await syncMilestoneReached(node.id, next)
  // derived checkpoints convert their share of the change automatically
  await propagateDerived(goalId, node.id, next - node.currentValue)
  return next - node.currentValue
}

function effect(
  node: { title: string; currentValue: number; targetValue: number },
  nodeUnit: string | null,
  mode: 'sum' | 'average',
  delta: number,
  value: number,
  average: number | null,
  mastered: boolean,
  skipped: PbNodeEffect['skipped'],
  attempts = 0,
  window = 0,
): PbNodeEffect {
  return {
    nodeTitle: node.title,
    nodeUnit,
    mode,
    delta: round2(delta),
    value: round2(value),
    target: node.targetValue,
    average: average != null ? round2(average) : null,
    attempts,
    window,
    mastered,
    skipped,
  }
}

/**
 * Apply a record change (add/edit/remove/resync) to the linked checkpoint.
 * For add/edit/remove the PB's history must ALREADY reflect the change; this
 * credits the node and, in sum mode, stamps `creditedValue` on the record so
 * later edits stay exact. Returns null when the metric feeds no checkpoint.
 */
export async function applyPbNodeCredit(
  goalId: string,
  pb: PbCreditRow,
  change: PbCreditChange,
): Promise<PbNodeEffect | null> {
  if (!pb.nodeId) return null
  const node = await db.skillNode.findUnique({
    where: { id: pb.nodeId },
    include: { path: { select: { unit: true } } },
  })
  if (!node) return null // FK is SET NULL — a stale link can't credit anything
  const nodeUnit = node.unit ?? node.path.unit ?? null
  const mode: 'sum' | 'average' = pb.nodeMode === 'average' ? 'average' : 'sum'
  const records = parseHistory(pb.history)

  // ---- average mode: recompute the mirror from the (already updated) history
  if (mode === 'average') {
    const window = Math.max(1, pb.nodeWindow ?? 3)
    const sorted = [...records].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    const last = sorted.slice(-window)
    const avg = last.length ? last.reduce((s, r) => s + r.value, 0) / last.length : 0
    // the average only counts once the full window backs it — one lucky
    // attempt must not master a checkpoint (or open the gates behind it).
    // Until then the running average is reported (for toasts) but nothing
    // is written, mirroring the step trigger's "needs N attempts" rule.
    if (last.length < window) {
      return effect(node, nodeUnit, 'average', 0, node.currentValue, avg, nodeStatus(node) === 'mastered', 'short-window', last.length, window)
    }
    if (!(await nodeUnlockedById(node.id))) {
      return effect(node, nodeUnit, 'average', 0, node.currentValue, avg, nodeStatus(node) === 'mastered', 'locked', last.length, window)
    }
    const mastered = avg >= node.targetValue && node.targetValue > 0
    const applied = await setNodeValue(goalId, node, round2(avg), mastered)
    return effect(node, nodeUnit, 'average', applied, avg, avg, mastered, null, last.length, window)
  }

  // ---- sum mode: incremental credit with exact bookkeeping
  // (a resync on a sum-mode metric has nothing to mirror — credits are
  //  incremental, and resyncPbMirror never sends one here anyway)
  if (change.kind === 'resync') return null
  const record = change.kind === 'remove' ? null : records.find((r) => r.id === change.recordId) ?? null
  if (change.kind !== 'remove' && !record) {
    return effect(node, nodeUnit, mode, 0, node.currentValue, null, nodeStatus(node) === 'mastered', null)
  }
  let prevCredited: number
  if (change.kind === 'add') {
    prevCredited = 0
  } else if (change.kind === 'edit') {
    // pre-link records never contributed — editing them contributes nothing
    if (change.prev.creditedValue == null) {
      return effect(node, nodeUnit, mode, 0, node.currentValue, null, nodeStatus(node) === 'mastered', null)
    }
    prevCredited = change.prev.creditedValue
  } else {
    prevCredited = change.prev.creditedValue ?? 0
  }
  let delta: number
  if (change.kind === 'add') {
    delta = record!.value
  } else if (change.kind === 'edit') {
    delta = record!.value - prevCredited
  } else {
    delta = -prevCredited
  }
  if (delta === 0) {
    return effect(node, nodeUnit, mode, 0, node.currentValue, null, nodeStatus(node) === 'mastered', null)
  }

  // adds respect gating + mastery; take-backs (edits down, removes) always run
  if (delta > 0) {
    if (nodeStatus(node) === 'mastered') {
      return effect(node, nodeUnit, mode, 0, node.currentValue, null, true, 'mastered')
    }
    if (!(await nodeUnlockedById(node.id))) {
      return effect(node, nodeUnit, mode, 0, node.currentValue, null, nodeStatus(node) === 'mastered', 'locked')
    }
  }
  // cap at target going up (never below what it already was), floor at 0 going down
  const next =
    delta > 0
      ? Math.min(node.currentValue + delta, Math.max(node.currentValue, node.targetValue))
      : Math.max(node.currentValue + delta, 0)
  const mastered = next >= node.targetValue && node.targetValue > 0
  const applied = await setNodeValue(goalId, node, round2(next), mastered)

  // stamp the record's actual contribution so a later edit/delete is exact
  if (change.kind !== 'remove' && record) {
    record.creditedValue = round2(prevCredited + applied)
    await db.personalBest.update({ where: { id: pb.id }, data: { history: JSON.stringify(records) } })
  }
  return effect(node, nodeUnit, mode, applied, next, null, mastered, null)
}

/**
 * Recompute an average-mode mirror from scratch — called when the link is
 * established, the mode switches to "average", or the window changes, so the
 * checkpoint immediately shows where the metric stands. No-op otherwise
 * (sum mode has nothing to mirror — credits are incremental).
 */
export async function resyncPbMirror(goalId: string, pb: PbCreditRow): Promise<PbNodeEffect | null> {
  if (!pb.nodeId || pb.nodeMode !== 'average') return null
  return applyPbNodeCredit(goalId, pb, { kind: 'resync' })
}

/**
 * Deleting the metric: sum mode gives back exactly what its records
 * contributed (floor 0); average mode leaves the mirrored value standing.
 */
export async function takeBackPbSums(goalId: string, pb: PbCreditRow): Promise<void> {
  if (!pb.nodeId || pb.nodeMode !== 'sum') return
  const node = await db.skillNode.findUnique({ where: { id: pb.nodeId } })
  if (!node) return
  const records = parseHistory(pb.history)
  const credited = records.reduce((s, r) => s + (typeof r.creditedValue === 'number' ? r.creditedValue : 0), 0)
  if (credited <= 0) return
  const next = Math.max(0, node.currentValue - credited)
  const mastered = next >= node.targetValue && node.targetValue > 0
  await setNodeValue(goalId, node, next, mastered)
}
