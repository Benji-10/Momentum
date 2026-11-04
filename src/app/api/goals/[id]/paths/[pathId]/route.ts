import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'

const updatePathSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  description: z.string().max(1000).nullable().optional(),
  icon: z.string().max(8).optional(),
  unit: z.string().max(30).nullable().optional(),
  /** move path left/right by one position */
  move: z.enum(['left', 'right']).optional(),
})

type Params = { params: Promise<{ id: string; pathId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { id, pathId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = updatePathSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid path update' }, { status: 400 })
    const d = parsed.data
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const path = await db.skillPath.findFirst({ where: { id: pathId, goalId: id } })
    if (!path) return NextResponse.json({ error: 'Path not found' }, { status: 404 })

    if (d.move) {
      const siblings = await db.skillPath.findMany({ where: { goalId: id }, orderBy: { order: 'asc' } })
      const idx = siblings.findIndex((p) => p.id === pathId)
      const swapWith = d.move === 'left' ? idx - 1 : idx + 1
      if (swapWith >= 0 && swapWith < siblings.length) {
        const other = siblings[swapWith]
        await db.$transaction([
          db.skillPath.update({ where: { id: path.id }, data: { order: other.order } }),
          db.skillPath.update({ where: { id: other.id }, data: { order: path.order } }),
        ])
      }
    }

    await db.skillPath.update({
      where: { id: pathId },
      data: {
        ...(d.title !== undefined ? { title: d.title.trim() } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.icon !== undefined ? { icon: d.icon } : {}),
        ...(d.unit !== undefined ? { unit: d.unit } : {}),
      },
    })
    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('PATCH /api/goals/[id]/paths/[pathId] failed', e)
    return NextResponse.json({ error: 'Failed to update path' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, pathId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const path = await db.skillPath.findFirst({ where: { id: pathId, goalId: id } })
    if (!path) return NextResponse.json({ error: 'Path not found' }, { status: 404 })
    await db.skillPath.delete({ where: { id: pathId } }) // nodes cascade
    const siblings = await db.skillPath.findMany({ where: { goalId: id }, orderBy: { order: 'asc' } })
    await db.$transaction(
      siblings.map((p, i) => db.skillPath.update({ where: { id: p.id }, data: { order: i } })),
    )
    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('DELETE /api/goals/[id]/paths/[pathId] failed', e)
    return NextResponse.json({ error: 'Failed to delete path' }, { status: 500 })
  }
}
