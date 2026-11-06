import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'

const createStepSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
  /** insert after this step order (append by default) */
  afterOrder: z.number().int().optional(),
})

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

    const step = await db.goalStep.create({
      data: { goalId: id, title: d.title, notes: d.notes ?? null, order },
    })
    return NextResponse.json({ step }, { status: 201 })
  } catch (e) {
    console.error('POST /api/goals/[id]/steps failed', e)
    return NextResponse.json({ error: 'Failed to add step' }, { status: 500 })
  }
}
