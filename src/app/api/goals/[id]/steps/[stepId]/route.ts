import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'
import { evaluateStepTriggers } from '@/lib/step-engine'

const updateStepSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'done']).optional(),
  /** target date: undefined = keep · null = clear · ISO = set */
  dueDate: z.string().datetime().nullable().optional(),
  /** move step up/down by one position */
  move: z.enum(['up', 'down']).optional(),
  // ---- automation (how this step completes) ----
  trigger: z.enum(['manual', 'routine', 'metric']).optional(),
  /** routine trigger: the routine whose check-offs count (null = any) */
  routineId: z.string().min(1).nullable().optional(),
  /** routine trigger: check-offs needed */
  triggerCount: z.number().int().min(1).max(999).optional(),
  /** metric trigger: PB metric name */
  metricName: z.string().min(1).max(60).nullable().optional(),
  /** metric trigger: rolling-average window */
  metricWindow: z.number().int().min(1).max(50).nullable().optional(),
  /** metric trigger: threshold direction */
  metricOp: z.enum(['under', 'over']).nullable().optional(),
  /** metric trigger: the threshold value */
  metricValue: z.number().positive().max(1_000_000).nullable().optional(),
})

type Params = { params: Promise<{ id: string; stepId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { id, stepId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = updateStepSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid step update' }, { status: 400 })
    }
    const d = parsed.data

    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const step = await db.goalStep.findFirst({ where: { id: stepId, goalId: id } })
    if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 })

    // handle reordering
    if (d.move) {
      const siblings = await db.goalStep.findMany({ where: { goalId: id }, orderBy: { order: 'asc' } })
      const idx = siblings.findIndex((s) => s.id === stepId)
      const swapWith = d.move === 'up' ? idx - 1 : idx + 1
      if (swapWith >= 0 && swapWith < siblings.length) {
        const other = siblings[swapWith]
        await db.$transaction([
          db.goalStep.update({ where: { id: step.id }, data: { order: other.order } }),
          db.goalStep.update({ where: { id: other.id }, data: { order: step.order } }),
        ])
      }
    }

    const statusChanged = d.status && d.status !== step.status

    // automation patch: a trigger change may complete the step right away
    // (e.g. switching to a metric whose average is already past the bar).
    // `routineId`/`metric*` fields follow null-clears like every other
    // patch; when the trigger switches to a different kind the fields of
    // the other kind are cleared so nothing stale survives.
    const trigger = d.trigger ?? (step.trigger as string)
    let routineId: string | null = step.routineId
    if (d.routineId !== undefined) routineId = d.routineId
    if (d.routineId && routineId) {
      // must belong to this goal — anything else becomes "any routine"
      const r = await db.routineItem.findFirst({ where: { id: routineId, goalId: id }, select: { id: true } })
      routineId = r?.id ?? null
    }

    const data: Record<string, unknown> = {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.notes !== undefined ? { notes: d.notes } : {}),
      ...(d.dueDate !== undefined ? { dueDate: d.dueDate ? new Date(d.dueDate) : null } : {}),
      ...(d.status !== undefined
        ? {
            status: d.status,
            completedAt: d.status === 'done' ? (statusChanged ? new Date() : step.completedAt) : null,
          }
        : {}),
    }
    if (d.trigger !== undefined) data.trigger = d.trigger
    if (d.triggerCount !== undefined) data.triggerCount = d.triggerCount
    if (d.routineId !== undefined) data.routineId = routineId
    if (d.metricName !== undefined) data.metricName = d.metricName
    if (d.metricWindow !== undefined) data.metricWindow = d.metricWindow
    if (d.metricOp !== undefined) data.metricOp = d.metricOp
    if (d.metricValue !== undefined) data.metricValue = d.metricValue
    // switching kinds clears the other kind's fields
    if (d.trigger === 'routine') {
      data.metricName = null
      data.metricWindow = null
      data.metricOp = null
      data.metricValue = null
    } else if (d.trigger === 'metric') {
      data.routineId = null
      data.triggerCount = step.triggerCount ?? 1
    } else if (d.trigger === 'manual') {
      // keep the stored config (switching back restores it), just stop the
      // engine from caring: trigger 'manual' never auto-completes.
    }

    await db.goalStep.update({ where: { id: stepId }, data })

    // re-derive: an edited trigger (or a metric that just got edited into
    // range elsewhere) may complete this step immediately
    await evaluateStepTriggers(id)

    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('PATCH /api/goals/[id]/steps/[stepId] failed', e)
    return NextResponse.json({ error: 'Failed to update step' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, stepId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const step = await db.goalStep.findFirst({ where: { id: stepId, goalId: id } })
    if (!step) return NextResponse.json({ error: 'Step not found' }, { status: 404 })
    await db.goalStep.delete({ where: { id: stepId } })
    // compact orders
    const siblings = await db.goalStep.findMany({ where: { goalId: id }, orderBy: { order: 'asc' } })
    await db.$transaction(
      siblings.map((s, i) => db.goalStep.update({ where: { id: s.id }, data: { order: i } })),
    )
    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('DELETE /api/goals/[id]/steps/[stepId] failed', e)
    return NextResponse.json({ error: 'Failed to delete step' }, { status: 500 })
  }
}
