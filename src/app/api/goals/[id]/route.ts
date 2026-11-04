import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal } from '@/lib/api-helpers'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'

const updateGoalSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  emoji: z.string().max(8).optional(),
  color: z.string().max(20).optional(),
  category: z.string().max(40).nullable().optional(),
  unit: z.string().max(30).nullable().optional(),
  targetValue: z.number().positive().nullable().optional(),
  weeklyTarget: z.number().positive().nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
})

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  const { id } = await params
  try {
    const goal = await ownedGoal(id, auth.user)
    if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    return NextResponse.json({ goal: serializeGoal(goal) })
  } catch (e) {
    console.error('GET /api/goals/[id] failed', e)
    return NextResponse.json({ error: 'Failed to load goal' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  const { id } = await params
  try {
    const owned = await ownedGoal(id, auth.user)
    if (!owned) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const parsed = updateGoalSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid update data' }, { status: 400 })
    }
    const d = parsed.data
    const goal = await db.goal.update({
      where: { id },
      data: {
        ...(d.title !== undefined ? { title: d.title } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.emoji !== undefined ? { emoji: d.emoji } : {}),
        ...(d.color !== undefined ? { color: d.color } : {}),
        ...(d.category !== undefined ? { category: d.category } : {}),
        ...(d.unit !== undefined ? { unit: d.unit } : {}),
        ...(d.targetValue !== undefined ? { targetValue: d.targetValue } : {}),
        ...(d.weeklyTarget !== undefined ? { weeklyTarget: d.weeklyTarget } : {}),
        ...(d.deadline !== undefined ? { deadline: d.deadline ? new Date(d.deadline) : null } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
      },
      include: goalInclude,
    })
    return NextResponse.json({ goal: serializeGoal(goal) })
  } catch (e) {
    console.error('PATCH /api/goals/[id] failed', e)
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  const { id } = await params
  try {
    const owned = await ownedGoal(id, auth.user)
    if (!owned) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    await db.goal.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE /api/goals/[id] failed', e)
    return NextResponse.json({ error: 'Failed to delete goal' }, { status: 500 })
  }
}
