import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal } from '@/lib/api-helpers'
import { serializeGoal } from '@/lib/goal-serialize'
import { evaluateStepTriggers } from '@/lib/step-engine'
import { applyPbNodeCredit, type PbNodeEffect } from '@/lib/pb-credit'

const addRecordSchema = z.object({
  value: z.number().positive('Value must be greater than 0').max(1_000_000),
  /** ISO date, optional — defaults to now */
  date: z.string().datetime().optional(),
  note: z.string().max(200).nullable().optional(),
})

type Params = { params: Promise<{ id: string; pbId: string }> }

/**
 * POST /api/goals/[id]/pbs/[pbId]/records — log an attempt. Whether it's a
 * new PB is derived client-side (pb-math); the server just keeps history —
 * and, when the metric feeds a roadmap checkpoint, credits it (sum mode) or
 * re-mirrors the rolling average (average mode).
 */
export async function POST(req: Request, { params }: Params) {
  const { id, pbId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = addRecordSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid record data' }, { status: 400 })
    }
    const pb = await db.personalBest.findFirst({
      where: { id: pbId, goalId: id, goal: { userId: auth.user.id } },
    })
    if (!pb) return NextResponse.json({ error: 'PB not found' }, { status: 404 })

    const d = parsed.data
    let history: unknown[] = []
    try {
      const parsedHistory = JSON.parse(pb.history)
      if (Array.isArray(parsedHistory)) history = parsedHistory
    } catch {
      history = [] // corrupt column → start fresh rather than lose the feature
    }
    const recordId = randomUUID()
    history.push({ id: recordId, date: d.date ?? new Date().toISOString(), value: d.value, note: d.note ?? null })
    const historyJson = JSON.stringify(history)

    await db.personalBest.update({
      where: { id: pb.id },
      data: { history: historyJson },
    })

    // the linked checkpoint (if any) gets its share of the attempt
    const nodeCredit = await applyPbNodeCredit(id, { ...pb, history: historyJson }, { kind: 'add', recordId })

    // a new attempt can push a metric-triggered step over its bar
    const advances = await evaluateStepTriggers(id)

    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json(
      {
        goal: goal ? serializeGoal(goal) : null,
        stepsAdvanced: advances.map((a) => ({ id: a.stepId, title: a.title })),
        nodeCredit,
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/goals/[id]/pbs/[pbId]/records failed', e)
    return NextResponse.json({ error: 'Failed to add record' }, { status: 500 })
  }
}
