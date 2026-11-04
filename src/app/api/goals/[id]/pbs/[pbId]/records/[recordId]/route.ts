import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal } from '@/lib/api-helpers'
import { serializeGoal } from '@/lib/goal-serialize'

type Params = { params: Promise<{ id: string; pbId: string; recordId: string }> }

/**
 * DELETE /api/goals/[id]/pbs/[pbId]/records/[recordId] — remove one attempt
 * (fix a typo without losing the rest of the history).
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { id, pbId, recordId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const pb = await db.personalBest.findFirst({
      where: { id: pbId, goalId: id, goal: { userId: auth.user.id } },
    })
    if (!pb) return NextResponse.json({ error: 'PB not found' }, { status: 404 })

    let history: unknown[] = []
    try {
      const parsed = JSON.parse(pb.history)
      if (Array.isArray(parsed)) history = parsed
    } catch {
      history = []
    }
    const next = history.filter(
      (r): r is Record<string, unknown> => typeof r === 'object' && r !== null && (r as { id?: unknown }).id !== recordId,
    )
    if (next.length === history.length) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    await db.personalBest.update({
      where: { id: pb.id },
      data: { history: JSON.stringify(next) },
    })

    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('DELETE /api/goals/[id]/pbs/[pbId]/records/[recordId] failed', e)
    return NextResponse.json({ error: 'Failed to delete record' }, { status: 500 })
  }
}
