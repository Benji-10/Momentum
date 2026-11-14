import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'
import { linkRoutineToStep } from '@/lib/step-engine'

const updateRoutineSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  notes: z.string().max(500).nullable().optional(),
  cadence: z.enum(['interval', 'weekly', 'flexible']).optional(),
  everyNDays: z.number().int().min(1).max(365).nullable().optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  timesPerWeek: z.number().int().min(1).max(14).nullable().optional(),
  nodeId: z.string().max(64).nullable().optional(),
  credit: z.number().positive().max(1_000_000).nullable().optional(),
  durationMin: z.number().int().min(1).max(24 * 60).nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
  archived: z.boolean().optional(),
  /** extra credit: nice to do, never a penalty when skipped */
  optional: z.boolean().optional(),
  /** the plan step this routine works toward. undefined = leave step links
   *  as they are · null = unlink (steps counting this routine go back to a
   *  manual tick) · id = link (its trigger becomes "routine", stepCount
   *  check-offs complete it; any other step pointing here resets to manual) */
  stepId: z.string().min(1).max(64).nullable().optional(),
  stepCount: z.number().int().min(1).max(999).nullable().optional(),
})

type Params = { params: Promise<{ id: string; routineId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { id, routineId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = updateRoutineSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid routine update' }, { status: 400 })
    const d = parsed.data
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const routine = await db.routineItem.findFirst({ where: { id: routineId, goalId: id } })
    if (!routine) return NextResponse.json({ error: 'Routine not found' }, { status: 404 })

    const cadence = d.cadence ?? (routine.cadence as 'interval' | 'weekly' | 'flexible')
    const everyNDays = d.everyNDays !== undefined ? d.everyNDays : routine.everyNDays
    const weekdays =
      d.weekdays !== undefined
        ? d.weekdays
        : routine.weekdays
          ? routine.weekdays.split(',').map((x) => parseInt(x, 10))
          : null
    const timesPerWeek = d.timesPerWeek !== undefined ? d.timesPerWeek : routine.timesPerWeek

    if (cadence === 'interval' && !everyNDays) {
      return NextResponse.json({ error: 'Interval routines need everyNDays' }, { status: 400 })
    }
    if (cadence === 'weekly' && !(weekdays?.length)) {
      return NextResponse.json({ error: 'Weekly routines need at least one weekday' }, { status: 400 })
    }
    if (cadence === 'flexible' && !timesPerWeek) {
      return NextResponse.json({ error: 'Flexible routines need timesPerWeek' }, { status: 400 })
    }

    // linked node: validate + resolve credit
    let nodeId: string | null | undefined = undefined // undefined = keep as-is
    if (d.nodeId !== undefined) {
      if (d.nodeId === null) {
        nodeId = null
      } else {
        const node = await db.skillNode.findFirst({ where: { id: d.nodeId, goalId: id } })
        if (!node) return NextResponse.json({ error: 'Linked checkpoint not found' }, { status: 400 })
        nodeId = node.id
      }
    }
    const effectiveNodeId = nodeId !== undefined ? nodeId : routine.nodeId
    // credit survives unlinking: unlinked, it means "what one check-off logs
    // in the goal's own unit" instead of the checkpoint's — still meaningful
    const credit = d.credit !== undefined ? d.credit : routine.credit

    await db.routineItem.update({
      where: { id: routineId },
      data: {
        ...(d.title !== undefined ? { title: d.title.trim() } : {}),
        ...(d.notes !== undefined ? { notes: d.notes } : {}),
        cadence,
        everyNDays: cadence === 'interval' ? everyNDays! : null,
        weekdays: cadence === 'weekly' ? [...new Set(weekdays!)].sort().join(',') : null,
        timesPerWeek: cadence === 'flexible' ? timesPerWeek! : null,
        ...(nodeId !== undefined ? { nodeId: effectiveNodeId } : {}),
        ...(nodeId !== undefined || d.credit !== undefined ? { credit } : {}),
        ...(d.durationMin !== undefined ? { durationMin: d.durationMin } : {}),
        ...(d.startDate !== undefined ? { startDate: d.startDate ? new Date(d.startDate) : new Date() } : {}),
        ...(d.endDate !== undefined ? { endDate: d.endDate ? new Date(d.endDate) : null } : {}),
        ...(d.archived !== undefined ? { archived: d.archived } : {}),
        ...(d.optional !== undefined ? { optional: d.optional } : {}),
      },
    })

    // step link (routine side): undefined keeps it, null unlinks, id links —
    // the linked step's trigger becomes "routine: N check-offs of this one"
    if (d.stepId !== undefined) {
      await linkRoutineToStep(id, routineId, d.stepId, d.stepCount)
    }

    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('PATCH /api/goals/[id]/routines/[routineId] failed', e)
    return NextResponse.json({ error: 'Failed to update routine' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, routineId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const routine = await db.routineItem.findFirst({ where: { id: routineId, goalId: id } })
    if (!routine) return NextResponse.json({ error: 'Routine not found' }, { status: 404 })
    // steps that count this routine's check-offs would silently widen to
    // "any routine" once the link is gone — reset them to a manual tick so
    // the semantics the user set up never change behind their back
    await db.goalStep.updateMany({
      where: { goalId: id, routineId, trigger: 'routine' },
      data: { trigger: 'manual', routineId: null },
    })
    await db.routineItem.delete({ where: { id: routineId } })
    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('DELETE /api/goals/[id]/routines/[routineId] failed', e)
    return NextResponse.json({ error: 'Failed to delete routine' }, { status: 500 })
  }
}
