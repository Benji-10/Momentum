import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { evaluateStepTriggers } from '@/lib/step-engine'

/** Automation fields shared by step create + update. */
const triggerFields = z.object({
  /** how the step completes: manual tick | routine check-offs | PB metric */
  trigger: z.enum(['manual', 'routine', 'metric']).optional(),
  /** routine trigger: the routine whose check-offs count (null = any) */
  routineId: z.string().min(1).nullable().optional(),
  /** routine trigger: check-offs needed (default 1) */
  triggerCount: z.number().int().min(1).max(999).optional(),
  /** metric trigger: PB metric name */
  metricName: z.string().min(1).max(60).nullable().optional(),
  /** metric trigger: rolling-average window (default 3) */
  metricWindow: z.number().int().min(1).max(50).nullable().optional(),
  /** metric trigger: "under" = avg must drop below metricValue (times),
   *  "over" = avg must rise above it (WPM, distance) */
  metricOp: z.enum(['under', 'over']).nullable().optional(),
  metricValue: z.number().positive().max(1_000_000).nullable().optional(),
})

const createStepSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
  /** insert after this step order (append by default) */
  afterOrder: z.number().int().optional(),
}).and(triggerFields)

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = createStepSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid step data' }, { status: 400 })
    }
    const goal = (await ownsGoal(id, auth.user)) ? { id } : null
    if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

    const d = parsed.data
    let order: number
    if (d.afterOrder !== undefined) {
      // insert between afterOrder and afterOrder+1: shift the ones after
      await db.goalStep.updateMany({
        where: { goalId: id, order: { gt: d.afterOrder } },
        data: { order: { increment: 1 } },
      })
      order = d.afterOrder + 1
    } else {
      const max = await db.goalStep.aggregate({
        where: { goalId: id },
        _max: { order: true },
      })
      order = (max._max.order ?? -1) + 1
    }

    // a routine link must belong to this goal — anything else silently
    // becomes "any routine" (the trigger still works, just broader)
    let routineId: string | null = null
    if (d.routineId) {
      const r = await db.routineItem.findFirst({ where: { id: d.routineId, goalId: id }, select: { id: true } })
      routineId = r?.id ?? null
    }

    const step = await db.goalStep.create({
      data: {
        goalId: id,
        title: d.title,
        notes: d.notes ?? null,
        order,
        trigger: d.trigger ?? 'manual',
        routineId: d.trigger === 'routine' ? routineId : null,
        triggerCount: d.triggerCount ?? 1,
        metricName: d.trigger === 'metric' ? (d.metricName ?? null) : null,
        metricWindow: d.trigger === 'metric' ? (d.metricWindow ?? null) : null,
        metricOp: d.trigger === 'metric' ? (d.metricOp ?? null) : null,
        metricValue: d.trigger === 'metric' ? (d.metricValue ?? null) : null,
      },
    })
    // a freshly-added step may already satisfy its trigger (e.g. a metric
    // whose average is already under the bar)
    await evaluateStepTriggers(id)
    return NextResponse.json({ step }, { status: 201 })
  } catch (e) {
    console.error('POST /api/goals/[id]/steps failed', e)
    return NextResponse.json({ error: 'Failed to add step' }, { status: 500 })
  }
}
