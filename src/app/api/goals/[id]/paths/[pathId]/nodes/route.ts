import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'
import { normalizeMilestoneDefs } from '@/lib/milestones'

const createNodeSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  icon: z.string().max(8).optional(),
  currentValue: z.number().min(0).max(1_000_000).optional(),
  targetValue: z.number().positive().max(1_000_000),
  unit: z.string().max(30).nullable().optional(),
  xpValue: z.number().int().min(1).max(500).optional(),
  /** sub-checkpoints, e.g. [50, 100] or [{ value: 50, label: "First 50" }] */
  milestones: z.array(z.union([z.number(), z.object({ value: z.number(), label: z.string().max(60).nullish() })])).max(20).optional(),
  /** insert after this tier index (append by default) */
  afterOrder: z.number().int().min(0).optional(),
})

type Params = { params: Promise<{ id: string; pathId: string }> }

/** POST /api/goals/[id]/paths/[pathId]/nodes — add a tier to a path. */
export async function POST(req: Request, { params }: Params) {
  const { id, pathId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = createNodeSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid node data', details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const d = parsed.data
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const path = await db.skillPath.findFirst({ where: { id: pathId, goalId: id } })
    if (!path) return NextResponse.json({ error: 'Path not found' }, { status: 404 })

    let order: number
    if (d.afterOrder !== undefined) {
      await db.skillNode.updateMany({
        where: { pathId, order: { gt: d.afterOrder } },
        data: { order: { increment: 1 } },
      })
      order = d.afterOrder + 1
    } else {
      const max = await db.skillNode.aggregate({ where: { pathId }, _max: { order: true } })
      order = (max._max.order ?? -1) + 1
    }

    const currentValue = d.currentValue ?? 0
    const milestones = normalizeMilestoneDefs(d.milestones, d.targetValue)

    await db.skillNode.create({
      data: {
        goalId: id,
        pathId,
        title: d.title.trim(),
        description: d.description ?? null,
        icon: d.icon ?? '✨',
        order,
        currentValue,
        targetValue: d.targetValue,
        unit: d.unit?.trim() || null,
        xpValue: d.xpValue ?? 20,
        completedAt: currentValue >= d.targetValue ? new Date() : null,
        milestones: {
          create: milestones.map((m) => ({
            value: m.value,
            label: m.label,
            reachedAt: currentValue >= m.value ? new Date() : null,
          })),
        },
      },
    })
    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null }, { status: 201 })
  } catch (e) {
    console.error('POST /api/goals/[id]/paths/[pathId]/nodes failed', e)
    return NextResponse.json({ error: 'Failed to add node' }, { status: 500 })
  }
}
