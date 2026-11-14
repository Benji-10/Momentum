'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CloudOff } from 'lucide-react'
import { toast } from 'sonner'
import type { CreateGoalInput, GoalData, MergeSummary, PbNodeCreditData, RoutineDoneData, StepStatus } from '@/lib/types'
import type { NormalizedImport } from '@/lib/import-format'
import { dayKeyOf, todayDayKey } from '@/lib/app-time'
import { parseDayKey } from '@/lib/routine-math'
import { apiFetch } from '@/lib/api-client'
import {
  currentIdentityUser,
} from '@/lib/identity-client'
import {
  applyQueuedDones,
  isNetworkError,
  isOfflineQueuedError,
  loadGoalsCache,
  queuedOps,
  saveGoalsCache,
  setServingFromCache,
} from '@/lib/offline'

function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(url, init)
}

export function useGoals() {
  return useQuery({
    queryKey: ['goals'],
    queryFn: async () => {
      // whatever data we show, the queued check-offs layer on top so the
      // list reflects "what will sync" — a tick made offline survives an
      // offline reload instead of vanishing until the connection returns
      const overlay = (goals: GoalData[]) => applyQueuedDones(goals, queuedOps())
      try {
        const d = await jsonFetch<{ goals: GoalData[] }>('/api/goals')
        // snapshot for offline use — the list survives a dropped connection
        const user = await currentIdentityUser()
        saveGoalsCache(d.goals, user?.id ?? null)
        setServingFromCache(false)
        return { goals: overlay(d.goals) }
      } catch (e) {
        if (isNetworkError(e)) {
          const cached = loadGoalsCache()
          if (cached) {
            // no connection: serve the last synced snapshot (with the
            // pending queue applied) — the schedule and dashboard keep
            // working, and check-offs queue up
            setServingFromCache(true)
            return { goals: overlay(cached.goals) }
          }
        }
        throw e
      }
    },
    select: (d) => d.goals,
  })
}

export function useCreateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateGoalInput) =>
      jsonFetch<{ goal: GoalData }>('/api/goals', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

interface UpdateGoalPatch {
  title?: string
  description?: string | null
  emoji?: string
  color?: string
  category?: string | null
  unit?: string | null
  targetValue?: number | null
  weeklyTarget?: number | null
  deadline?: string | null
  status?: 'active' | 'archived'
}

export function useUpdateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateGoalPatch }) =>
      jsonFetch<{ goal: GoalData }>(`/api/goals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useDeleteGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => jsonFetch<{ ok: boolean }>(`/api/goals/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

// ---------------- steps ----------------

export function useAddStep(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ title }: { title: string }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/steps`, {
        method: 'POST',
        body: JSON.stringify({ title }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useUpdateStep(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      stepId,
      patch,
    }: {
      stepId: string
      patch: {
        title?: string
        status?: StepStatus
        move?: 'up' | 'down'
        notes?: string | null
        /** target date: undefined = keep · null = clear · ISO = set */
        dueDate?: string | null
        trigger?: 'manual' | 'routine' | 'metric'
        routineId?: string | null
        triggerCount?: number
        metricName?: string | null
        metricWindow?: number | null
        metricOp?: 'under' | 'over' | null
        metricValue?: number | null
      }
    }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/steps/${stepId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useDeleteStep(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stepId: string) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/steps/${stepId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

// ---------------- logs ----------------

export function useAddLog(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ amount, note, date }: { amount: number; note?: string | null; date?: string }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/logs`, {
        method: 'POST',
        body: JSON.stringify({ amount, note: note || null, date }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useDeleteLog(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (logId: string) =>
      jsonFetch<{ ok: boolean }>(`/api/goals/${goalId}/logs/${logId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

/** Fix up an entry after the fact — e.g. you checked off "work 2 hours"
 * but only worked 50 minutes, or the session was actually on Tuesday. */
export function useUpdateLog(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      logId,
      amount,
      note,
      date,
    }: {
      logId: string
      amount: number
      note?: string | null
      /** new ISO instant — only sent when the day actually changed */
      date?: string
    }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/logs/${logId}`, {
        method: 'PATCH',
        body: JSON.stringify({ amount, note: note ?? null, ...(date ? { date } : {}) }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

// ---------------- notes ----------------

export function useAddNote(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ content, pinned }: { content: string; pinned?: boolean }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content, pinned }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useUpdateNote(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ noteId, patch }: { noteId: string; patch: { content?: string; pinned?: boolean } }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/notes/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useDeleteNote(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noteId: string) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/notes/${noteId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

// ---------------- routines ----------------

export interface RoutineInputPayload {
  title: string
  notes?: string | null
  cadence?: 'interval' | 'weekly' | 'flexible'
  everyNDays?: number | null
  weekdays?: number[] | null
  timesPerWeek?: number | null
  nodeId?: string | null
  credit?: number | null
  durationMin?: number | null
  startDate?: string | null
  endDate?: string | null
  /** the plan step this routine works toward (null = unlink, undefined = keep) */
  stepId?: string | null
  /** how many check-offs of this routine complete the linked step */
  stepCount?: number | null
}

export function useAddRoutine(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RoutineInputPayload) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/routines`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useUpdateRoutine(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      routineId,
      patch,
    }: {
      routineId: string
      patch: Partial<RoutineInputPayload> & { archived?: boolean }
    }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/routines/${routineId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useDeleteRoutine(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ routineId }: { routineId: string }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/routines/${routineId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

type GoalsCache = { goals: GoalData[] }

/** Rewrite a routine's dones array inside the ['goals'] cache. */
function withRoutineDones(
  cache: GoalsCache,
  goalId: string,
  routineId: string,
  next: (dones: RoutineDoneData[]) => RoutineDoneData[],
): GoalsCache {
  return {
    ...cache,
    goals: cache.goals.map((g) =>
      g.id !== goalId
        ? g
        : {
            ...g,
            routines: g.routines.map((r) => (r.id !== routineId ? r : { ...r, dones: next(r.dones) })),
          },
    ),
  }
}

/** Does this done mark belong to the given calendar day? (wire format is
 * "YYYY-MM-DD"; legacy full-ISO rows are normalized before comparing.) */
function doneIsOnDay(d: RoutineDoneData, dayKey: string): boolean {
  return dayKeyOf(parseDayKey(d.date)) === dayKey
}

export function useToggleRoutineDone() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ goalId, routineId, date, undo }: { goalId: string; routineId: string; date?: string; undo?: boolean }) =>
      jsonFetch<{
        goal: GoalData | null
        creditSkipped: boolean
        autoLog?: { id: string; amount: number; unit: string | null; note: string | null } | null
        removedLog?: boolean
        /** plan steps completed by this check-off (automation) */
        stepsAdvanced?: { id: string; title: string }[]
        /** plan steps re-opened by this undo (automation) */
        stepsReverted?: { id: string; title: string }[]
      }>(`/api/goals/${goalId}/routines/${routineId}/done`, {
        method: 'POST',
        body: JSON.stringify({ date, undo }),
      }),
    /**
     * Optimistic check-off: the tick (or untick) shows immediately and the
     * server syncs in the background. If the save fails we roll this one
     * routine back and say so — the user should never wait on the network
     * to see their own tap.
     */
    onMutate: async ({ goalId, routineId, date, undo }) => {
      await qc.cancelQueries({ queryKey: ['goals'] })
      const prev = qc.getQueryData<GoalsCache>(['goals'])
      if (!prev) return { prev: null }
      const dayKey = date ?? todayDayKey()
      qc.setQueryData<GoalsCache>(['goals'], (cur) => {
        if (!cur) return cur
        return withRoutineDones(cur, goalId, routineId, (dones) =>
          undo
            ? dones.filter((d) => !doneIsOnDay(d, dayKey))
            : dones.some((d) => doneIsOnDay(d, dayKey))
              ? dones // already ticked (double-tap) — nothing to add
              : [
                  ...dones,
                  { id: `optimistic-${routineId}-${dayKey}`, routineId, date: dayKey, creditedValue: null, logId: null, advancedStepId: null },
                ],
        )
      })
      return { prev }
    },
    onError: (e, { goalId, routineId }, ctx) => {
      if (isOfflineQueuedError(e)) {
        // no connection, but the tap counts: keep the optimistic tick on
        // screen — the queued op replays when the network returns
        toast('Checked off offline', {
          icon: <CloudOff className="h-4 w-4 text-amber-500" />,
          description: 'It will sync to your account when you reconnect.',
        })
        return
      }
      // roll back just this routine's dones to the pre-tap snapshot — other
      // goals / routines that changed meanwhile stay as they are
      if (ctx?.prev) {
        const before = ctx.prev.goals
          .find((g) => g.id === goalId)
          ?.routines.find((r) => r.id === routineId)?.dones
        if (before) {
          qc.setQueryData<GoalsCache>(['goals'], (cur) =>
            cur ? withRoutineDones(cur, goalId, routineId, () => before) : cur,
          )
        }
      }
      toast.error("Couldn't save that", {
        description: e instanceof Error ? `${e.message} — your check-off was undone, try again.` : 'The check-off was undone — try again.',
      })
    },
    /** Server truth replaces the optimistic state (real done id, auto-log
     * entry, skill-tree credit) without a refetch round-trip flicker. */
    onSuccess: (res) => {
      if (res.goal) {
        qc.setQueryData<GoalsCache>(['goals'], (cur) =>
          cur ? { ...cur, goals: cur.goals.map((g) => (g.id === res.goal!.id ? res.goal! : g)) } : cur,
        )
      } else {
        qc.invalidateQueries({ queryKey: ['goals'] })
      }
    },
  })
}

// ---------------- skill paths & nodes ----------------

export interface SkillNodeInputPayload {
  title: string
  description?: string | null
  icon?: string
  currentValue?: number
  targetValue: number
  unit?: string | null
  xpValue?: number
  afterOrder?: number
  milestones?: (number | { value: number; label?: string | null })[]
}

export function useAddPath(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      title,
      icon,
      unit,
      nodes,
    }: {
      title: string
      icon?: string
      unit?: string | null
      nodes?: SkillNodeInputPayload[]
    }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/paths`, {
        method: 'POST',
        body: JSON.stringify({ title, icon, unit, nodes }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useUpdatePath(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      pathId,
      patch,
    }: {
      pathId: string
      patch: {
        title?: string
        description?: string | null
        icon?: string
        unit?: string | null
        move?: 'left' | 'right'
      }
    }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/paths/${pathId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useDeletePath(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pathId }: { pathId: string }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/paths/${pathId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useAddNode(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      pathId,
      input,
    }: {
      pathId: string
      input: Omit<SkillNodeInputPayload, 'afterOrder'> & { afterOrder?: number }
    }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/paths/${pathId}/nodes`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useUpdateNode(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      nodeId,
      patch,
    }: {
      nodeId: string
      patch: {
        title?: string
        description?: string | null
        icon?: string
        add?: number
        currentValue?: number
        targetValue?: number
        unit?: string | null
        xpValue?: number
        mastered?: boolean
        move?: 'up' | 'down'
        /** redefine sub-checkpoints: [50, {value: 100, label: "First 100"}] */
        milestones?: (number | { value: number; label?: string | null })[]
        /** unlock gating: ids that must be mastered first (null/[] = default ladder) */
        requiresIds?: string[] | null
        /** derivation: source node id + source units per 1 of this node */
        deriveFromId?: string | null
        deriveFactor?: number | null
      }
    }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/nodes/${nodeId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useDeleteNode(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/nodes/${nodeId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

// ---------------- personal bests ----------------

export function useAddPb(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      name: string
      unit?: string | null
      direction?: 'up' | 'down'
      firstValue?: number | null
      firstDate?: string | null
      /** roadmap link: the checkpoint this metric feeds */
      nodeId?: string | null
      nodeMode?: 'sum' | 'average' | null
      nodeWindow?: number | null
    }) =>
      jsonFetch<{ goal: GoalData | null; nodeCredit?: PbNodeCreditData | null }>(`/api/goals/${goalId}/pbs`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useUpdatePb(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      pbId,
      patch,
    }: {
      pbId: string
      patch: {
        name?: string
        unit?: string | null
        direction?: 'up' | 'down'
        nodeId?: string | null
        nodeMode?: 'sum' | 'average' | null
        nodeWindow?: number | null
      }
    }) =>
      jsonFetch<{ goal: GoalData | null; nodeCredit?: PbNodeCreditData | null }>(`/api/goals/${goalId}/pbs/${pbId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useDeletePb(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pbId }: { pbId: string }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/pbs/${pbId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useAddPbRecord(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pbId, value, date, note }: { pbId: string; value: number; date?: string; note?: string | null }) =>
      jsonFetch<{
        goal: GoalData | null
        stepsAdvanced?: { id: string; title: string }[]
        nodeCredit?: PbNodeCreditData | null
      }>(`/api/goals/${goalId}/pbs/${pbId}/records`, {
        method: 'POST',
        body: JSON.stringify({ value, date, note: note || null }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

/** Fix one attempt after the fact — "I actually jumped 1.82, not 1.28". */
export function useUpdatePbRecord(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      pbId,
      recordId,
      value,
      date,
      note,
    }: {
      pbId: string
      recordId: string
      value: number
      /** new ISO instant — only sent when the day actually changed */
      date?: string
      note?: string | null
    }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/pbs/${pbId}/records/${recordId}`, {
        method: 'PATCH',
        body: JSON.stringify({ value, note: note ?? null, ...(date ? { date } : {}) }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useDeletePbRecord(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pbId, recordId }: { pbId: string; recordId: string }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/pbs/${pbId}/records/${recordId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

// ---------------- import / export / seed ----------------

export interface ImportResponse {
  goals: GoalData[]
  created: number
  updated?: number
  summary?: MergeSummary
}

export function useImportGoals() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ data, mode }: { data: unknown; mode?: 'create' | 'merge' }) =>
      jsonFetch<ImportResponse>(`/api/import${mode === 'merge' ? '?mode=merge' : ''}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useGoalScopeImport(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (raw: unknown) =>
      jsonFetch<{
        goal: GoalData | null
        added: { steps: number; paths: number; routines: number }
        summary?: MergeSummary
      }>(`/api/goals/${goalId}/import`, { method: 'POST', body: JSON.stringify(raw) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

// ---------------- danger zone ----------------

export interface DangerStats {
  goals?: number
  goalsDeleted?: number
  nodesReset?: number
  milestonesReset?: number
  stepsReset?: number
  routines?: number
  donesDeleted?: number
  logsDeleted?: number
  pbRecordsCleared?: number
}

/** Reset all progress, or wipe every goal — the typed confirmation word
 *  ("RESET" / "WIPE") is validated by the server too. */
export function useDangerAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { action: 'reset-progress' | 'wipe-all'; confirm: string }) =>
      jsonFetch<{ ok: true; action: string; stats: DangerStats }>('/api/danger', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export function useSeedDemo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => jsonFetch<{ goals: GoalData[] }>('/api/seed', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

// ---------------- bulk create ----------------

export interface BulkGoalInput {
  title: string
  description?: string | null
  emoji?: string
  color?: string
  category?: string | null
  type?: 'quantitative' | 'plan'
  targetValue?: number | null
  unit?: string | null
  weeklyTarget?: number | null
  deadline?: string | null
  steps?: { title: string }[]
}

export function useBulkCreateGoals() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (goals: BulkGoalInput[]) =>
      jsonFetch<{ goals: GoalData[]; created: number }>('/api/goals/bulk', {
        method: 'POST',
        body: JSON.stringify({ goals }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })
}

export type { NormalizedImport }
