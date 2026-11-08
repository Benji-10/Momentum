import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { canonicalDayUtc } from '@/lib/routine-math'
import { requireUser } from '@/lib/auth'
import { parseImportFile, parseImportFileRaw } from '@/lib/import-format'
import { mergeImportGoals } from '@/lib/merge-import'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'
import { buildRequiresIds, resolveNodeRef, idsCsv, type NodeRefEntry } from '@/lib/resolve-refs'
import { setNodeDerivation } from '@/lib/derive'
import { evaluateStepTriggers } from '@/lib/step-engine'

/** case-insensitive, whitespace-normalized title key (same rule as merge) */
function normTitleKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * POST /api/import — import goals from a roadmap JSON file.
 * Body: the raw parsed JSON (array of goals or { version, goals: [...] }).
 *
 *  · default (create): everything in the file is created fresh — importing
 *    the same file twice duplicates it.
 *  · ?mode=merge: goals/branches/checkpoints/steps/routines/PBs that already
 *    exist (matched by name) are updated in place; definitions follow the
 *    file while progress, XP, history and check-offs are kept.
 *
 * Node "requires" refs and routine "node" refs (written as titles) are
 * resolved to ids inside each goal.
 */
export async function POST(req: Request) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const raw = await req.json()
    const mode = new URL(req.url).searchParams.get('mode')

    if (mode === 'merge') {
      const goalsRaw = parseImportFileRaw(raw)
      const summary = await mergeImportGoals(auth.user.id, goalsRaw)
      const goals = await db.goal.findMany({
        where: { status: 'active', userId: auth.user.id },
        include: goalInclude,
        orderBy: { createdAt: 'asc' },
      })
      return NextResponse.json(
        {
          goals: goals.map(serializeGoal),
          created: summary.goalsCreated,
          updated: summary.goalsUpdated,
          summary,
        },
        { status: 201 },
      )
    }

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
                  trigger: s.triggerType,
                  triggerCount: s.triggerCount,
                  metricName: s.triggerType === 'metric' ? s.metricRef : null,
                  metricWindow: s.triggerType === 'metric' ? s.metricWindow : null,
                  metricOp: s.triggerType === 'metric' ? s.metricOp : null,
                  metricValue: s.triggerType === 'metric' ? s.metricValue : null,
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

        // derived checkpoints: link each "Books finished"-style meter to its
        // source and give it the source's progress so far (never downward).
        // Refs may point forward, so this runs after every node exists.
        let dcursor = 0
        for (const p of g.paths) {
          for (const n of p.nodes) {
            const created = createdNodes[dcursor++]
            if (!created || !n.deriveFromRef || !n.deriveFactor) continue
            const src = resolveNodeRef(n.deriveFromRef, null, createdNodes)
            if (!src || src === created.id) continue
            // silently dropped when the source is itself derived / not in this goal
            await setNodeDerivation(goal.id, created.id, src, n.deriveFactor)
          }
        }
      }

      // routines (with node links, credit, flexible cadence, extra-credit flag)
      const routineIdByTitle = new Map<string, string>()
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
            optional: r.optional,
          },
        })
        if (!routineIdByTitle.has(normTitleKey(routine.title))) {
          routineIdByTitle.set(normTitleKey(routine.title), routine.id)
        }
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
              .map((d) => ({ routineId: routine.id, date: canonicalDayUtc(d.slice(0, 10)) })),
          })
        }
      }

      // link step routine triggers now that every routine exists: rows were
      // created in file order, so they pair 1:1 with g.steps by index. An
      // unresolved title keeps null = "any routine" (never breaks the import)
      if (g.steps.length) {
        const stepRows = await db.goalStep.findMany({
          where: { goalId: goal.id },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          select: { id: true },
        })
        for (const [i, s] of g.steps.entries()) {
          const row = stepRows[i]
          if (!row || s.triggerType !== 'routine' || !s.routineRef) continue
          const rid = routineIdByTitle.get(normTitleKey(s.routineRef))
          if (rid) await db.goalStep.update({ where: { id: row.id }, data: { routineId: rid } })
        }
      }

      // personal-best metrics with their attempt history (a metric with no
      // attempts yet is still created — steps may reference it, and recording
      // the first attempt later is what completes them)
      for (const pb of g.pbs) {
        await db.personalBest.create({
          data: {
            goalId: goal.id,
            name: pb.name,
            unit: pb.unit,
            direction: pb.direction,
            history: JSON.stringify(
              pb.records.map((r) => ({
                id: randomUUID(),
                date: r.date,
                value: r.value,
                note: r.note,
              })),
            ),
          },
        })
      }

      // with every definition in place (routines linked, metrics created),
      // run the automation once — a file whose history already satisfies a
      // trigger imports with those steps completed
      await evaluateStepTriggers(goal.id)
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
