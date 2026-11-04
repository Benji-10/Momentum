import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'
import { normalizeMilestoneDefs, replaceNodeMilestones, syncMilestoneReached } from '@/lib/milestones'
import { buildNodeIndex, nodeDependencies, nodeStatus } from '@/lib/skill-tree'

const updateNodeSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  icon: z.string().max(8).optional(),
  /** add this much progress (clamped to target) */
  add: z.number().min(0).max(1_000_000).optional(),
  /** set the exact current value (clamped 0..target) */
  currentValue: z.number().min(0).max(1_000_000).optional(),
  targetValue: z.number().positive().max(1_000_000).optional(),
  unit: z.string().max(30).nullable().optional(),
  xpValue: z.number().int().min(1).max(500).optional(),
  /** shortcut: mark the node as fully mastered */
  mastered: z.boolean().optional(),
  /** redefine sub-checkpoints (values must be < target) */
  milestones: z
    .array(z.union([z.number(), z.object({ value: z.number(), label: z.string().max(60).nullish() })]))
    .max(20)
    .optional(),
  /** move node up/down one tier within its path */
  move: z.enum(['up', 'down']).optional(),
})

type Params = { params: Promise<{ id: string; nodeId: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { id, nodeId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = updateNodeSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid node update' }, { status: 400 })
    const d = parsed.data
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const node = await db.skillNode.findFirst({ where: { id: nodeId, goalId: id } })
    if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 })

    // dependency gate: progress can't be logged on a locked checkpoint —
    // HSK4 stays sealed until HSK3 is cleared. Renames/reordering are fine.
    const changingProgress = d.add != null || d.currentValue != null || d.mastered === true
    if (changingProgress && nodeStatus(node) !== 'mastered') {
      const goalPaths = await db.skillPath.findMany({
        where: { goalId: id },
        include: { nodes: true },
      })
      const sortedPaths = goalPaths.map((p) => ({ ...p, nodes: [...p.nodes].sort((a, b) => a.order - b.order) }))
      const index = buildNodeIndex(sortedPaths)
      const own = sortedPaths.find((p) => p.id === node.pathId)
      const siblings = own?.nodes ?? []
      const prev = siblings[siblings.findIndex((n) => n.id === nodeId) - 1] ?? null
      const { deps } = nodeDependencies(node, prev, index)
      const unmet = deps.filter((x) => !x.mastered)
      if (unmet.length > 0) {
        const names = unmet.map((x) => (x.pathTitle && x.pathTitle !== own?.title ? `${x.pathTitle} · ${x.title}` : x.title))
        return NextResponse.json(
          { error: `Still locked — clear ${names.join(' + ')} first, then this opens up.` },
          { status: 400 },
        )
      }
    }

    // reordering
    if (d.move) {
      const siblings = await db.skillNode.findMany({ where: { pathId: node.pathId }, orderBy: { order: 'asc' } })
      const idx = siblings.findIndex((n) => n.id === nodeId)
      const swapWith = d.move === 'up' ? idx - 1 : idx + 1
      if (swapWith >= 0 && swapWith < siblings.length) {
        const other = siblings[swapWith]
        await db.$transaction([
          db.skillNode.update({ where: { id: node.id }, data: { order: other.order } }),
          db.skillNode.update({ where: { id: other.id }, data: { order: node.order } }),
        ])
      }
    }

    // progress computation
    let current = node.currentValue
    const target = d.targetValue ?? node.targetValue
    if (d.mastered) current = target
    else if (d.add != null) current = node.currentValue + d.add
    else if (d.currentValue != null) current = d.currentValue
    current = Math.max(0, Math.min(target, current))

    const nowMastered = current >= target && target > 0
    const completedAt = nowMastered ? (node.completedAt ?? new Date()) : null

    await db.skillNode.update({
      where: { id: nodeId },
      data: {
        ...(d.title !== undefined ? { title: d.title.trim() } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.icon !== undefined ? { icon: d.icon } : {}),
        currentValue: current,
        targetValue: target,
        ...(d.unit !== undefined ? { unit: d.unit } : {}),
        ...(d.xpValue !== undefined ? { xpValue: d.xpValue } : {}),
        completedAt,
      },
    })

    // milestone maintenance: redefine if asked, then sync reached flags
    if (d.milestones !== undefined) {
      await replaceNodeMilestones(nodeId, normalizeMilestoneDefs(d.milestones, target))
    }
    await syncMilestoneReached(nodeId, current)

    const goal = await db.goal.findUnique({ where: { id }, include: goalInclude })
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('PATCH /api/goals/[id]/nodes/[nodeId] failed', e)
    return NextResponse.json({ error: 'Failed to update node' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id, nodeId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    const node = await db.skillNode.findFirst({ where: { id: nodeId, goalId: id } })
    if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 })
    await db.skillNode.delete({ where: { id: nodeId } })
    // compact orders within the path
    const siblings = await db.skillNode.findMany({ where: { pathId: node.pathId }, orderBy: { order: 'asc' } })
    await db.$transaction(
      siblings.map((n, i) => db.skillNode.update({ where: { id: n.id }, data: { order: i } })),
    )
    const goal = await db.goal.findUnique({ where: { id }, include: goalInclude })
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('DELETE /api/goals/[id]/nodes/[nodeId] failed', e)
    return NextResponse.json({ error: 'Failed to delete node' }, { status: 500 })
  }
}
