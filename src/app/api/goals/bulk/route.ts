import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'

const stepInput = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
})

const bulkGoalSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120),
  description: z.string().max(2000).nullable().optional(),
  emoji: z.string().max(8).optional(),
  color: z.string().max(20).optional(),
  category: z.string().max(40).nullable().optional(),
  type: z.enum(['quantitative', 'plan']).optional(),
  targetValue: z.number().positive().nullable().optional(),
  unit: z.string().max(30).nullable().optional(),
  weeklyTarget: z.number().positive().nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
  steps: z.array(stepInput).max(100).optional(),
})

const bulkSchema = z.object({
  goals: z.array(bulkGoalSchema).min(1).max(30),
})

/** Pleasing default colors when the caller doesn't pick one. */
const BULK_COLORS = ['emerald', 'sky', 'amber', 'rose', 'violet', 'teal', 'orange', 'indigo']

/**
 * POST /api/goals/bulk — create many simple trackers in one request.
 * Used by the "bulk add" dialog. Returns all active goals like /api/goals.
 */
export async function POST(req: Request) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = bulkSchema.safeParse(await req.json())
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const path = issue.path.join('.')
      return NextResponse.json({ error: `${issue.message}${path ? ` (at "${path}")` : ''}` }, { status: 400 })
    }

    const created: string[] = []
    for (const [i, g] of parsed.data.goals.entries()) {
      const type = g.type ?? (g.targetValue ? 'quantitative' : 'plan')
      const goal = await db.goal.create({
        data: {
          userId: auth.user.id,
          title: g.title.trim(),
          description: g.description ?? null,
          emoji: g.emoji ?? '🎯',
          color: g.color ?? BULK_COLORS[i % BULK_COLORS.length],
          category: g.category?.trim() || null,
          type,
          targetValue: type === 'quantitative' ? g.targetValue ?? null : null,
          unit: g.unit ?? null,
          weeklyTarget: g.weeklyTarget ?? null,
          deadline: g.deadline ? new Date(g.deadline) : null,
          steps: g.steps?.length
            ? { create: g.steps.map((s, si) => ({ title: s.title, notes: s.notes ?? null, order: si })) }
            : undefined,
        },
        select: { id: true },
      })
      created.push(goal.id)
    }

    const goals = await db.goal.findMany({
      where: { status: 'active', userId: auth.user.id },
      include: goalInclude,
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ goals: goals.map(serializeGoal), created: created.length }, { status: 201 })
  } catch (e) {
    console.error('POST /api/goals/bulk failed', e)
    return NextResponse.json({ error: 'Failed to create goals' }, { status: 500 })
  }
}
