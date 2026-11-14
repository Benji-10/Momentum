import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { serializeGoal } from '@/lib/goal-serialize'
import { applyPbNodeCredit, resyncPbMirror, type PbNodeEffect } from '@/lib/pb-credit'

const createPbSchema = z.object({
  name: z.string().min(1, 'Name is required').max(60),
  unit: z.string().max(30).nullable().optional(),
  /** "up" = higher is better (WPM) · "down" = lower is better (BLD time) */
  direction: z.enum(['up', 'down']).optional(),
  /** optional first record — your current best */
  firstValue: z.number().positive().max(1_000_000).nullable().optional(),
  firstDate: z.string().datetime().nullable().optional(),
  // ---- roadmap link: feed a skill checkpoint from this metric ----
  /** the checkpoint this metric feeds (null/omitted = none) */
  nodeId: z.string().min(1).max(64).nullable().optional(),
  /** "sum" = every attempt adds its value · "average" = the checkpoint
   *  mirrors the rolling average of the last nodeWindow attempts */
  nodeMode: z.enum(['sum', 'average']).nullable().optional(),
  nodeWindow: z.number().int().min(1).max(50).nullable().optional(),
})

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/goals/[id]/pbs — create a personal-best metric on a goal,
 * e.g. name "WPM" unit "wpm" direction up, or "BLD" unit "s" direction down.
 * A linked checkpoint (nodeId) turns the metric into a roadmap feeder: sum
 * mode credits the first record right away, average mode mirrors the
 * current average immediately.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = createPbSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid PB data' }, { status: 400 })
    }
    if (!(await ownsGoal(id, auth.user))) {
      return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    }

    const d = parsed.data
    const name = d.name.trim()
    const existing = await db.personalBest.findFirst({ where: { goalId: id, name } })
    if (existing) {
      return NextResponse.json({ error: `You already track "${name}" on this goal` }, { status: 409 })
    }

    const direction = d.direction ?? 'up'

    // roadmap link: the checkpoint must belong to this goal; the average
    // mirror only makes sense for "up" metrics (checkpoints master at >=)
    let nodeId: string | null = null
    if (d.nodeId) {
      const node = await db.skillNode.findFirst({ where: { id: d.nodeId, goalId: id }, select: { id: true } })
      if (!node) return NextResponse.json({ error: 'Linked checkpoint not found' }, { status: 400 })
      nodeId = node.id
    }
    const nodeMode = nodeId ? d.nodeMode ?? 'sum' : null
    if (nodeMode === 'average' && direction === 'down') {
      return NextResponse.json(
        { error: 'Average tracking needs a higher-is-better metric — link it as "every attempt adds" instead' },
        { status: 400 },
      )
    }

    const firstRecordId = randomUUID()
    const history =
      d.firstValue != null && d.firstValue > 0
        ? JSON.stringify([
            { id: firstRecordId, date: d.firstDate ?? new Date().toISOString(), value: d.firstValue, note: null },
          ])
        : '[]'

    const created = await db.personalBest.create({
      data: {
        goalId: id,
        name,
        unit: d.unit?.trim() || null,
        direction,
        history,
        nodeId,
        nodeMode,
        nodeWindow: nodeId ? d.nodeWindow ?? null : null,
      },
    })

    // the first record feeds the checkpoint like any later attempt
    let nodeCredit: PbNodeEffect | null = null
    if (nodeId) {
      const row = { ...created, history }
      nodeCredit =
        d.firstValue != null && d.firstValue > 0
          ? await applyPbNodeCredit(id, row, { kind: 'add', recordId: firstRecordId })
          : nodeMode === 'average'
            ? await resyncPbMirror(id, row)
            : null
    }

    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null, nodeCredit }, { status: 201 })
  } catch (e) {
    console.error('POST /api/goals/[id]/pbs failed', e)
    return NextResponse.json({ error: 'Failed to create PB metric' }, { status: 500 })
  }
}
