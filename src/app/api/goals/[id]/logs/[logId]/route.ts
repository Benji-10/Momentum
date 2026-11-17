import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { serializeGoal } from '@/lib/goal-serialize'
import { syncMilestoneReached } from '@/lib/milestones'
import { propagateDerived } from '@/lib/derive'
import { applyPbNodeCredit } from '@/lib/pb-credit'
import { evaluateStepTriggers } from '@/lib/step-engine'

const patchSchema = z.object({
  amount: z.number().positive('Amount must be greater than 0').max(1_000_000).optional(),
  note: z.string().max(500).nullable().optional(),
  /** move the entry to another day (ISO instant, app-tz aware on the client) */
  date: z.string().datetime().optional(),
})

type Params = { params: Promise<{ id: string; logId: string }> }

/**
 * The node bookkeeping shared by PATCH and DELETE: move a linked
 * checkpoint's progress by `delta` (clamped to 0..target), keep its
 * mastered flag, milestones and derived checkpoints in sync, and record
 * what this check-off now contributes in the done mark's creditedValue.
 */
async function applyNodeDelta(
  goalId: string,
  nodeId: string,
  delta: number,
): Promise<number> {
  const node = await db.skillNode.findUnique({ where: { id: nodeId } })
  if (!node) return 0
  const cap = node.targetValue > 0 ? node.targetValue : Number.MAX_SAFE_INTEGER
  const next = Math.min(cap, Math.max(0, Math.round((node.currentValue + delta) * 100) / 100))
  const applied = Math.round((next - node.currentValue) * 100) / 100
  if (applied === 0) return 0
  const masteredNow = next >= node.targetValue && node.targetValue > 0
  await db.skillNode.update({
    where: { id: node.id },
    data: { currentValue: next, completedAt: masteredNow ? (node.completedAt ?? new Date()) : null },
  })
  await syncMilestoneReached(node.id, next)
  // derived checkpoints convert their share of the change too
  await propagateDerived(goalId, node.id, applied)
  return applied
}

/** Mirror maintenance for metric attempts: the record this log row mirrors
 *  lives in the PB's history JSON under the SAME id. Updating it means:
 *  rewrite the record (value/note/date), re-run the checkpoint credit with
 *  the exact previous contribution, and re-derive metric-triggered steps —
 *  exactly what the metric-side PATCH does, so both surfaces stay in sync. */
async function syncMirroredRecord(
  goalId: string,
  pbId: string,
  recordId: string,
  patch: { value?: number; note?: string | null; date?: string },
): Promise<void> {
  const pb = await db.personalBest.findFirst({ where: { id: pbId, goalId } })
  if (!pb) return
  let history: unknown[] = []
  try {
    const parsed = JSON.parse(pb.history)
    if (Array.isArray(parsed)) history = parsed
  } catch {
    history = []
  }
  const idx = history.findIndex(
    (r) => typeof r === 'object' && r !== null && (r as { id?: unknown }).id === recordId,
  )
  if (idx === -1) return
  const prev = history[idx] as {
    id: string
    date: string
    value: number
    note?: string | null
    creditedValue?: number | null
  }
  history[idx] = {
    id: prev.id,
    date: patch.date ?? prev.date,
    value: patch.value ?? prev.value,
    note: patch.note !== undefined ? patch.note : (prev.note ?? null),
  }
  const historyJson = JSON.stringify(history)
  await db.personalBest.update({ where: { id: pb.id }, data: { history: historyJson } })
  await applyPbNodeCredit(
    goalId,
    { ...pb, history: historyJson },
    {
      kind: 'edit',
      recordId,
      prev: {
        value: prev.value,
        creditedValue: typeof prev.creditedValue === 'number' ? prev.creditedValue : null,
      },
    },
  )
  await evaluateStepTriggers(goalId)
}

/** Remove the PB record a log row mirrors (log-side delete of an attempt):
 *  history entry out, credited share back, steps re-derived. */
async function removeMirroredRecord(goalId: string, pbId: string, recordId: string): Promise<void> {
  const pb = await db.personalBest.findFirst({ where: { id: pbId, goalId } })
  if (!pb) return
  let history: unknown[] = []
  try {
    const parsed = JSON.parse(pb.history)
    if (Array.isArray(parsed)) history = parsed
  } catch {
    history = []
  }
  const removed = history.find(
    (r): r is Record<string, unknown> =>
      typeof r === 'object' && r !== null && (r as { id?: unknown }).id === recordId,
  )
  const next = history.filter(
    (r) => !(typeof r === 'object' && r !== null && (r as { id?: unknown }).id === recordId),
  )
  if (next.length === history.length) return
  const historyJson = JSON.stringify(next)
  await db.personalBest.update({ where: { id: pb.id }, data: { history: historyJson } })
  await applyPbNodeCredit(goalId, { ...pb, history: historyJson }, {
    kind: 'remove',
    prev: {
      value: typeof removed?.value === 'number' ? removed.value : 0,
      creditedValue: typeof removed?.creditedValue === 'number' ? removed.creditedValue : null,
    },
  })
  await evaluateStepTriggers(goalId)
}

/** PATCH /api/goals/[id]/logs/[logId] — fix up an entry after the fact
 *  (e.g. the routine said 2 hours but you only worked 50 minutes, or the
 *  session actually happened on Tuesday).
 *
 *  Two kinds of entries carry checkpoint bookkeeping, and both adjust by
 *  exactly the difference when the amount changes:
 *  - the auto-log of a linked-routine check-off (RoutineDone.creditedValue),
 *  - a direct checkpoint credit ("counts toward 📗 Pages" / skill-map quick
 *    adds — ProgressLog.creditedValue). Undoing (delete) takes the credited
 *    amount back out either way. */
export async function PATCH(req: Request, { params }: Params) {
  const { id, logId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid log data' }, { status: 400 })
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const log = await db.progressLog.findFirst({ where: { id: logId, goalId: id } })
    if (!log) return NextResponse.json({ error: 'Log not found' }, { status: 404 })

    // a changed amount moves the linked checkpoint by the difference
    // (creditedValue is the amount this entry contributed) — both for
    // check-off auto-logs and direct "counts toward" credits
    const newAmount = parsed.data.amount
    if (log.pbId) {
      // a metric attempt mirrored into the ledger — the edit flows back into
      // the metric's history (value/day/note) and everything it feeds
      await syncMirroredRecord(id, log.pbId, logId, {
        ...(newAmount != null ? { value: newAmount } : {}),
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
        ...(parsed.data.date ? { date: parsed.data.date } : {}),
      })
    } else if (newAmount != null && Math.abs(newAmount - log.amount) > 1e-9) {
      const done = await db.routineDone.findFirst({
        where: { logId },
        include: { routine: { select: { nodeId: true } } },
      })
      if (done?.routine.nodeId && done.creditedValue != null) {
        const delta = newAmount - done.creditedValue
        if (Math.abs(delta) > 1e-9) {
          const applied = await applyNodeDelta(id, done.routine.nodeId, delta)
          await db.routineDone.update({
            where: { id: done.id },
            data: { creditedValue: done.creditedValue + applied },
          })
        }
      } else if (log.nodeId && log.creditedValue != null) {
        // direct checkpoint credit — same exact-difference bookkeeping
        const delta = newAmount - log.creditedValue
        if (Math.abs(delta) > 1e-9) {
          const applied = await applyNodeDelta(id, log.nodeId, delta)
          await db.progressLog.update({
            where: { id: logId },
            data: { creditedValue: log.creditedValue + applied },
          })
        }
      }
    }

    const { date, ...rest } = parsed.data
    await db.progressLog.update({
      where: { id: logId },
      data: { ...rest, ...(date ? { date: new Date(date) } : {}) },
    })
    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('PATCH /api/goals/[id]/logs/[logId] failed', e)
    return NextResponse.json({ error: 'Failed to update log' }, { status: 500 })
  }
}

/** DELETE /api/goals/[id]/logs/[logId] — remove an entry. When it carried
 *  checkpoint credit (a linked check-off's auto-log, or a direct "counts
 *  toward" entry), the progress it credited is taken back out (the session
 *  itself stays checked off in the routine case). */
export async function DELETE(_req: Request, { params }: Params) {
  const { id, logId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const log = await db.progressLog.findFirst({ where: { id: logId, goalId: id } })
    if (!log) return NextResponse.json({ error: 'Log not found' }, { status: 404 })

    const done = await db.routineDone.findFirst({
      where: { logId },
      include: { routine: { select: { nodeId: true } } },
    })
    if (done) {
      if (done.routine.nodeId && done.creditedValue != null && done.creditedValue > 0) {
        await applyNodeDelta(id, done.routine.nodeId, -done.creditedValue)
      }
      // the session stays done — it just no longer contributes progress
      await db.routineDone.update({ where: { id: done.id }, data: { logId: null, creditedValue: null } })
    } else if (log.pbId) {
      // deleting a mirrored attempt from the Log tab removes the metric
      // record too — one attempt, one entry, wherever you delete it from
      await removeMirroredRecord(id, log.pbId, logId)
    } else if (log.nodeId && log.creditedValue != null && log.creditedValue > 0) {
      // direct checkpoint credit — give the progress back
      await applyNodeDelta(id, log.nodeId, -log.creditedValue)
    }

    await db.progressLog.delete({ where: { id: logId } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE /api/goals/[id]/logs/[logId] failed', e)
    return NextResponse.json({ error: 'Failed to delete log' }, { status: 500 })
  }
}
