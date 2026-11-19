'use client'

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { CloudOff } from 'lucide-react'
import { toast } from 'sonner'
import type {
  CreateGoalInput,
  GoalData,
  GoalNoteData,
  GoalStepData,
  MergeSummary,
  PbNodeCreditData,
  ProgressLogData,
  PbRecordData,
  RoutineDoneData,
  SkillNodeData,
  StepStatus,
} from '@/lib/types'
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

// ---------------------------------------------------------------------------
// optimistic goal writes
//
// Every quick interaction (tick a step, reorder, log an entry, …) paints its
// result into the ['goals'] cache IMMEDIATELY; the server confirms in the
// background. Rules:
//
//  - onMutate  → patch the one goal inside the cache (snapshot kept for
//                rollback), cancel in-flight refetches so they can't land
//                over the optimistic state
//  - onSuccess → swap in the server's goal — but only when no other write
//                for that goal is still in flight: an earlier response
//                doesn't know about later local patches and would clobber
//                them (rapid reordering would visibly flicker)
//  - onError   → offline-queued keeps the optimistic state (it will replay);
//                a real error rolls the goal back to its pre-patch state
// ---------------------------------------------------------------------------

type GoalsCacheShape = { goals: GoalData[] }

const inFlightGoalWrites = new Map<string, number>()

interface GoalWriteCtx {
  goalId: string
  prevGoal?: GoalData
}

function tempId(prefix: string) {
  return `optimistic-${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Creates that are still on their way to the server, keyed by the
 *  client-generated id they will be created under. */
const pendingCreates = new Map<string, Promise<unknown>>()

/** A follow-up write on a client-generated id (move the step you just
 *  added, pin the note you just wrote) waits for its create to land first —
 *  the server would otherwise 404 the child before the parent exists. A
 *  create that failed offline needs no wait: both ops go into the offline
 *  queue in order and replay create-first. */
function waitForCreate(id: string | null | undefined): Promise<void> {
  if (!id || !id.startsWith('optimistic-')) return Promise.resolve()
  const p = pendingCreates.get(id)
  if (!p) return Promise.resolve() // already settled (or never ours)
  return p.then(
    () => undefined,
    () => undefined,
  )
}

/** Register a create's promise so follow-ups on the same id can wait. */
function trackCreate(id: string, p: Promise<unknown>): Promise<unknown> {
  pendingCreates.set(id, p)
  return p.finally(() => {
    if (pendingCreates.get(id) === p) pendingCreates.delete(id)
  })
}

function beginGoalWrite(qc: QueryClient, goalId: string | null, patch: (g: GoalData) => GoalData): GoalWriteCtx {
  const id = goalId ?? ''
  inFlightGoalWrites.set(id, (inFlightGoalWrites.get(id) ?? 0) + 1)
  void qc.cancelQueries({ queryKey: ['goals'] })
  const cur = qc.getQueryData<GoalsCacheShape>(['goals'])
  const prevGoal = goalId ? cur?.goals.find((g) => g.id === goalId) : undefined
  if (cur && prevGoal) {
    qc.setQueryData<GoalsCacheShape>(['goals'], {
      goals: cur.goals.map((g) => (g.id === goalId ? patch(g) : g)),
    })
  }
  return { goalId: id, prevGoal }
}

function settleGoalWrite(qc: QueryClient, ctx: GoalWriteCtx, serverGoal: GoalData | null | undefined) {
  const n = (inFlightGoalWrites.get(ctx.goalId) ?? 1) - 1
  if (n > 0) {
    inFlightGoalWrites.set(ctx.goalId, n)
    return
  }
  inFlightGoalWrites.delete(ctx.goalId)
  if (serverGoal) {
    qc.setQueryData<GoalsCacheShape>(['goals'], (cur) =>
      cur ? { goals: cur.goals.map((g) => (g.id === serverGoal.id ? serverGoal : g)) } : cur,
    )
  } else {
    void qc.invalidateQueries({ queryKey: ['goals'] })
  }
}

function failGoalWrite(qc: QueryClient, ctx: GoalWriteCtx, e: unknown, what: string) {
  const n = (inFlightGoalWrites.get(ctx.goalId) ?? 1) - 1
  if (n > 0) inFlightGoalWrites.set(ctx.goalId, n)
  else inFlightGoalWrites.delete(ctx.goalId)

  if (isOfflineQueuedError(e)) {
    // saved on this device — the optimistic change stays on screen and
    // replays when the connection returns
    toast('Saved offline', {
      icon: <CloudOff className="h-4 w-4 text-amber-500" />,
      description: 'No connection right now — this change stays on this device and will sync when you reconnect.',
    })
    return
  }
  if (n > 0) {
    // other writes are still in flight for this goal — restoring this
    // write's snapshot would clobber their optimistic state; the server
    // truth from the last settle reconciles everything
    void qc.invalidateQueries({ queryKey: ['goals'] })
    toast.error(`Couldn't ${what}`, { description: e instanceof Error ? e.message : 'Please try again.' })
    return
  }
  if (ctx.prevGoal) {
    const restore = ctx.prevGoal
    qc.setQueryData<GoalsCacheShape>(['goals'], (cur) =>
      cur ? { goals: cur.goals.map((g) => (g.id === restore.id ? restore : g)) } : cur,
    )
  }
  toast.error(`Couldn't ${what}`, {
    description: e instanceof Error ? `${e.message} — your change was undone, try again.` : 'Your change was undone — try again.',
  })
}

/** Swap a step (or node) with its neighbour and return the list in its NEW
 * order — positions swapped and renumbered 0..n-1, matching what the server
 * sends back (the steps list renders in raw array order, so both the
 * position and the order value must move). */
function movedInOrder<T extends { id: string; order: number }>(items: T[], id: string, dir: 'up' | 'down'): T[] {
  const sorted = [...items].sort((a, b) => a.order - b.order)
  const i = sorted.findIndex((s) => s.id === id)
  const j = dir === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= sorted.length) return items
  const reordered = [...sorted]
  const tmp = reordered[i]
  reordered[i] = reordered[j]
  reordered[j] = tmp
  return reordered.map((s, idx) => ({ ...s, order: idx }))
}

function withStepPatched(goal: GoalData, stepId: string, patch: Record<string, unknown>): GoalData {
  return {
    ...goal,
    steps: goal.steps.map((s): GoalStepData => {
      if (s.id !== stepId) return s
      const next: GoalStepData = { ...s }
      if (typeof patch.title === 'string') next.title = patch.title
      if ('notes' in patch) next.notes = (patch.notes as string | null) ?? null
      if ('status' in patch && patch.status !== undefined) {
        next.status = patch.status as StepStatus
        next.completedAt = next.status === 'done' ? new Date().toISOString() : null
      }
      if ('dueDate' in patch) next.dueDate = (patch.dueDate as string | null) ?? null
      if ('trigger' in patch && patch.trigger !== undefined) next.trigger = patch.trigger as GoalStepData['trigger']
      if ('routineId' in patch) next.routineId = (patch.routineId as string | null) ?? null
      if ('triggerCount' in patch && patch.triggerCount !== undefined) next.triggerCount = patch.triggerCount as number
      if ('metricName' in patch) next.metricName = (patch.metricName as string | null) ?? null
      if ('metricWindow' in patch) next.metricWindow = (patch.metricWindow as number | null) ?? null
      if ('metricOp' in patch && patch.metricOp !== undefined) next.metricOp = patch.metricOp as GoalStepData['metricOp']
      if ('metricValue' in patch) next.metricValue = (patch.metricValue as number | null) ?? null
      return next
    }),
  }
}

function withNodePatched(goal: GoalData, nodeId: string, patch: Record<string, unknown>): GoalData {
  return {
    ...goal,
    skillPaths: goal.skillPaths.map((p) => ({
      ...p,
      nodes: p.nodes.map((n): SkillNodeData => {
        if (n.id !== nodeId) return n
        const next: SkillNodeData = { ...n }
        if (typeof patch.title === 'string') next.title = patch.title
        if ('description' in patch) next.description = (patch.description as string | null) ?? null
        if (typeof patch.icon === 'string') next.icon = patch.icon
        if (typeof patch.add === 'number') next.currentValue += patch.add
        if (typeof patch.currentValue === 'number') next.currentValue = patch.currentValue
        if (typeof patch.targetValue === 'number') next.targetValue = patch.targetValue
        if ('unit' in patch) next.unit = (patch.unit as string | null) ?? null
        if (typeof patch.xpValue === 'number') next.xpValue = patch.xpValue
        if (typeof patch.mastered === 'boolean') next.completedAt = patch.mastered ? new Date().toISOString() : null
        return next
      }),
    })),
  }
}

export function useGoals() {
  const qc = useQueryClient()
  // Post-hydration cache seed: the moment hydration finishes, the last
  // synced snapshot (plus queued check-offs) is dropped into the ['goals']
  // cache so the app paints instantly — the fetch triggered by the empty
  // mount keeps running and reconciles with the server when it lands.
  // (NOT initialData: that would render during hydration and mismatch the
  // server's loading shell.)
  useEffect(() => {
    const cached = loadGoalsCache()
    if (cached && !qc.getQueryData(['goals'])) {
      // updatedAt: 0 — the seed is "always stale", so react-query's
      // mount-fetch decision (which may run after this effect) still sends
      // the request: the cache is the first paint, never the truth
      qc.setQueryData(
        ['goals'],
        { goals: applyQueuedDones(cached.goals, queuedOps()) },
        { updatedAt: 0 },
      )
    }
  }, [qc])
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
  hideDoneSteps?: boolean
}

export function useUpdateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateGoalPatch }) =>
      jsonFetch<{ goal: GoalData }>(`/api/goals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    // optimistic: the edit (title, weekly target, hide-done, archive…)
    // paints immediately; the server confirms in the background
    onMutate: ({ id, patch }) =>
      beginGoalWrite(qc, id, (g) => ({
        ...g,
        ...('title' in patch ? { title: patch.title! } : {}),
        ...('description' in patch ? { description: patch.description ?? null } : {}),
        ...('emoji' in patch ? { emoji: patch.emoji! } : {}),
        ...('color' in patch ? { color: patch.color! } : {}),
        ...('category' in patch ? { category: patch.category ?? null } : {}),
        ...('unit' in patch ? { unit: patch.unit ?? null } : {}),
        ...('targetValue' in patch ? { targetValue: patch.targetValue ?? null } : {}),
        ...('weeklyTarget' in patch ? { weeklyTarget: patch.weeklyTarget ?? null } : {}),
        ...('deadline' in patch ? { deadline: patch.deadline ?? null } : {}),
        ...('status' in patch ? { status: patch.status! } : {}),
        ...('hideDoneSteps' in patch ? { hideDoneSteps: patch.hideDoneSteps! } : {}),
      })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'save the goal'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
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
  const mutation = useMutation({
    mutationFn: ({ title, id }: { title: string; id: string }) =>
      trackCreate(
        id,
        jsonFetch<{ step: { id: string } }>(`/api/goals/${goalId}/steps`, {
          method: 'POST',
          body: JSON.stringify({ title, id }),
        }),
      ) as Promise<{ step: { id: string } }>,
    // optimistic: the step appears at the end of the plan immediately, under
    // its client-generated id — moves/edits on it are valid from the start
    onMutate: ({ title, id }) =>
      beginGoalWrite(qc, goalId, (g) => ({
        ...g,
        steps: [
          ...g.steps,
          {
            id,
            goalId: g.id,
            title,
            notes: null,
            order: g.steps.reduce((m, s) => Math.max(m, s.order), -1) + 1,
            status: 'pending',
            completedAt: null,
            dueDate: null,
            trigger: 'manual',
            routineId: null,
            triggerCount: 1,
            metricName: null,
            metricWindow: null,
            metricOp: null,
            metricValue: null,
            currentSince: null,
            createdAt: new Date().toISOString(),
          },
        ],
      })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'add the step'),
    // this route answers with the step, not the goal — reconcile via refetch
    onSuccess: (_res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, undefined),
  })
  // the public mutate gets a client-generated id injected, so callers
  // stay as simple as mutate({ title })
  return {
    ...mutation,
    mutate: (vars: { title: string }, opts?: Parameters<typeof mutation.mutate>[1]) =>
      mutation.mutate({ ...vars, id: tempId('step') }, opts),
  }
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
      // a step that was just added optimistically may still be on its way
      // to the server — wait for the create before patching it
      waitForCreate(stepId).then(() =>
        jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/steps/${stepId}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),
      ),
    // optimistic: ticks, renames and reorders show instantly — no waiting
    // on the network to see your own tap
    onMutate: ({ stepId, patch }) =>
      beginGoalWrite(qc, goalId, (g) => {
        let out = patch.move ? { ...g, steps: movedInOrder(g.steps, stepId, patch.move) } : g
        const rest: Record<string, unknown> = { ...patch }
        delete rest.move
        if (Object.keys(rest).length > 0) out = withStepPatched(out, stepId, rest)
        return out
      }),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'update the step'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
  })
}

export function useDeleteStep(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (stepId: string) =>
      waitForCreate(stepId).then(() =>
        jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/steps/${stepId}`, {
          method: 'DELETE',
        }),
      ),
    // optimistic: the step leaves the list immediately
    onMutate: (stepId) => beginGoalWrite(qc, goalId, (g) => ({ ...g, steps: g.steps.filter((s) => s.id !== stepId) })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'remove the step'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
  })
}

// ---------------- logs ----------------

export function useAddLog(goalId: string | null) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, amount, note, date, unit, nodeId }: { id: string; amount: number; note?: string | null; date?: string; unit?: string | null; nodeId?: string | null }) =>
      trackCreate(
        id,
        jsonFetch<{
          log: { id: string; amount: number; unit: string | null; note: string | null }
          goal: GoalData | null
        }>(`/api/goals/${goalId}/logs`, {
          method: 'POST',
          body: JSON.stringify({ id, amount, note: note || null, date, unit: unit ?? null, nodeId: nodeId ?? null }),
        }),
      ) as Promise<{
        log: { id: string; amount: number; unit: string | null; note: string | null }
        goal: GoalData | null
      }>,
    // optimistic: the entry lands in the ledger (and every derived progress
    // number that reads it) immediately, under its client-generated id
    onMutate: ({ id, amount, note, date, unit, nodeId }) =>
      beginGoalWrite(qc, goalId, (g) => ({
        ...g,
        logs: [
          ...g.logs,
          {
            id,
            goalId: g.id,
            date: date ?? new Date().toISOString(),
            amount,
            note: note ?? null,
            unit: unit ?? null,
            nodeId: nodeId ?? null,
            pbId: null,
            createdAt: new Date().toISOString(),
          },
        ],
      })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'log the entry'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
  })
  return {
    ...mutation,
    mutate: (
      vars: { amount: number; note?: string | null; date?: string; unit?: string | null; nodeId?: string | null },
      opts?: Parameters<typeof mutation.mutate>[1],
    ) => mutation.mutate({ ...vars, id: tempId('log') }, opts),
  }
}

export function useDeleteLog(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (logId: string) =>
      waitForCreate(logId).then(() =>
        jsonFetch<{ ok: boolean }>(`/api/goals/${goalId}/logs/${logId}`, {
          method: 'DELETE',
        }),
      ),
    // optimistic: the entry leaves the ledger immediately
    onMutate: (logId) => beginGoalWrite(qc, goalId, (g) => ({ ...g, logs: g.logs.filter((l) => l.id !== logId) })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'remove the entry'),
    // the DELETE response carries no goal — reconcile via a background refetch
    onSuccess: (_res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, undefined),
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
      waitForCreate(logId).then(() =>
        jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/logs/${logId}`, {
          method: 'PATCH',
          body: JSON.stringify({ amount, note: note ?? null, ...(date ? { date } : {}) }),
        }),
      ),
    // optimistic: the corrected amount/day/note shows immediately
    onMutate: ({ logId, amount, note, date }) =>
      beginGoalWrite(qc, goalId, (g) => ({
        ...g,
        logs: g.logs.map((l): ProgressLogData =>
          l.id !== logId
            ? l
            : {
                ...l,
                amount,
                note: note ?? null,
                ...(date ? { date } : {}),
              },
        ),
      })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'update the entry'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
  })
}

// ---------------- notes ----------------

export function useAddNote(goalId: string | null) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, content, pinned }: { id: string; content: string; pinned?: boolean }) =>
      trackCreate(
        id,
        jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/notes`, {
          method: 'POST',
          body: JSON.stringify({ id, content, pinned }),
        }),
      ) as Promise<{ goal: GoalData | null }>,
    // optimistic: the note appears immediately, under its client-generated id
    onMutate: ({ id, content, pinned }) =>
      beginGoalWrite(qc, goalId, (g) => ({
        ...g,
        notes: [
          ...g.notes,
          {
            id,
            goalId: g.id,
            content,
            pinned: pinned === true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'add the note'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
  })
  return {
    ...mutation,
    mutate: (vars: { content: string; pinned?: boolean }, opts?: Parameters<typeof mutation.mutate>[1]) =>
      mutation.mutate({ ...vars, id: tempId('note') }, opts),
  }
}

export function useUpdateNote(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ noteId, patch }: { noteId: string; patch: { content?: string; pinned?: boolean } }) =>
      waitForCreate(noteId).then(() =>
        jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/notes/${noteId}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),
      ),
    // optimistic: pin/unpin and edits show immediately
    onMutate: ({ noteId, patch }) =>
      beginGoalWrite(qc, goalId, (g) => ({
        ...g,
        notes: g.notes.map((n): GoalNoteData =>
          n.id !== noteId ? n : { ...n, ...patch, updatedAt: new Date().toISOString() },
        ),
      })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'update the note'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
  })
}

export function useDeleteNote(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noteId: string) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/notes/${noteId}`, {
        method: 'DELETE',
      }),
    // optimistic: the note leaves the list immediately
    onMutate: (noteId) => beginGoalWrite(qc, goalId, (g) => ({ ...g, notes: g.notes.filter((n) => n.id !== noteId) })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'remove the note'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
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
  const mutation = useMutation({
    mutationFn: ({
      pathId,
      input,
    }: {
      pathId: string
      input: Omit<SkillNodeInputPayload, 'afterOrder'> & { afterOrder?: number; id?: string }
    }) =>
      trackCreate(
        input.id ?? '',
        jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/paths/${pathId}/nodes`, {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      ) as Promise<{ goal: GoalData | null }>,
    // optimistic: the new tier appears at the end of its path immediately,
    // under its client-generated id
    onMutate: ({ pathId, input }) =>
      beginGoalWrite(qc, goalId, (g) => {
        const path = g.skillPaths.find((p) => p.id === pathId)
        if (!path) return g
        const nodeId = input.id ?? tempId('node')
        const maxOrder = path.nodes.reduce((m, n) => Math.max(m, n.order), -1)
        const node: SkillNodeData = {
          id: nodeId,
          goalId: g.id,
          pathId,
          title: input.title,
          description: input.description ?? null,
          icon: input.icon ?? '✨',
          order: input.afterOrder != null ? input.afterOrder + 0.5 : maxOrder + 1,
          currentValue: input.currentValue ?? 0,
          targetValue: input.targetValue,
          unit: input.unit ?? null,
          xpValue: input.xpValue ?? 20,
          requiresIds: [],
          deriveFromId: null,
          deriveFactor: null,
          completedAt: null,
          createdAt: new Date().toISOString(),
          milestones: (input.milestones ?? []).map((m) => ({
            id: tempId('ms'),
            nodeId,
            value: typeof m === 'number' ? m : m.value,
            label: typeof m === 'number' ? null : (m.label ?? null),
            reachedAt: null,
          })),
        }
        return {
          ...g,
          skillPaths: g.skillPaths.map((p) => (p.id === pathId ? { ...p, nodes: [...p.nodes, node] } : p)),
        }
      }),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'add the checkpoint'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
  })
  return {
    ...mutation,
    mutate: (
      vars: { pathId: string; input: Omit<SkillNodeInputPayload, 'afterOrder'> & { afterOrder?: number } },
      opts?: Parameters<typeof mutation.mutate>[1],
    ) => mutation.mutate({ ...vars, input: { ...vars.input, id: tempId('node') } }, opts),
  }
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
      waitForCreate(nodeId).then(() =>
        jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/nodes/${nodeId}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),
      ),
    // optimistic: quick-adds, mastery flips and tier moves show instantly
    // (complex patches like milestones/gating settle from the server truth)
    onMutate: ({ nodeId, patch }) =>
      beginGoalWrite(qc, goalId, (g) => {
        let out = patch.move
          ? {
              ...g,
              skillPaths: g.skillPaths.map((p) => ({
                ...p,
                nodes: movedInOrder(p.nodes, nodeId, patch.move!),
              })),
            }
          : g
        const rest: Record<string, unknown> = { ...patch }
        delete rest.move
        delete rest.milestones
        delete rest.requiresIds
        delete rest.deriveFromId
        delete rest.deriveFactor
        if (Object.keys(rest).length > 0) out = withNodePatched(out, nodeId, rest)
        return out
      }),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'update the checkpoint'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
  })
}

export function useDeleteNode(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeId }: { nodeId: string }) =>
      waitForCreate(nodeId).then(() =>
        jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/nodes/${nodeId}`, {
          method: 'DELETE',
        }),
      ),
    // optimistic: the tier leaves its path immediately
    onMutate: ({ nodeId }) =>
      beginGoalWrite(qc, goalId, (g) => ({
        ...g,
        skillPaths: g.skillPaths.map((p) => ({ ...p, nodes: p.nodes.filter((n) => n.id !== nodeId) })),
      })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'remove the checkpoint'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
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
    // optimistic: the attempt appears in the metric's history immediately
    onMutate: ({ pbId, value, date, note }) =>
      beginGoalWrite(qc, goalId, (g) => ({
        ...g,
        pbs: g.pbs.map((pb) =>
          pb.id !== pbId
            ? pb
            : {
                ...pb,
                records: [
                  ...pb.records,
                  { id: tempId('rec'), date: date ?? new Date().toISOString(), value, note: note ?? null },
                ],
              },
        ),
      })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'record the attempt'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
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
    // optimistic: the corrected attempt shows immediately
    onMutate: ({ pbId, recordId, value, date, note }) =>
      beginGoalWrite(qc, goalId, (g) => ({
        ...g,
        pbs: g.pbs.map((pb) =>
          pb.id !== pbId
            ? pb
            : {
                ...pb,
                records: pb.records.map((r): PbRecordData =>
                  r.id !== recordId
                    ? r
                    : { ...r, value, note: note ?? null, ...(date ? { date } : {}) },
                ),
              },
        ),
      })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'update the attempt'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
  })
}

export function useDeletePbRecord(goalId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pbId, recordId }: { pbId: string; recordId: string }) =>
      jsonFetch<{ goal: GoalData | null }>(`/api/goals/${goalId}/pbs/${pbId}/records/${recordId}`, {
        method: 'DELETE',
      }),
    // optimistic: the attempt leaves the history immediately
    onMutate: ({ pbId, recordId }) =>
      beginGoalWrite(qc, goalId, (g) => ({
        ...g,
        pbs: g.pbs.map((pb) =>
          pb.id !== pbId ? pb : { ...pb, records: pb.records.filter((r) => r.id !== recordId) },
        ),
      })),
    onError: (e, _v, ctx) => ctx && failGoalWrite(qc, ctx, e, 'remove the attempt'),
    onSuccess: (res, _v, ctx) => ctx && settleGoalWrite(qc, ctx, res.goal),
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
