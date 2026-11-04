import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { parseImportFile } from '@/lib/import-format'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'
import { buildRequiresIds, resolveNodeRef, idsCsv, type NodeRefEntry } from '@/lib/resolve-refs'

/**
 * POST /api/import — bulk-import goals from a roadmap JSON file.
 * Body: the raw parsed JSON (array of goals or { version, goals: [...] }).
 * Node "requires" refs and routine "node" refs (written as titles) are
 * resolved to ids inside each goal.
 */
export async function POST(req: Request) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const raw = await req.json()
    const normalized = parseImportFile(raw)

    for (const g of normalized.goals) {
      const goal = await db.goal.create({
        data: {
          userId: auth.user.id,
          title: g.title,
          description: g.description,
          emoji: g.emoji,
          color: g.color,
          category: g.category,
          type: g.type,
          targetValue: g.targetValue,
          unit: g.unit,
          weeklyTarget: g.weeklyTarget,
          deadline: g.deadline ? new Date(g.deadline) : null,
          steps: g.steps.length
            ? {
                create: g.steps.map((s, i) => ({
                  title: s.title,
                  notes: s.notes,
                  order: i,
                  status: s.done ? ('done' as const) : ('pending' as const),
                  completedAt: s.done ? new Date() : null,
                })),
              }
            : undefined,
          notes: g.notes.length ? { create: g.notes.map((n) => ({ content: n })) } : undefined,
          logs: g.logs.length
            ? { create: g.logs.map((l) => ({ amount: l.amount, note: l.note, date: new Date(l.date) })) }
            : undefined,
        },
      })

      // create paths + nodes first (ids needed for dependency resolution)
      const createdNodes: NodeRefEntry[] = []
      for (const [pi, p] of g.paths.entries()) {
        const path = await db.skillPath.create({
          data: {
            goalId: goal.id,
            title: p.title,
            description: p.description,
            icon: p.icon,
            unit: p.unit,
            order: pi,
            nodes: {
              create: p.nodes.map((n, i) => ({
                goalId: goal.id,
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
        for (const n of path.nodes) createdNodes.push({ id: n.id, title: n.title, pathTitle: p.title })
      }

      // resolve "requires" refs -> requiresIds (cycle-safe). Plan nodes align
      // 1:1, in order, with the created nodes, so ids can be paired up.
      if (createdNodes.length > 0) {
        let cursor = 0
        const requiresInput = g.paths.map((p) => ({
          title: p.title,
          nodes: p.nodes.map((n) => {
            const created = createdNodes[cursor++]
            return { id: created.id, title: n.title, requires: n.requires }
          }),
        }))
        for (const [nodeId, deps] of buildRequiresIds(requiresInput)) {
          if (deps.length) {
            await db.skillNode.update({ where: { id: nodeId }, data: { requiresIds: idsCsv(deps) } })
          }
        }
      }

      // routines (with node links, credit, flexible cadence)
      for (const r of g.routines) {
        let nodeId: string | null = null
        if (r.nodeRef) nodeId = resolveNodeRef(r.nodeRef, null, createdNodes)
        const routine = await db.routineItem.create({
          data: {
            goalId: goal.id,
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
      }
    }

    const goals = await db.goal.findMany({
      where: { status: 'active', userId: auth.user.id },
      include: goalInclude,
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(
      { goals: goals.map(serializeGoal), created: normalized.goals.length },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/import failed', e)
    const message = e instanceof Error ? e.message : 'Failed to import'
    return NextResponse.json({ error: `Import failed: ${message}` }, { status: 400 })
  }
}
