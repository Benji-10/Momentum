import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'

const createPathSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().max(1000).nullable().optional(),
  icon: z.string().max(8).optional(),
  unit: z.string().max(30).nullable().optional(),
  /** initial nodes, in tier order */
  nodes: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        description: z.string().max(1000).nullable().optional(),
        icon: z.string().max(8).optional(),
        currentValue: z.number().min(0).max(1_000_000).optional(),
        targetValue: z.number().positive().max(1_000_000),
        unit: z.string().max(30).nullable().optional(),
        xpValue: z.number().int().min(1).max(500).optional(),
      }),
    )
    .max(30)
    .optional(),
})

type Params = { params: Promise<{ id: string }> }

/** POST /api/goals/[id]/paths — create a skill path (optionally with nodes). */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = createPathSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid path data', details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const d = parsed.data
    const goal = (await ownsGoal(id, auth.user)) ? { id } : null
    if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

    const maxOrder = await db.skillPath.aggregate({ where: { goalId: id }, _max: { order: true } })

    await db.skillPath.create({
      data: {
        goalId: id,
        title: d.title.trim(),
        description: d.description ?? null,
        icon: d.icon ?? '🌿',
        unit: d.unit?.trim() || null,
        order: (maxOrder._max.order ?? -1) + 1,
        nodes: d.nodes?.length
          ? {
              create: d.nodes.map((n, i) => ({
                goalId: id,
                title: n.title.trim(),
                description: n.description ?? null,
                icon: n.icon ?? '✨',
                order: i,
                currentValue: n.currentValue ?? 0,
                targetValue: n.targetValue,
                unit: n.unit?.trim() || null,
                xpValue: n.xpValue ?? 20,
                completedAt:
                  n.currentValue != null && n.currentValue >= n.targetValue ? new Date() : null,
              })),
            }
          : undefined,
      },
    })
    const updated = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: updated ? serializeGoal(updated) : null }, { status: 201 })
  } catch (e) {
    console.error('POST /api/goals/[id]/paths failed', e)
    return NextResponse.json({ error: 'Failed to create path' }, { status: 500 })
  }
}
