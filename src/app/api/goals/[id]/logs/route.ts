import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'

const createLogSchema = z.object({
  amount: z.number().positive('Amount must be greater than 0').max(1_000_000),
  note: z.string().max(500).nullable().optional(),
  /** ISO date, optional — defaults to now */
  date: z.string().datetime().optional(),
  /** Unit the amount was recorded in, when it differs from the goal's own
   *  (e.g. an import carrying "20 min" entries). Manual entries omit it —
   *  they are in the goal's unit by definition. */
  unit: z.string().max(30).nullable().optional(),
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
    const goal = (await ownsGoal(id, auth.user)) ? { id } : null
    if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

    const d = parsed.data
    const log = await db.progressLog.create({
      data: {
        goalId: id,
        amount: d.amount,
        note: d.note ?? null,
        unit: d.unit?.trim() || null,
        date: d.date ? new Date(d.date) : new Date(),
      },
    })
    return NextResponse.json({ log }, { status: 201 })
  } catch (e) {
    console.error('POST /api/goals/[id]/logs failed', e)
    return NextResponse.json({ error: 'Failed to log progress' }, { status: 500 })
  }
}
