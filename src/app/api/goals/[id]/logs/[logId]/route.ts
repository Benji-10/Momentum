import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { serializeGoal } from '@/lib/goal-serialize'
import { syncMilestoneReached } from '@/lib/milestones'
import { propagateDerived } from '@/lib/derive'

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

/** PATCH /api/goals/[id]/logs/[logId] — fix up an entry after the fact
 *  (e.g. the routine said 2 hours but you only worked 50 minutes, or the
 *  session actually happened on Tuesday).
 *
 *  When the entry is the auto-log of a linked-routine check-off, its amount
 *  is progress in the checkpoint's unit ("words"): editing 10 → 25 advances
 *  the checkpoint by exactly the difference, and undoing the check-off
 *  takes the edited amount back out. */
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

    // a changed amount on a linked check-off's log moves the checkpoint by
    // the difference (creditedValue is the amount this session contributed)
    const newAmount = parsed.data.amount
    if (newAmount != null && Math.abs(newAmount - log.amount) > 1e-9) {
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

/** DELETE /api/goals/[id]/logs/[logId] — remove an entry. When it was a
 *  linked check-off's auto-log, the progress it credited to the checkpoint
 *  is taken back out (the session itself stays checked off). */
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
    }

    await db.progressLog.delete({ where: { id: logId } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE /api/goals/[id]/logs/[logId] failed', e)
    return NextResponse.json({ error: 'Failed to delete log' }, { status: 500 })
  }
}
