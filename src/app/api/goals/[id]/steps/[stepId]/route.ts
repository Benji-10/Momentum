import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'

const updateStepSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'done']).optional(),
  /** move step up/down by one position */
  move: z.enum(['up', 'down']).optional(),
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
    await db.goalStep.update({
      where: { id: stepId },
      data: {
        ...(d.title !== undefined ? { title: d.title } : {}),
        ...(d.notes !== undefined ? { notes: d.notes } : {}),
        ...(d.status !== undefined
          ? {
              status: d.status,
              completedAt: d.status === 'done' ? (statusChanged ? new Date() : step.completedAt) : null,
            }
          : {}),
      },
    })

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
