import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { serializeGoal } from '@/lib/goal-serialize'

const createPbSchema = z.object({
  name: z.string().min(1, 'Name is required').max(60),
  unit: z.string().max(30).nullable().optional(),
  /** "up" = higher is better (WPM) · "down" = lower is better (BLD time) */
  direction: z.enum(['up', 'down']).optional(),
  /** optional first record — your current best */
  firstValue: z.number().positive().max(1_000_000).nullable().optional(),
  firstDate: z.string().datetime().nullable().optional(),
})

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/goals/[id]/pbs — create a personal-best metric on a goal,
 * e.g. name "WPM" unit "wpm" direction up, or "BLD" unit "s" direction down.
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

    const history =
      d.firstValue != null && d.firstValue > 0
        ? JSON.stringify([
            { id: randomUUID(), date: d.firstDate ?? new Date().toISOString(), value: d.firstValue, note: null },
          ])
        : '[]'

    await db.personalBest.create({
      data: {
        goalId: id,
        name,
        unit: d.unit?.trim() || null,
        direction: d.direction ?? 'up',
        history,
      },
    })

    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null }, { status: 201 })
  } catch (e) {
    console.error('POST /api/goals/[id]/pbs failed', e)
    return NextResponse.json({ error: 'Failed to create PB metric' }, { status: 500 })
  }
}
