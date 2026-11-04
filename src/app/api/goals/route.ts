import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'

const stepInput = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
})

const createGoalSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120),
  description: z.string().max(2000).nullable().optional(),
  emoji: z.string().max(8).optional(),
  color: z.string().max(20).optional(),
  category: z.string().max(40).nullable().optional(),
  type: z.enum(['quantitative', 'plan']),
  targetValue: z.number().positive().nullable().optional(),
  unit: z.string().max(30).nullable().optional(),
  weeklyTarget: z.number().positive().nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
  steps: z.array(stepInput).optional(),
})

export async function GET() {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const goals = await db.goal.findMany({
      where: { status: 'active', userId: auth.user.id },
      include: goalInclude,
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ goals: goals.map(serializeGoal) })
  } catch (e) {
    console.error('GET /api/goals failed', e)
    return NextResponse.json({ error: 'Failed to load goals' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const body = await req.json()
    const parsed = createGoalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid goal data', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const d = parsed.data

    if (d.type === 'quantitative' && !d.targetValue) {
      return NextResponse.json({ error: 'Target goals need a target value' }, { status: 400 })
    }

    const goal = await db.goal.create({
      data: {
        userId: auth.user.id,
        title: d.title,
        description: d.description ?? null,
        emoji: d.emoji ?? '🎯',
        color: d.color ?? 'emerald',
        category: d.category?.trim() || null,
        type: d.type,
        targetValue: d.type === 'quantitative' ? d.targetValue ?? null : null,
        unit: d.unit ?? null,
        weeklyTarget: d.weeklyTarget ?? null,
        deadline: d.deadline ? new Date(d.deadline) : null,
        steps: d.steps?.length
          ? {
              create: d.steps.map((s, i) => ({
                title: s.title,
                notes: s.notes ?? null,
                order: i,
              })),
            }
          : undefined,
      },
      include: goalInclude,
    })
    return NextResponse.json({ goal: serializeGoal(goal) }, { status: 201 })
  } catch (e) {
    console.error('POST /api/goals failed', e)
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 })
  }
}
