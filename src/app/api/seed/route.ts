import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { SEED_GOALS } from '@/lib/templates'
import { goalInclude, serializeGoal } from '@/lib/goal-serialize'
import {
  addDays,
  canonicalDayUtc,
  dayStart,
  occursOn,
  routineView,
  toDayKey,
  type RoutineView,
} from '@/lib/routine-math'
import type { RoutineData } from '@/lib/types'

const DAY_MS = 86_400_000

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS)
}

/** Deterministically pick which occurrences to pre-mark as done. */
function seedRoutineDones(rv: RoutineView, doneRatio: number, r: RoutineData): Date[] {
  const dones: Date[] = []
  const today = new Date()
  let i = 0
  for (let d = dayStart(rv.start); d <= dayStart(today); d = addDays(d, 1)) {
    if (!occursOn(rv, d)) continue
    i++
    // deterministic pseudo-random by index: earlier occurrences more likely done
    const hash = (i * 2654435761) % 100
    if (hash < doneRatio * 100) dones.push(new Date(d))
    else if (d < dayStart(today)) {
      // missed — stop marking later ones done to look realistic
      continue
    }
  }
  // ensure the most recent occurrence is done for a nice "streak" feel
  return dones
}

/** POST /api/seed — create sample goals with history (skips if goals exist). */
export async function POST() {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const existing = await db.goal.count({ where: { userId: auth.user.id } })
    if (existing > 0) {
      return NextResponse.json(
        { error: 'Demo data can only be loaded when no goals exist.' },
        { status: 409 },
      )
    }

    for (const g of SEED_GOALS) {
      const goal = await db.goal.create({
        data: {
          userId: auth.user.id,
          title: g.title,
          description: g.description,
          emoji: g.emoji,
          color: g.color,
          category: g.category,
          type: g.type,
          targetValue: 'targetValue' in g ? g.targetValue ?? null : null,
          unit: g.unit ?? null,
          weeklyTarget: g.weeklyTarget ?? null,
          deadline: new Date(new Date().getFullYear(), 11, 31, 23, 59, 59),
          createdAt: daysAgo(g.createdDaysAgo),
        },
      })
      for (const [i, s] of (g.steps ?? []).entries()) {
        await db.goalStep.create({
          data: {
            goalId: goal.id,
            title: s.title,
            order: i,
            status: s.status,
            completedAt: s.completedDaysAgo != null ? daysAgo(s.completedDaysAgo) : null,
          },
        })
      }
      for (const l of g.logs ?? []) {
        await db.progressLog.create({
          data: {
            goalId: goal.id,
            amount: l.amount,
            note: l.note ?? null,
            date: daysAgo(l.daysAgo),
          },
        })
      }
      for (const n of g.notes ?? []) {
        await db.goalNote.create({
          data: { goalId: goal.id, content: n.content, pinned: n.pinned ?? false },
        })
      }
      for (const [pi, p] of (g.paths ?? []).entries()) {
        await db.skillPath.create({
          data: {
            goalId: goal.id,
            title: p.title,
            icon: p.icon,
            unit: p.unit ?? null,
            order: pi,
            nodes: {
              create: p.nodes.map((n, i) => ({
                goalId: goal.id,
                title: n.title,
                description: n.description ?? null,
                order: i,
                currentValue: n.current,
                targetValue: n.target,
                xpValue: n.xp,
                completedAt: n.current >= n.target ? daysAgo(10) : null,
                milestones: {
                  create: (n.milestones ?? []).map((m) => ({
                    value: m,
                    label: null,
                    reachedAt: n.current >= m ? daysAgo(10) : null,
                  })),
                },
              })),
            },
          },
        })
      }
      for (const r of g.routines ?? []) {
        const created = await db.routineItem.create({
          data: {
            goalId: goal.id,
            title: r.title,
            notes: r.notes ?? null,
            cadence: r.cadence,
            everyNDays: r.cadence === 'interval' ? (r.everyNDays ?? 2) : null,
            weekdays: r.cadence === 'weekly' && r.weekdays ? [...r.weekdays].sort().join(',') : null,
            durationMin: r.durationMin ?? null,
            startDate: daysAgo(r.startedDaysAgo ?? 30),
          },
        })
        // pre-mark occurrences done
        const rd: RoutineData = {
          id: created.id,
          goalId: created.goalId,
          title: created.title,
          notes: created.notes,
          cadence: created.cadence as RoutineData['cadence'],
          everyNDays: created.everyNDays,
          weekdays: r.cadence === 'weekly' && r.weekdays ? [...r.weekdays].sort() : null,
          timesPerWeek: created.timesPerWeek,
          nodeId: created.nodeId,
          credit: created.credit,
          durationMin: created.durationMin,
          startDate: created.startDate.toISOString(),
          endDate: null,
          archived: false,
          optional: created.optional,
          createdAt: created.createdAt.toISOString(),
          dones: [],
        }
        const rv = routineView(rd, null)
        for (const d of seedRoutineDones(rv, r.doneRatio ?? 0.7, rd)) {
          await db.routineDone.create({
            // canonical UTC midnight of the calendar day — matches what the
            // check-off API writes, whatever timezone the server runs in
            data: { routineId: created.id, date: canonicalDayUtc(toDayKey(d)) },
          })
        }
      }
    }

    const goals = await db.goal.findMany({
      where: { userId: auth.user.id },
      include: goalInclude,
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ goals: goals.map(serializeGoal) }, { status: 201 })
  } catch (e) {
    console.error('POST /api/seed failed', e)
    return NextResponse.json({ error: 'Failed to seed demo data' }, { status: 500 })
  }
}
