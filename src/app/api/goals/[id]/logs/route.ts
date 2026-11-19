import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'
import { syncMilestoneReached } from '@/lib/milestones'
import { propagateDerived } from '@/lib/derive'
import { nodeStatus } from '@/lib/skill-tree'
import { nodeUnlockedById } from '@/lib/pb-credit'
import { sameUnitFamily } from '@/lib/units'

const createLogSchema = z.object({
  amount: z.number().positive('Amount must be greater than 0').max(1_000_000),
  note: z.string().max(500).nullable().optional(),
  /** ISO date, optional — defaults to now */
  date: z.string().datetime().optional(),
  /** Unit the amount was recorded in, when it differs from the goal's own
   *  (an import carrying "20 min" entries, or a manual entry in one of the
   *  goal's other units). Entries in the goal's own unit (or a matching
   * family, "h" ≙ "hours") are normalized to null — that's what no unit
   * means. Foreign-unit entries are real, editable history that never
   * inflates the goal's own sums (see lib/units.ts). When `nodeId` credits
   * a checkpoint, the server overrides this with the checkpoint's unit. */
  unit: z.string().max(30).nullable().optional(),
  /** Credit this skill checkpoint with the amount ("counts toward 📗
   *  Pages") — on any goal type. The entry becomes real, editable history:
   *  amount edits and deletes adjust the checkpoint by exactly the
   *  difference (creditedValue bookkeeping, like check-offs). When the
   *  checkpoint's unit differs from the goal's own, the entry is history
   *  for the goal and progress for the tree. */
  nodeId: z.string().max(64).nullable().optional(),
  /** optional client-generated id — lets the optimistic UI edit/delete an
   *  entry before this create lands (see the steps route for the full story) */
  id: z.string().min(6).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/).optional(),
})

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = createLogSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid log data' }, { status: 400 })
    }
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const goalRow = await db.goal.findFirst({
      where: { id, userId: auth.user.id },
      select: { id: true, type: true, unit: true },
    })
    if (!goalRow) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

    const d = parsed.data
    // a manual unit in the goal's own family is just "the goal's unit" —
    // store it clean (null) so the ledger membership rule stays simple
    let unit =
      d.unit?.trim() && !sameUnitFamily(d.unit, goalRow.unit) ? d.unit.trim() : null
    let nodeId: string | null = null
    let creditedValue: number | null = null

    if (d.nodeId) {
      // checkpoint-crediting entries work on every goal type: the checkpoint
      // is the real ledger for its unit, and when that unit differs from the
      // goal's own the entry simply doesn't count toward the goal's sums
      const node = await db.skillNode.findFirst({
        where: { id: d.nodeId, goalId: id },
        include: { path: { select: { unit: true } } },
      })
      if (!node) return NextResponse.json({ error: 'Checkpoint not found' }, { status: 404 })
      if (node.deriveFromId) {
        return NextResponse.json(
          { error: `“${node.title}” auto-converts from its source checkpoint — log the source instead.` },
          { status: 400 },
        )
      }
      if (nodeStatus(node) === 'mastered') {
        return NextResponse.json({ error: `“${node.title}” is already mastered.` }, { status: 400 })
      }
      if (!(await nodeUnlockedById(node.id))) {
        return NextResponse.json({ error: `“${node.title}” is still locked.` }, { status: 400 })
      }

      // the unit is the checkpoint's, server-authoritative — history never lies
      unit = node.unit ?? node.path.unit ?? null

      // credit (clamped by the target — the log keeps the user's full amount)
      const cap = node.targetValue > 0 ? node.targetValue : Number.MAX_SAFE_INTEGER
      const next = Math.min(cap, Math.max(0, Math.round((node.currentValue + d.amount) * 100) / 100))
      const applied = Math.round((next - node.currentValue) * 100) / 100
      if (applied !== 0) {
        const masteredNow = next >= node.targetValue && node.targetValue > 0
        await db.skillNode.update({
          where: { id: node.id },
          data: { currentValue: next, completedAt: masteredNow ? (node.completedAt ?? new Date()) : null },
        })
        await syncMilestoneReached(node.id, next)
        // derived checkpoints convert their share of the change too
        await propagateDerived(id, node.id, applied)
      }
      nodeId = node.id
      creditedValue = applied
    }

    const log = await db.progressLog.create({
      data: {
        ...(d.id ? { id: d.id } : {}),
        goalId: id,
        amount: d.amount,
        note: d.note ?? null,
        unit,
        nodeId,
        creditedValue,
        date: d.date ? new Date(d.date) : new Date(),
      },
    })
    const goal = await db.goal.findUnique({ where: { id }, include: goalInclude })
    return NextResponse.json(
      {
        log: { id: log.id, amount: log.amount, unit: log.unit, note: log.note, nodeId: log.nodeId, creditedValue: log.creditedValue },
        goal: goal ? serializeGoal(goal) : null,
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/goals/[id]/logs failed', e)
    return NextResponse.json({ error: 'Failed to log progress' }, { status: 500 })
  }
}
