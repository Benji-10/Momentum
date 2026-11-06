import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { serializeGoal } from '@/lib/goal-serialize'

const patchSchema = z.object({
  amount: z.number().positive('Amount must be greater than 0').max(1_000_000).optional(),
  note: z.string().max(500).nullable().optional(),
})

type Params = { params: Promise<{ id: string; logId: string }> }

/** PATCH /api/goals/[id]/logs/[logId] — fix up an entry after the fact
 *  (e.g. the routine said 2 hours but you only worked 50 minutes). */
export async function PATCH(req: Request, { params }: Params) {
  const { id, logId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid log data' }, { status: 400 })
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const log = await db.progressLog.findFirst({ where: { id: logId, goalId: id } })
    if (!log) return NextResponse.json({ error: 'Log not found' }, { status: 404 })

    await db.progressLog.update({ where: { id: logId }, data: parsed.data })
    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('PATCH /api/goals/[id]/logs/[logId] failed', e)
    return NextResponse.json({ error: 'Failed to update log' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, logId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const log = await db.progressLog.findFirst({ where: { id: logId, goalId: id } })
    if (!log) return NextResponse.json({ error: 'Log not found' }, { status: 404 })
    await db.progressLog.delete({ where: { id: logId } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE /api/goals/[id]/logs/[logId] failed', e)
    return NextResponse.json({ error: 'Failed to delete log' }, { status: 500 })
  }
}
