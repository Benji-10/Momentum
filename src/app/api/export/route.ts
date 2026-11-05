import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { goalInclude } from '@/lib/goal-serialize'

function toDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * GET /api/export — download all your data as a roadmap JSON file
 * (same format /api/import accepts, plus current progress & history).
 * Dependencies and routine→checkpoint links are written as human-readable
 * titles so the file round-trips and stays hand-editable.
 */
export async function GET() {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const goals = await db.goal.findMany({
      where: { status: 'active', userId: auth.user.id },
      include: goalInclude,
      orderBy: { createdAt: 'asc' },
    })

    const out = {
      version: 1,
      exportedAt: new Date().toISOString(),
      goals: goals.map((g) => {
        // node lookup for dependency + focus refs
        const nodeById = new Map<string, { title: string; path: string; order: number }>()
        for (const p of g.skillPaths) {
          for (const n of p.nodes) nodeById.set(n.id, { title: n.title, path: p.title, order: n.order })
        }
        const nodeRef = (id: string): string | null => {
          const n = nodeById.get(id)
          if (!n) return null
          return n.path ? `${n.path} › ${n.title}` : n.title
        }
        return {
          title: g.title,
          description: g.description,
          emoji: g.emoji,
          color: g.color,
          category: g.category,
          type: g.type,
          targetValue: g.targetValue,
          unit: g.unit,
          weeklyTarget: g.weeklyTarget,
          deadline: g.deadline ? toDateString(g.deadline) : null,
          steps: g.steps.map((s) => ({
            title: s.title,
            notes: s.notes,
            done: s.status === 'done',
          })),
          paths: [...g.skillPaths]
            .sort((a, b) => a.order - b.order)
            .map((p) => ({
              title: p.title,
              description: p.description,
              icon: p.icon,
              unit: p.unit,
              nodes: [...p.nodes]
                .sort((a, b) => a.order - b.order)
                .map((n) => {
                  const deps = (n.requiresIds ? n.requiresIds.split(',').filter(Boolean) : [])
                    .map((id) => nodeRef(id))
                    .filter((x): x is string => !!x)
                    .map((ref) => {
                      // same-path dep: emit the bare title (unambiguous on re-import)
                      const [depPath, depTitle] = ref.split(' › ')
                      return depPath === p.title ? depTitle : ref
                    })
                  // derived checkpoint: always emit the fully-qualified source
                  // ref + factor — a bare title could resolve to a same-named
                  // node in another path, and the meter link must be unambiguous
                  let derive: { deriveFrom: string; derivePer: number } | undefined
                  if (n.deriveFromId && n.deriveFactor) {
                    const full = nodeRef(n.deriveFromId)
                    if (full) {
                      derive = {
                        deriveFrom: full,
                        derivePer: n.deriveFactor,
                      }
                    }
                  }
                  return {
                    title: n.title,
                    description: n.description,
                    icon: n.icon,
                    current: n.currentValue,
                    target: n.targetValue,
                    unit: n.unit,
                    xp: n.xpValue,
                    ...(deps.length ? { requires: deps } : {}),
                    ...(derive ? derive : {}),
                    milestones: [...n.milestones]
                      .sort((a, b) => a.value - b.value)
                      .map((m) => (m.label ? { value: m.value, label: m.label } : m.value)),
                  }
                }),
            })),
          routines: g.routines.map((r) => ({
            title: r.title,
            notes: r.notes,
            cadence: r.cadence,
            everyDays: r.everyNDays,
            weekdays: r.weekdays ? r.weekdays.split(',').map((x) => parseInt(x, 10)) : null,
            timesPerWeek: r.timesPerWeek,
            ...(r.nodeId ? { node: nodeRef(r.nodeId) ?? undefined } : {}),
            ...(r.nodeId && r.credit != null ? { credit: r.credit } : {}),
            durationMin: r.durationMin,
            startDate: toDateString(r.startDate),
            endDate: r.endDate ? toDateString(r.endDate) : null,
            dones: r.dones.map((d) => toDateString(d.date)),
            ...(r.optional ? { optional: true } : {}),
          })),
          notes: g.notes.map((n) => n.content),
          ...(g.pbs.length
            ? {
                pbs: g.pbs.map((pb) => ({
                  name: pb.name,
                  unit: pb.unit,
                  direction: pb.direction,
                  records: ((): Array<{ date: string; value: number; note: string | null }> => {
                    try {
                      const parsed = JSON.parse(pb.history)
                      if (!Array.isArray(parsed)) return []
                      return parsed
                        .filter(
                          (r): r is { date: string; value: number; note?: string | null } =>
                            typeof r?.date === 'string' && typeof r?.value === 'number',
                        )
                        .map((r) => ({
                          date: toDateString(new Date(r.date)),
                          value: r.value,
                          note: r.note ?? null,
                        }))
                    } catch {
                      return []
                    }
                  })(),
                })),
              }
            : {}),
          logs: g.logs.map((l) => ({
            date: toDateString(l.date),
            amount: l.amount,
            note: l.note,
          })),
        }
      }),
    }

    return new NextResponse(JSON.stringify(out, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="momentum-roadmap-${toDateString(new Date())}.json"`,
      },
    })
  } catch (e) {
    console.error('GET /api/export failed', e)
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 })
  }
}
