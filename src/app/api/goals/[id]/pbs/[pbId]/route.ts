import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal } from '@/lib/api-helpers'
import { serializeGoal } from '@/lib/goal-serialize'

const patchPbSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  unit: z.string().max(30).nullable().optional(),
  direction: z.enum(['up', 'down']).optional(),
})

type Params = { params: Promise<{ id: string; pbId: string }> }

async function loadPb(goalId: string, pbId: string, userId: string) {
  return db.personalBest.findFirst({
    where: { id: pbId, goalId, goal: { userId } },
  })
}

/**
 * PATCH /api/goals/[id]/pbs/[pbId] — rename a metric or flip its direction.
 * (Records are managed under …/records.)
 */
export async function PATCH(req: Request, { params }: Params) {
  const { id, pbId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = patchPbSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid PB patch' }, { status: 400 })
    const pb = await loadPb(id, pbId, auth.user.id)
    if (!pb) return NextResponse.json({ error: 'PB not found' }, { status: 404 })

    const d = parsed.data
    const name = d.name?.trim() ?? pb.name
    if (name !== pb.name) {
      const clash = await db.personalBest.findFirst({ where: { goalId: id, name } })
      if (clash) return NextResponse.json({ error: `You already track "${name}" on this goal` }, { status: 409 })
    }

    await db.personalBest.update({
      where: { id: pb.id },
      data: {
        name,
        unit: d.unit === undefined ? pb.unit : d.unit?.trim() || null,
        ...(d.direction ? { direction: d.direction } : {}),
      },
    })

    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('PATCH /api/goals/[id]/pbs/[pbId] failed', e)
    return NextResponse.json({ error: 'Failed to update PB metric' }, { status: 500 })
  }
}

/** DELETE /api/goals/[id]/pbs/[pbId] — remove the metric and its history. */
export async function DELETE(_req: Request, { params }: Params) {
  const { id, pbId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const pb = await loadPb(id, pbId, auth.user.id)
    if (!pb) return NextResponse.json({ error: 'PB not found' }, { status: 404 })
    await db.personalBest.delete({ where: { id: pb.id } })
    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('DELETE /api/goals/[id]/pbs/[pbId] failed', e)
    return NextResponse.json({ error: 'Failed to delete PB metric' }, { status: 500 })
  }
}
