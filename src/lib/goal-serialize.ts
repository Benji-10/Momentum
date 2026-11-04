import type { Goal, GoalNote, GoalStep, PersonalBest, Prisma, ProgressLog, RoutineDone, RoutineItem, SkillMilestone, SkillNode, SkillPath } from '@prisma/client'
import type { GoalData, PbRecordData } from './types'
import { parseWeekdaysCsv } from './skill-tree'

function parseIdsCsv(csv: string | null): string[] {
  if (!csv) return []
  return csv.split(',').map((s) => s.trim()).filter(Boolean)
}

/** Parse a PersonalBest `history` JSON column; corrupt rows degrade to []. */
function parsePbHistory(history: string): PbRecordData[] {
  try {
    const parsed = JSON.parse(history)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (r): r is { id: string; date: string; value: number; note?: string | null } =>
          typeof r?.id === 'string' &&
          typeof r?.date === 'string' &&
          typeof r?.value === 'number' &&
          Number.isFinite(r.value),
      )
      .map((r) => ({ id: r.id, date: r.date, value: r.value, note: r.note ?? null }))
  } catch {
    return []
  }
}

/** Shared Prisma include so every endpoint returns the same goal shape. */
export const goalInclude = {
  steps: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
  logs: { orderBy: { date: 'desc' } },
  notes: { orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }] },
  routines: { include: { dones: true }, orderBy: { createdAt: 'asc' } },
  pbs: { orderBy: { createdAt: 'asc' } },
  skillPaths: {
    include: {
      nodes: { include: { milestones: true }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  } as const,
} satisfies Prisma.GoalInclude

type GoalWithRelations = Goal & {
  steps: GoalStep[]
  logs: ProgressLog[]
  notes: GoalNote[]
  routines: (RoutineItem & { dones: RoutineDone[] })[]
  pbs: PersonalBest[]
  skillPaths: (SkillPath & { nodes: (SkillNode & { milestones: SkillMilestone[] })[] })[]
}

/** Convert a Prisma goal (with relations) into the JSON shape the client expects. */
export function serializeGoal(goal: GoalWithRelations): GoalData {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    emoji: goal.emoji,
    color: goal.color,
    category: goal.category,
    type: goal.type as GoalData['type'],
    targetValue: goal.targetValue,
    unit: goal.unit,
    weeklyTarget: goal.weeklyTarget,
    deadline: goal.deadline?.toISOString() ?? null,
    status: goal.status as GoalData['status'],
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    steps: goal.steps.map((s) => ({
      id: s.id,
      goalId: s.goalId,
      title: s.title,
      notes: s.notes,
      order: s.order,
      status: s.status as GoalData['steps'][number]['status'],
      completedAt: s.completedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
    logs: goal.logs.map((l) => ({
      id: l.id,
      goalId: l.goalId,
      date: l.date.toISOString(),
      amount: l.amount,
      note: l.note,
      createdAt: l.createdAt.toISOString(),
    })),
    notes: goal.notes.map((n) => ({
      id: n.id,
      goalId: n.goalId,
      content: n.content,
      pinned: n.pinned,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    })),
    routines: goal.routines.map((r) => ({
      id: r.id,
      goalId: r.goalId,
      title: r.title,
      notes: r.notes,
      cadence: r.cadence as 'interval' | 'weekly' | 'flexible',
      everyNDays: r.everyNDays,
      weekdays: r.weekdays ? parseWeekdaysCsv(r.weekdays) : null,
      timesPerWeek: r.timesPerWeek,
      nodeId: r.nodeId,
      credit: r.credit,
      durationMin: r.durationMin,
      startDate: r.startDate.toISOString(),
      endDate: r.endDate?.toISOString() ?? null,
      archived: r.archived,
      createdAt: r.createdAt.toISOString(),
      dones: r.dones.map((d) => ({
        id: d.id,
        routineId: d.routineId,
        // calendar day ("YYYY-MM-DD") — parsed back as *local* midnight on the
        // client, so a check-off shows on the same day in every timezone.
        // (Stored canonically as UTC midnight of that day.)
        date: d.date.toISOString().slice(0, 10),
        creditedValue: d.creditedValue,
      })),
    })),
    pbs: goal.pbs.map((pb) => ({
      id: pb.id,
      goalId: pb.goalId,
      name: pb.name,
      unit: pb.unit,
      direction: pb.direction as 'up' | 'down',
      records: parsePbHistory(pb.history),
      createdAt: pb.createdAt.toISOString(),
      updatedAt: pb.updatedAt.toISOString(),
    })),
    skillPaths: goal.skillPaths.map((p) => ({
      id: p.id,
      goalId: p.goalId,
      title: p.title,
      description: p.description,
      icon: p.icon,
      unit: p.unit,
      order: p.order,
      createdAt: p.createdAt.toISOString(),
      nodes: p.nodes.map((n) => ({
        id: n.id,
        goalId: n.goalId,
        pathId: n.pathId,
        title: n.title,
        description: n.description,
        icon: n.icon,
        order: n.order,
        currentValue: n.currentValue,
        targetValue: n.targetValue,
        unit: n.unit,
        xpValue: n.xpValue,
        requiresIds: parseIdsCsv(n.requiresIds),
        completedAt: n.completedAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
        milestones: n.milestones.map((m) => ({
          id: m.id,
          nodeId: m.nodeId,
          value: m.value,
          label: m.label,
          reachedAt: m.reachedAt?.toISOString() ?? null,
        })),
      })),
    })),
  }
}
