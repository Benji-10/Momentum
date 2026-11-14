import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal } from '@/lib/api-helpers'
import { serializeGoal } from '@/lib/goal-serialize'
import { resyncPbMirror, takeBackPbSums, type PbNodeEffect } from '@/lib/pb-credit'

const patchPbSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  unit: z.string().max(30).nullable().optional(),
  direction: z.enum(['up', 'down']).optional(),
  // ---- roadmap link ----
  /** undefined = keep · null = unlink (earned progress stays) · id = link */
  nodeId: z.string().min(1).max(64).nullable().optional(),
  nodeMode: z.enum(['sum', 'average']).nullable().optional(),
  nodeWindow: z.number().int().min(1).max(50).nullable().optional(),
})

type Params = { params: Promise<{ id: string; pbId: string }> }

async function loadPb(goalId: string, pbId: string, userId: string) {
  return db.personalBest.findFirst({
    where: { id: pbId, goalId, goal: { userId } },
  })
}

/**
 * PATCH /api/goals/[id]/pbs/[pbId] — rename a metric, flip its direction, or
 * change which roadmap checkpoint it feeds. Linking in "average" mode
 * re-mirrors the checkpoint immediately; "sum" starts counting from now on
 * (past attempts never counted, exactly like linking a routine). Unlinking
 * keeps the progress the metric already credited.
 */
export async function PATCH(req: Request, { params }: Params) {
  const { id, pbId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = patchPbSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid PB patch' }, { status: 400 })
    const pb = await loadPb(id, pbId, auth.user.id)
    if (!pb) return NextResponse.json({ error: 'PB not found' }, { status: 404 })

    const d = parsed.data
    const name = d.name?.trim() ?? pb.name
    if (name !== pb.name) {
      const clash = await db.personalBest.findFirst({ where: { goalId: id, name } })
      if (clash) return NextResponse.json({ error: `You already track "${name}" on this goal` }, { status: 409 })
    }

    const direction = d.direction ?? pb.direction

    // resolve the checkpoint link: undefined keeps it, null clears it
    let nodeId: string | null
    if (d.nodeId === undefined) {
      nodeId = pb.nodeId
    } else if (d.nodeId === null) {
      nodeId = null
    } else {
      const node = await db.skillNode.findFirst({ where: { id: d.nodeId, goalId: id }, select: { id: true } })
      if (!node) return NextResponse.json({ error: 'Linked checkpoint not found' }, { status: 400 })
      nodeId = node.id
    }

    // the mode follows the link: no link → no mode
    let nodeMode: string | null
    if (d.nodeMode === undefined) {
      nodeMode = nodeId ? (pb.nodeMode ?? 'sum') : null
    } else {
      nodeMode = nodeId ? d.nodeMode : null
    }
    // the average mirror needs an "up" metric — asking for it on a "down"
    // metric is rejected; flipping an average-linked metric to "down"
    // downgrades the link to "sum" so it keeps working instead of breaking
    if (nodeMode === 'average' && direction === 'down') {
      if (d.nodeMode === 'average') {
        return NextResponse.json(
          { error: 'Average tracking needs a higher-is-better metric — link it as "every attempt adds" instead' },
          { status: 400 },
        )
      }
      nodeMode = 'sum'
    }
    const nodeWindow = nodeId ? d.nodeWindow ?? pb.nodeWindow ?? null : null

    const updated = await db.personalBest.update({
      where: { id: pb.id },
      data: {
        name,
        unit: d.unit === undefined ? pb.unit : d.unit?.trim() || null,
        ...(d.direction ? { direction: d.direction } : {}),
        nodeId,
        nodeMode,
        nodeWindow,
      },
    })

    // average mode: the checkpoint mirrors where the metric stands right now
    // (link established, mode switched, or window changed)
    let nodeCredit: PbNodeEffect | null = null
    if (nodeId && nodeMode === 'average') {
      nodeCredit = await resyncPbMirror(id, updated)
    }

    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null, nodeCredit })
  } catch (e) {
    console.error('PATCH /api/goals/[id]/pbs/[pbId] failed', e)
    return NextResponse.json({ error: 'Failed to update PB metric' }, { status: 500 })
  }
}

/** DELETE /api/goals/[id]/pbs/[pbId] — remove the metric and its history.
 *  Sum-mode contributions are taken back out of the linked checkpoint first. */
export async function DELETE(_req: Request, { params }: Params) {
  const { id, pbId } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const pb = await loadPb(id, pbId, auth.user.id)
    if (!pb) return NextResponse.json({ error: 'PB not found' }, { status: 404 })
    await takeBackPbSums(id, pb)
    await db.personalBest.delete({ where: { id: pb.id } })
    const goal = await ownedGoal(id, auth.user)
    return NextResponse.json({ goal: goal ? serializeGoal(goal) : null })
  } catch (e) {
    console.error('DELETE /api/goals/[id]/pbs/[pbId] failed', e)
    return NextResponse.json({ error: 'Failed to delete PB metric' }, { status: 500 })
  }
}
