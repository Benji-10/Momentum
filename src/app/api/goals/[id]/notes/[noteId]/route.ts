import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'

const updateNoteSchema = z.object({
  content: z.string().min(1).max(2000).optional(),
  pinned: z.boolean().optional(),
})

type Params = { params: Promise<{ id: string; noteId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { id, noteId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = updateNoteSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid note update' }, { status: 400 })
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const note = await db.goalNote.findFirst({ where: { id: noteId, goalId: id } })
    if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

    await db.goalNote.update({
      where: { id: noteId },
      data: {
        ...(parsed.data.content !== undefined ? { content: parsed.data.content.trim() } : {}),
        ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
      },
    })
    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('PATCH /api/goals/[id]/notes/[noteId] failed', e)
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, noteId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const note = await db.goalNote.findFirst({ where: { id: noteId, goalId: id } })
    if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    await db.goalNote.delete({ where: { id: noteId } })
    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('DELETE /api/goals/[id]/notes/[noteId] failed', e)
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }
}
