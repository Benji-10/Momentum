import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal } from '@/lib/api-helpers'
import { serializeGoal } from '@/lib/goal-serialize'

const updateRecordSchema = z.object({
  value: z.number().positive('Value must be greater than 0').max(1_000_000).optional(),
  /** ISO instant — only sent when the day actually changed */
  date: z.string().datetime().optional(),
  note: z.string().max(200).nullable().optional(),
})

type Params = { params: Promise<{ id: string; pbId: string; recordId: string }> }

/** Read + own-check the PB, returning its parsed history (or null). */
async function loadHistory(pbId: string, goalId: string, userId: string) {
  const pb = await db.personalBest.findFirst({
    where: { id: pbId, goalId, goal: { userId } },
  })
  if (!pb) return null
  let history: unknown[] = []
  try {
    const parsed = JSON.parse(pb.history)
    if (Array.isArray(parsed)) history = parsed
  } catch {
    history = []
  }
  return { pb, history }
}

/**
 * PATCH /api/goals/[id]/pbs/[pbId]/records/[recordId] — fix an attempt after
 * the fact: wrong number, wrong day, add the note you meant to add. (The PB
 * itself is derived, so the standing best follows automatically.)
 */
export async function PATCH(req: Request, { params }: Params) {
  const { id, pbId, recordId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = updateRecordSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid attempt update' }, { status: 400 })
    const d = parsed.data
    const loaded = await loadHistory(pbId, id, auth.user.id)
    if (!loaded) return NextResponse.json({ error: 'PB not found' }, { status: 404 })

    const idx = loaded.history.findIndex(
      (r) => typeof r === 'object' && r !== null && (r as { id?: unknown }).id === recordId,
    )
    if (idx === -1) return NextResponse.json({ error: 'Record not found' }, { status: 404 })

    const prev = loaded.history[idx] as { id: string; date: string; value: number; note?: string | null }
    loaded.history[idx] = {
      id: prev.id,
      date: d.date ?? prev.date,
      value: d.value ?? prev.value,
      note: d.note !== undefined ? d.note : (prev.note ?? null),
    }

    await db.personalBest.update({
      where: { id: loaded.pb.id },
      data: { history: JSON.stringify(loaded.history) },
    })

    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('PATCH /api/goals/[id]/pbs/[pbId]/records/[recordId] failed', e)
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 })
  }
}

/**
 * DELETE /api/goals/[id]/pbs/[pbId]/records/[recordId] — remove one attempt
 * (fix a typo without losing the rest of the history).
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { id, pbId, recordId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const loaded = await loadHistory(pbId, id, auth.user.id)
    if (!loaded) return NextResponse.json({ error: 'PB not found' }, { status: 404 })

    const next = loaded.history.filter(
      (r): r is Record<string, unknown> => typeof r === 'object' && r !== null && (r as { id?: unknown }).id !== recordId,
    )
    if (next.length === loaded.history.length) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 })
    }

    await db.personalBest.update({
      where: { id: loaded.pb.id },
      data: { history: JSON.stringify(next) },
    })

    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('DELETE /api/goals/[id]/pbs/[pbId]/records/[recordId] failed', e)
    return NextResponse.json({ error: 'Failed to delete record' }, { status: 500 })
  }
}
