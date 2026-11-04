import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ownedGoal, ownsGoal } from '@/lib/api-helpers'
import { parseGoalScopeImport } from '@/lib/import-format'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'
import { filterCyclicEdges, resolveNodeRef, idsCsv, type NodeRefEntry } from '@/lib/resolve-refs'

/**
 * POST /api/goals/[id]/import — add steps/skill paths/routines to an
 * existing goal from a scoped JSON: { steps?: [], paths?: [], routines?: [] }.
 * Node "requires" refs may point at checkpoints that already exist in this
 * goal; routine "node" refs resolve the same way.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const raw = await req.json()
    const parsed = parseGoalScopeImport(raw)
    if (!(await ownsGoal(id, auth.user))) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

    let addedSteps = 0
    let addedPaths = 0
    let addedRoutines = 0

    if (parsed.steps.length) {
      const maxOrder = await db.goalStep.aggregate({ where: { goalId: id }, _max: { order: true } })
      await db.goalStep.createMany({
        data: parsed.steps.map((s, i) => ({
          goalId: id,
          title: s.title,
          notes: s.notes,
          order: (maxOrder._max.order ?? -1) + 1 + i,
          status: s.done ? ('done' as const) : ('pending' as const),
          completedAt: s.done ? new Date() : null,
        })),
      })
      addedSteps = parsed.steps.length
    }

    // index of nodes that already exist in this goal, for ref resolution
    const existingPaths = await db.skillPath.findMany({
      where: { goalId: id },
      include: { nodes: { orderBy: { order: 'asc' } } },
    })
    const existingEntries: NodeRefEntry[] = existingPaths.flatMap((p) =>
      p.nodes.map((n) => ({ id: n.id, title: n.title, pathTitle: p.title })),
    )
    const createdEntries: NodeRefEntry[] = []

    for (const p of parsed.paths) {
      const maxOrder = await db.skillPath.aggregate({ where: { goalId: id }, _max: { order: true } })
      const path = await db.skillPath.create({
        data: {
          goalId: id,
          title: p.title,
          description: p.description,
          icon: p.icon,
          unit: p.unit,
          order: (maxOrder._max.order ?? -1) + 1,
          nodes: {
            create: p.nodes.map((n, i) => ({
              goalId: id,
              title: n.title,
              description: n.description,
              icon: n.icon,
              order: i,
              currentValue: n.currentValue,
              targetValue: n.targetValue,
              unit: n.unit,
              xpValue: n.xpValue,
              completedAt: n.currentValue >= n.targetValue ? new Date() : null,
              milestones: {
                create: n.milestones.map((m) => ({
                  value: m.value,
                  label: m.label,
                  reachedAt: n.currentValue >= m.value ? new Date() : null,
                })),
              },
            })),
          },
        },
        include: { nodes: { orderBy: { order: 'asc' } } },
      })
      for (const n of path.nodes) createdEntries.push({ id: n.id, title: n.title, pathTitle: p.title })
      addedPaths++
    }

    // resolve requires refs for the newly created nodes (they may reference
    // existing nodes in this goal, or each other) — cycles are dropped
    if (createdEntries.length > 0) {
      const all = [...existingEntries, ...createdEntries]
      const edges: { from: string; to: string }[] = []
      let cursor = 0
      for (const p of parsed.paths) {
        for (const n of p.nodes) {
          const created = createdEntries[cursor++]
          for (const ref of n.requires) {
            const dep = resolveNodeRef(ref, p.title, all)
            if (dep && dep !== created.id) edges.push({ from: dep, to: created.id })
          }
        }
      }
      for (const e of filterCyclicEdges(edges)) {
        const node = await db.skillNode.findUnique({ where: { id: e.to }, select: { id: true, requiresIds: true } })
        const prev = node?.requiresIds ? node.requiresIds.split(',').filter(Boolean) : []
        const next = [...new Set([...prev, e.from])]
        await db.skillNode.update({ where: { id: e.to }, data: { requiresIds: idsCsv(next) } })
      }
    }

    for (const r of parsed.routines) {
      let nodeId: string | null = null
      if (r.nodeRef) nodeId = resolveNodeRef(r.nodeRef, null, [...existingEntries, ...createdEntries])
      const routine = await db.routineItem.create({
        data: {
          goalId: id,
          title: r.title,
          notes: r.notes,
          cadence: r.cadence,
          everyNDays: r.everyNDays,
          weekdays: r.weekdays ? [...r.weekdays].sort().join(',') : null,
          timesPerWeek: r.timesPerWeek,
          nodeId,
          credit: nodeId ? r.credit : null,
          durationMin: r.durationMin,
          startDate: r.startDate ? new Date(r.startDate) : new Date(),
          endDate: r.endDate ? new Date(r.endDate) : null,
        },
      })
      if (r.doneDates.length) {
        const seen = new Set<string>()
        await db.routineDone.createMany({
          data: r.doneDates
            .filter((d) => {
              const day = d.slice(0, 10)
              if (seen.has(day)) return false
              seen.add(day)
              return true
            })
            .map((d) => ({ routineId: routine.id, date: new Date(d) })),
        })
      }
      addedRoutines++
    }

    const updated = await ownedGoal(id, auth.user)
    return NextResponse.json(
      {
        goal: updated ? serializeGoal(updated) : null,
        added: { steps: addedSteps, paths: addedPaths, routines: addedRoutines },
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/goals/[id]/import failed', e)
    const message = e instanceof Error ? e.message : 'Failed to import'
    return NextResponse.json({ error: `Import failed: ${message}` }, { status: 400 })
  }
}
