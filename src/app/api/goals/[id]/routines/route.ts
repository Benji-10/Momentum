import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'

const createRoutineSchema = z.object({
  title: z.string().min(1).max(120),
  notes: z.string().max(500).nullable().optional(),
  cadence: z.enum(['interval', 'weekly', 'flexible']).default('weekly'),
  everyNDays: z.number().int().min(1).max(365).nullable().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  timesPerWeek: z.number().int().min(1).max(14).nullable().optional(),
  nodeId: z.string().max(64).nullable().optional(),
  credit: z.number().positive().max(1_000_000).nullable().optional(),
  durationMin: z.number().int().min(1).max(24 * 60).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  /** extra credit: nice to do, never a penalty when skipped */
  optional: z.boolean().optional(),
})

type Params = { params: Promise<{ id: string }> }

/** POST /api/goals/[id]/routines — create a recurring routine. */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = createRoutineSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid routine data', details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const d = parsed.data
    const goal = (await ownsGoal(id, auth.user)) ? { id } : null
    if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

    if (d.cadence === 'interval' && !d.everyNDays) {
      return NextResponse.json({ error: 'Interval routines need everyNDays' }, { status: 400 })
    }
    if (d.cadence === 'weekly' && !(d.weekdays?.length)) {
      return NextResponse.json({ error: 'Weekly routines need at least one weekday' }, { status: 400 })
    }
    if (d.cadence === 'flexible' && !d.timesPerWeek) {
      return NextResponse.json({ error: 'Flexible routines need timesPerWeek' }, { status: 400 })
    }

    // the linked skill node (if any) must belong to this goal
    let nodeId: string | null = null
    if (d.nodeId) {
      const node = await db.skillNode.findFirst({ where: { id: d.nodeId, goalId: id } })
      if (!node) return NextResponse.json({ error: 'Linked checkpoint not found' }, { status: 400 })
      nodeId = node.id
    }

    await db.routineItem.create({
      data: {
        goalId: id,
        title: d.title.trim(),
        notes: d.notes ?? null,
        cadence: d.cadence,
        everyNDays: d.cadence === 'interval' ? d.everyNDays! : null,
        weekdays: d.cadence === 'weekly' ? [...new Set(d.weekdays!)].sort().join(',') : null,
        timesPerWeek: d.cadence === 'flexible' ? d.timesPerWeek! : null,
        nodeId,
        credit: nodeId ? (d.credit ?? null) : null,
        durationMin: d.durationMin ?? null,
        startDate: d.startDate ? new Date(d.startDate) : new Date(),
        endDate: d.endDate ? new Date(d.endDate) : null,
        optional: d.optional === true,
      },
    })
    const updated = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: updated ? serializeGoal(updated) : null }, { status: 201 })
  } catch (e) {
    console.error('POST /api/goals/[id]/routines failed', e)
    return NextResponse.json({ error: 'Failed to create routine' }, { status: 500 })
  }
}
