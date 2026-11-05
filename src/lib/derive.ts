import { db } from './db'
import { syncMilestoneReached } from './milestones'

// ---------------------------------------------------------------------------
// Derived checkpoints — "track books without doing the math".
//
// A node with deriveFromId/deriveFactor is a passive meter that converts
// another checkpoint's progress into its own unit:
//
//     "Books finished" (unit: books) ← derives from "Pages read"
//     deriveFactor 300 → every 300 pages on the source = 1 book here
//
// Whenever the SOURCE's currentValue changes by Δ (check-off credit, quick
// add, set-exact correction, mastered), every checkpoint derived from it
// moves by Δ / factor. Derived nodes ignore gating — they measure, they
// don't unlock, so nothing blocks the meter.
// ---------------------------------------------------------------------------

/** Advance every checkpoint derived from `sourceNodeId` by delta / factor.
 *  Used on every progress write: routine credit, quick add, set-exact,
 *  mastered. Deltas may be negative (corrections/undo propagate too). */
export async function propagateDerived(goalId: string, sourceNodeId: string, delta: number): Promise<void> {
  if (!Number.isFinite(delta) || delta === 0) return
  const children = await db.skillNode.findMany({
    where: { deriveFromId: sourceNodeId, goalId },
  })
  for (const child of children) {
    const factor = child.deriveFactor
    if (!factor || factor <= 0) continue
    const next = Math.max(0, Math.min(child.targetValue, child.currentValue + delta / factor))
    if (next === child.currentValue) continue
    const masteredNow = next >= child.targetValue && child.targetValue > 0
    await db.skillNode.update({
      where: { id: child.id },
      data: { currentValue: next, completedAt: masteredNow ? (child.completedAt ?? new Date()) : null },
    })
    await syncMilestoneReached(child.id, next)
  }
}

/**
 * Bring every derived meter in a goal in line with its source's *current*
 * progress: current = max(current, source.current / factor), capped at target.
 * Idempotent and order-independent — used as the final sweep of a merge import
 * (where the file may have changed sources and factors together) and safe to
 * run any time. Progress on the meter itself is never taken away.
 */
export async function resyncDerivedMeters(goalId: string): Promise<void> {
  const meters = await db.skillNode.findMany({
    where: { deriveFromId: { not: null }, goalId },
  })
  for (const node of meters) {
    if (!node.deriveFromId || !node.deriveFactor || node.deriveFactor <= 0) continue
    const source = await db.skillNode.findFirst({ where: { id: node.deriveFromId, goalId } })
    if (!source) continue
    const next = Math.max(0, Math.min(node.targetValue, Math.max(node.currentValue, source.currentValue / node.deriveFactor)))
    if (next === node.currentValue) continue
    const masteredNow = next >= node.targetValue && node.targetValue > 0
    await db.skillNode.update({
      where: { id: node.id },
      data: { currentValue: next, completedAt: masteredNow ? (node.completedAt ?? new Date()) : null },
    })
    await syncMilestoneReached(node.id, next)
  }
}

/**
 * (Re)define — or clear — a node's derivation. After changing source/factor
 * the meter is re-synced so it reflects the source's progress so far, but
 * only ever upward: existing progress on the meter itself is never taken
 * away (the same rule the merge importer uses).
 *
 * Returns an error string when the request is invalid (source missing, not
 * in this goal, is itself derived, self-reference, factor <= 0) — one level
 * of derivation only, so chains can't loop.
 */
export async function setNodeDerivation(
  goalId: string,
  nodeId: string,
  deriveFromId: string | null,
  deriveFactor: number | null,
): Promise<string | null> {
  const node = await db.skillNode.findFirst({ where: { id: nodeId, goalId } })
  if (!node) return 'Checkpoint not found'
  if (deriveFromId == null) {
    // clear the link (the factor goes with it) — keeping any progress earned
    if (node.deriveFromId != null) {
      await db.skillNode.update({ where: { id: node.id }, data: { deriveFromId: null, deriveFactor: null } })
    }
    return null
  }
  if (deriveFromId === nodeId) return 'A checkpoint can’t derive from itself'
  if (deriveFactor == null || deriveFactor <= 0) return 'Enter how many source units make 1 of these'
  const source = await db.skillNode.findFirst({ where: { id: deriveFromId, goalId } })
  if (!source) return 'Source checkpoint not found in this goal'
  if (source.deriveFromId != null) {
    return 'That checkpoint is itself auto-derived — derive from its source instead'
  }
  if (source.deriveFromId == null) {
    await db.skillNode.update({
      where: { id: node.id },
      data: { deriveFromId: source.id, deriveFactor },
    })
    // re-sync the meter upward from the source's progress so far
    const next = Math.max(
      0,
      Math.min(node.targetValue, Math.max(node.currentValue, source.currentValue / deriveFactor)),
    )
    if (next !== node.currentValue) {
      const masteredNow = next >= node.targetValue && node.targetValue > 0
      await db.skillNode.update({
        where: { id: node.id },
        data: { currentValue: next, completedAt: masteredNow ? (node.completedAt ?? new Date()) : null },
      })
      await syncMilestoneReached(node.id, next)
    }
  }
  return null
}
