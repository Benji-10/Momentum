import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'

const createNoteSchema = z.object({
  content: z.string().min(1, 'Note cannot be empty').max(2000),
  pinned: z.boolean().optional(),
})

type Params = { params: Promise<{ id: string }> }

/** POST /api/goals/[id]/notes — add a note to a goal. */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = createNoteSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid note data' }, { status: 400 })
    }
    const goal = (await ownsGoal(id, auth.user)) ? { id } : null
    if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

    await db.goalNote.create({
      data: { goalId: id, content: parsed.data.content.trim(), pinned: parsed.data.pinned ?? false },
    })
    const updated = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: updated ? serializeGoal(updated) : null }, { status: 201 })
  } catch (e) {
    console.error('POST /api/goals/[id]/notes failed', e)
    return NextResponse.json({ error: 'Failed to add note' }, { status: 500 })
  }
}
