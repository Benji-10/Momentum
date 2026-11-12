'use client'

import { useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Dumbbell,
  Feather,
  Flame,
  Leaf,
  Pencil,
  Plus,
  Repeat,
  Sparkles,
  Sprout,
  Target,
  Trash2,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData, RoutineData } from '@/lib/types'
import { RoutineTitle } from '@/components/app/routine-title'
import {
  addDays,
  describeCadence,
  isRoutineDone,
  occurrencesInRange,
  routineStats,
  startOfWeek,
  sameDay,
  toDayKey,
  weekFlexProgress,
  type Occurrence,
} from '@/lib/routine-math'
import { getAppTimezone } from '@/lib/app-time'
import { goalColor } from '@/lib/goal-colors'
import { formatNumber } from '@/lib/goal-math'
import { currentStepForRoutine, routineStepLine } from '@/lib/step-triggers'
import { useDeleteRoutine, useToggleRoutineDone } from '@/hooks/use-goals'
import { EditLogDialog, type EditLogTarget } from '@/components/app/edit-log-dialog'
import { checkoffDisplayUnit, logAmountLabel } from '@/lib/recording'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { RoutineDialog } from '@/components/app/routine-dialog'
import { cn } from '@/lib/utils'

/** Find the skill node a routine is linked to (and its path). */
function routineNode(goal: GoalData | undefined, routine: RoutineData) {
  if (!routine.nodeId || !goal) return null
  for (const p of goal.skillPaths) {
    const node = p.nodes.find((n) => n.id === routine.nodeId)
    if (node) return { node, path: p }
  }
  return null
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * The plan step a routine occurrence is "for" right now — shown only when
 * the routine actually advances it (routine trigger linked to this routine,
 * or a metric-trigger step every session works toward). Manual steps stay
 * in the plan tab, where ticking them means something.
 */
function StepLine({ goal, routine, done }: { goal: GoalData; routine: RoutineData; done?: boolean }) {
  const ctx = currentStepForRoutine(goal, routine)
  if (!ctx) return null
  return (
    <div
      className={cn(
        'mt-1 flex items-start gap-1 rounded bg-warning/10 px-1.5 py-0.5 text-[10px] leading-snug text-warning',
        done && 'opacity-60',
      )}
      title={`This session works on the current plan step — it completes automatically${ctx.info.kind === 'metric' ? ' when the metric bar is crossed' : ' after enough check-offs'}`}
    >
      <Zap className="mt-px h-2.5 w-2.5 shrink-0" />
      <span className="min-w-0 truncate">{routineStepLine(ctx)}</span>
    </div>
  )
}

function OccurrenceRow({
  occ,
  goal,
  onToggle,
  onOpenGoal,
}: {
  occ: Occurrence
  goal: GoalData | undefined
  onToggle: () => void
  onOpenGoal?: () => void
}) {
  const c = goal ? goalColor(goal.color) : goalColor('emerald')
  const open = occ.state === 'open'
  const extra = occ.routine.optional
  const linked = routineNode(goal, occ.routine)
  return (
    <div
      className={cn(
        'group frosted flex items-start gap-2 rounded-lg border p-2 transition-all',
        occ.done
          ? 'border-primary/25 bg-primary/5'
          : occ.isToday
            ? 'today-glow border-primary/40 border-dashed'
            : open
              ? 'border-warning/25 bg-warning/5'
              : 'border-border bg-card hover:border-primary/40',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={occ.done ? `Undo "${occ.routine.title}"` : `Mark "${occ.routine.title}" as done`}
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all hover:scale-110',
          occ.done
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/40 hover:border-primary',
        )}
      >
        {occ.done && <Check className="h-3 w-3" strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="leading-snug">
          <RoutineTitle
            routine={occ.routine}
            done={occ.done}
            className={cn('text-xs font-semibold', occ.done && 'line-through decoration-primary/50')}
          />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
          {goal && (
            <button
              type="button"
              onClick={onOpenGoal}
              className="inline-flex items-center gap-0.5 rounded px-1 py-px hover:bg-accent"
            >
              <span>{goal.emoji}</span>
              <span className="max-w-24 truncate font-medium">{goal.title}</span>
            </button>
          )}
          {occ.routine.durationMin != null && (
            <span className="inline-flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {occ.routine.durationMin}m
            </span>
          )}
          {linked && (
            <span
              className="inline-flex max-w-full items-center gap-0.5 rounded bg-primary/10 px-1 py-px font-medium text-primary"
              title={`Advances ${linked.path.title} · ${linked.node.title}${occ.routine.credit ? ` (+${occ.routine.credit})` : ''}`}
            >
              <Target className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">
                {linked.node.title}
                {occ.routine.credit ? ` +${occ.routine.credit}` : ''}
              </span>
            </span>
          )}
          {extra ? (
            <span className="inline-flex items-center gap-0.5 text-violet-600 dark:text-violet-400" title="Extra credit — skipping this never counts against you">
              <Sparkles className="h-2.5 w-2.5" />
              extra credit — no pressure
            </span>
          ) : open ? (
            <span className="inline-flex items-center gap-0.5 text-warning">
              <Feather className="h-2.5 w-2.5" />
              still open — no rush
            </span>
          ) : null}
        </div>
        {goal && <StepLine goal={goal} routine={occ.routine} />}
      </div>
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ background: c.hex }} aria-hidden />
    </div>
  )
}

function RoutineManageRow({
  routine,
  goal,
  onEdit,
}: {
  routine: RoutineData
  goal: GoalData
  onEdit: () => void
}) {
  const deleteRoutine = useDeleteRoutine(goal.id)
  const stats = routineStats(routine, goal.deadline, 4)
  const c = goalColor(goal.color)
  const linked = routineNode(goal, routine)
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="group frosted flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-muted-foreground/25">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base" style={{ background: c.soft }}>
        <Repeat className="h-4 w-4" style={{ color: c.hex }} />
      </div>
      <div className="min-w-0 flex-1">
        <RoutineTitle routine={routine} className="truncate text-sm font-semibold" />
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>{describeCadence(routine)}</span>
          {routine.durationMin != null && <span>· {routine.durationMin}m</span>}
          <span className="inline-flex min-w-0 items-center gap-0.5">
            · {goal.emoji} <span className="max-w-28 truncate align-middle">{goal.title}</span>
          </span>
          {linked && (
            <span
              className="inline-flex max-w-full items-center gap-0.5 rounded bg-primary/10 px-1.5 py-px font-medium text-primary"
              title={`Advances ${linked.path.title} · ${linked.node.title}${routine.credit ? ` (+${routine.credit} per session)` : ''}`}
            >
              <Target className="h-2.5 w-2.5 shrink-0" />
              <span className="max-w-28 truncate">{linked.node.title}</span>
            </span>
          )}
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        {routine.optional && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-violet-500/12 px-2 py-0.5 text-[11px] font-semibold text-violet-600 tabular-nums dark:text-violet-400"
            title="Extra credit — nice to do, skipping it never counts against you"
          >
            <Sparkles className="h-3 w-3" /> extra credit
          </span>
        )}
        {!routine.optional && stats.openCount > 0 && (
          <span className="rounded-full bg-warning/12 px-2 py-0.5 text-[11px] font-semibold text-warning tabular-nums">
            {stats.openCount} open
          </span>
        )}
        {stats.streak > 1 && (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-orange-500 tabular-nums">
            <Flame className="h-3 w-3" /> {stats.streak}x
          </span>
        )}
        {stats.adherencePct != null && !routine.optional && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
            style={{
              background:
                stats.adherencePct >= 70
                  ? 'rgba(16,185,129,0.12)'
                  : stats.adherencePct >= 40
                    ? 'rgba(245,158,11,0.14)'
                    : 'rgba(100,116,139,0.14)',
              color:
                stats.adherencePct >= 70 ? 'var(--success)' : stats.adherencePct >= 40 ? 'var(--warning)' : 'var(--muted-foreground)',
            }}
            title={routine.optional ? 'Extra credit — nothing to adhere to' : 'Recent adherence — forgiven sessions don\'t count against you'}
          >
            {routine.optional ? '—' : `${stats.adherencePct}%`}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit routine" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive"
          aria-label="Delete routine"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{routine.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Its schedule and check-off history will be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deleteRoutine.mutate(
                  { routineId: routine.id },
                  {
                    onSuccess: () => toast.success('Routine deleted'),
                    onError: (e) => toast.error('Could not delete routine', { description: e.message }),
                  },
                )
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function ScheduleTab({
  goals,
  onOpenGoal,
}: {
  goals: GoalData[]
  onOpenGoal: (g: GoalData, tab?: string) => void
}) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [addFor, setAddFor] = useState<GoalData | null>(null)
  const [showForgiven, setShowForgiven] = useState(false)
  const [showManage, setShowManage] = useState(false)
  const [editRoutine, setEditRoutine] = useState<{ routine: RoutineData; goal: GoalData } | null>(null)

  const allRoutines = useMemo(
    () => goals.flatMap((g) => g.routines.filter((r) => !r.archived).map((r) => ({ routine: r, goal: g }))),
    [goals],
  )

  const now = new Date()
  const weekStartMs = startOfWeek(now).getTime() + weekOffset * 7 * 86_400_000
  const weekStart = new Date(weekStartMs)
  const weekEnd = addDays(weekStart, 6)
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(new Date(weekStartMs), i)),
    [weekStartMs],
  )

  const occurrencesByDay = useMemo(() => {
    const from = new Date(weekStartMs)
    const to = addDays(from, 6)
    const all = allRoutines.flatMap(({ routine, goal }) =>
      occurrencesInRange([routine], goal.deadline, from, to).map((o) => ({ occ: o, goal })),
    )
    const byDay = new Map<string, { occ: Occurrence; goal: GoalData }[]>()
    for (const o of all) {
      const key = toDayKey(o.occ.date) // app-tz calendar day, stable across devices
      if (!byDay.has(key)) byDay.set(key, [])
      byDay.get(key)!.push(o)
    }
    for (const list of byDay.values()) list.sort((a, b) => a.goal.title.localeCompare(b.goal.title))
    return byDay
  }, [allRoutines, weekStartMs])

  const allWeek = [...occurrencesByDay.values()].flat()
  const weekDone = allWeek.filter((x) => x.occ.done).length
  const weekOpen = allWeek.filter((x) => x.occ.state === 'open').length
  const weekForgiven = allWeek.filter((x) => x.occ.state === 'forgiven').length
  const weekTodayLeft = allWeek.filter((x) => x.occ.state === 'today').length
  const isPastWeek = weekEnd < now && !sameDay(weekEnd, now) && weekOffset < 0
  const toggleDone = useToggleRoutineDone()
  const [editLog, setEditLog] = useState<EditLogTarget | null>(null)

  // flexible routines live outside the day columns — they're a weekly quota
  const flexRoutines = allRoutines.filter(({ routine }) => routine.cadence === 'flexible')
  // “left” only counts real commitments — extra-credit sessions are never “to do”
  const flexLeft = flexRoutines
    .filter(({ routine }) => !routine.optional)
    .reduce((s, { routine }) => s + weekFlexProgress(routine, weekStart).left, 0)

  function toggle({ goal, routine, date, undo }: { goal: GoalData; routine: RoutineData; date?: Date; undo?: boolean }) {
    toggleDone.mutate(
      {
        goalId: goal.id,
        routineId: routine.id,
        // calendar day in the user's timezone — never a bare ISO timestamp,
        // which the server would re-truncate to *its* midnight (wrong day
        // for every non-UTC client)
        date: date ? toDayKey(date) : undefined,
        undo,
      },
      {
        onSuccess: (res) => {
          if (res.creditSkipped) {
            toast('Session logged — but its checkpoint is still locked, so no tree progress yet', {
              icon: '🔒',
              description: 'Clear the checkpoints before it and future check-offs will count.',
            })
            return
          }
          if (undo) {
            const reOpened = res.stepsReverted ?? []
            toast('Check-off undone', {
              description: [
                res.removedLog ? 'The auto log entry was removed too.' : null,
                reOpened.length ? `Step re-opened: “${reOpened[0].title}”.` : null,
              ]
                .filter(Boolean)
                .join(' ') || undefined,
            })
            return
          }
          if (res.stepsAdvanced?.length) {
            toast.success(`Step complete — “${res.stepsAdvanced[0].title}”`, {
              icon: '⚡',
              description:
                res.stepsAdvanced.length > 1
                  ? `And “${res.stepsAdvanced[1].title}” unlocked as the next step.`
                  : 'It completed itself from your activity — the plan moved on.',
            })
          }
          if (res.autoLog) {
            // the check-off logged the routine's defined amount — in the unit
            // it records (the linked checkpoint's unit when there is one) —
            // adjusting to reality is one tap away
            const autoLog = res.autoLog
            // the unit the server recorded it in, falling back to the
            // client-side resolution for older payloads
            const unit = autoLog.unit ?? checkoffDisplayUnit(goal, routine)
            const dur = routine.durationMin
            const timeish = ['h', 'hr', 'hrs', 'hour', 'hours', 'm', 'min', 'mins', 'minute', 'minutes'].includes(unit.toLowerCase())
            const shown = logAmountLabel(autoLog.amount, unit) + (dur && !timeish ? ` · ${dur}m` : '')
            toast.success(`${routine.title} done`, {
              description: `Logged ${shown} — not quite right?`,
              action: {
                label: 'Edit',
                onClick: () =>
                  setEditLog({
                    goalId: goal.id,
                    logId: autoLog.id,
                    amount: autoLog.amount,
                    unit,
                    title: routine.title,
                    note: autoLog.note,
                    day: toDayKey(date ?? new Date()),
                  }),
              },
            })
          }
        },
      },
    )
  }

  if (allRoutines.length === 0 && goals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        Nothing to schedule yet — create a goal with routines to see your week here.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* week header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label="Previous week"
            onClick={() => setWeekOffset(weekOffset - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            aria-label="Next week"
            onClick={() => setWeekOffset(weekOffset + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold">
            {weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: getAppTimezone() })} –{' '}
            {weekEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: getAppTimezone() })}
          </div>
          <div className="text-xs text-muted-foreground">
            {weekOffset === 0
              ? 'This week'
              : weekOffset === -1
                ? 'Last week'
                : weekOffset === 1
                  ? 'Next week'
                  : `${weekOffset > 0 ? '+' : ''}${weekOffset} weeks`}
            {allWeek.length > 0 && ` · ${weekDone} done`}
            {weekOffset === 0 && flexLeft > 0 && ` · ${flexLeft} flex left`}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {weekOffset !== 0 && (
            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
              <CalendarDays className="h-4 w-4" /> Today
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4" /> New routine
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              {goals.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Create a goal first</div>}
              {goals.map((g) => (
                <DropdownMenuItem key={g.id} onClick={() => setAddFor(g)} className="gap-2">
                  <span>{g.emoji}</span> <span className="max-w-48 truncate">{g.title}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* kindness banner */}
      {isPastWeek ? (
        <div className="frosted flex items-start gap-2.5 rounded-xl border border-border/70 bg-muted/30 p-3.5 text-sm text-muted-foreground">
          <Leaf className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span>
            A past week, gently archived — nothing to fix here. What matters is what you do{' '}
            <span className="font-semibold text-foreground">this week</span>.
          </span>
        </div>
      ) : weekOpen + weekForgiven > 0 ? (
        <div
          className={cn(
            'flex flex-wrap items-start gap-2.5 rounded-xl border p-3.5 text-sm',
            'border-warning/25 bg-warning/8 text-warning',
          )}
        >
          <Sprout className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            {weekTodayLeft > 0 ? (
              <>
                {weekOpen > 0 ? `${weekOpen} session${weekOpen === 1 ? '' : 's'} from the last few days are still catch-up-able — ` : ''}
                {weekTodayLeft === 1 ? "one session is up for today, whenever it suits you. " : `${weekTodayLeft} sessions are up for today, whenever they suit you. `}
                Anything you tick counts; the rest quietly forgives itself after 3 days.
              </>
            ) : weekOpen > 0 ? (
              <>
                {weekOpen} session{weekOpen === 1 ? '' : 's'} from the last few days are still catch-up-able. No pressure — they
                stay that way for 3 days, then they quietly forgive themselves.
              </>
            ) : (
              <>All caught up on the open items — anything older has been quietly forgiven.</>
            )}
            {weekForgiven > 0 && (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                🌿 {weekForgiven} session{weekForgiven === 1 ? '' : 's'} from further back have been quietly forgiven —
                they don&apos;t count against you.
              </span>
            )}
          </div>
        </div>
      ) : weekDone > 0 ? (
        <div className="frosted flex items-start gap-2.5 rounded-xl border border-success/25 bg-success/8 p-3.5 text-sm text-success">
          <Sprout className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <span>
            Nothing pending — {weekDone} session{weekDone === 1 ? '' : 's'} done
            {weekTodayLeft === 0 ? ' this week' : ''}. Keep the streak alive at your own pace.
          </span>
        </div>
      ) : null}

      {/* flexible weekly quota — any day, rest days built in */}
      {flexRoutines.length > 0 && (
        <div className="frosted rounded-xl border border-primary/25 bg-muted/10 p-3">
          <div className="flex items-center gap-2">
            <Dumbbell className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wide text-primary">Any day this week</span>
            <span className="text-[11px] font-normal text-muted-foreground">
              {weekOffset === 0 ? '— do them whenever suits you' : '— how that week went'}
            </span>
          </div>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {flexRoutines.map(({ routine, goal }) => {
              const prog = weekFlexProgress(routine, weekStart)
              const doneToday = isRoutineDone(routine, now)
              const linked = routineNode(goal, routine)
              const canCheck = weekOffset === 0 // past/future weeks are read-only
              return (
                <div
                  key={routine.id}
                  className={cn(
                    'frosted flex items-center gap-2 rounded-lg border bg-card p-2',
                    weekOffset === 0 && prog.left > 0
                      ? routine.optional
                        ? 'border-violet-500/25'
                        : 'border-primary/30'
                      : undefined,
                  )}
                >
                  <button
                    type="button"
                    disabled={!canCheck}
                    onClick={() => toggle({ goal, routine, date: now, undo: doneToday })}
                    aria-label={doneToday ? `Undo a ${routine.title} session` : `Log a ${routine.title} session for today`}
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all hover:scale-110 disabled:opacity-60',
                      doneToday
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/40 hover:border-primary',
                    )}
                  >
                    {doneToday && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">
                      {routine.title}
                      {routine.optional && (
                        <span
                          className="ml-1.5 rounded-full bg-violet-500/15 px-1.5 py-px align-middle text-[9px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400"
                          title="Extra credit — no penalty when skipped"
                        >
                          extra
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => onOpenGoal(goal)}
                        className="inline-flex items-center gap-0.5 rounded px-1 py-px hover:bg-accent"
                      >
                        <span>{goal.emoji}</span>
                        <span className="max-w-20 truncate font-medium">{goal.title}</span>
                      </button>
                      {linked && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1 py-px font-medium text-primary">
                          <Target className="h-2.5 w-2.5 shrink-0" />
                          <span className="max-w-24 truncate">{linked.node.title}</span>
                        </span>
                      )}
                    </div>
                    <StepLine goal={goal} routine={routine} done={doneToday} />
                  </div>
                  <div className="flex shrink-0 items-center gap-1" aria-label={`${prog.done} of ${prog.target} sessions done this week`}>
                    {Array.from({ length: Math.min(prog.target, 7) }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          'h-2 w-2 rounded-full',
                          i < prog.done ? 'bg-primary' : 'bg-muted-foreground/25',
                        )}
                      />
                    ))}
                    <span className="ml-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {prog.done}/{prog.target}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          {weekOffset === 0 && flexLeft > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {flexLeft} flexible session{flexLeft === 1 ? '' : 's'} left — any day counts, missed ones never pile up.
            </p>
          )}
        </div>
      )}

      {/* week grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {days.map((d, i) => {
          const list = occurrencesByDay.get(toDayKey(d)) ?? []
          const visible = list.filter((x) => showForgiven || x.occ.state !== 'forgiven')
          const forgivenCount = list.length - visible.length
          const isToday = sameDay(d, now)
          return (
            <div
              key={i}
              className={cn(
                'frosted flex min-h-28 flex-col gap-2 rounded-xl border p-2.5',
                isToday ? 'border-primary/50 bg-primary/5' : 'border-border/70 bg-muted/10',
              )}
            >
              <div className="flex items-baseline justify-between px-0.5">
                <span className={cn('text-xs font-bold uppercase tracking-wide', isToday && 'text-primary')}>
                  {DAY_LABELS[i]}
                </span>
                <span className={cn('text-xs tabular-nums', isToday ? 'font-bold text-primary' : 'text-muted-foreground')}>
                  {Number(toDayKey(d).slice(8, 10))}
                </span>
              </div>
              {list.length === 0 ? (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-3 text-[10px] text-muted-foreground/70">
                  —
                </div>
              ) : (
                <>
                  {visible.map(({ occ, goal }) => (
                    <OccurrenceRow
                      key={occ.routine.id + occ.date.toISOString()}
                      occ={occ}
                      goal={goal}
                      onToggle={() =>
                        toggle({
                          goal,
                          routine: occ.routine,
                          date: occ.date,
                          undo: occ.done,
                        })
                      }
                      onOpenGoal={() => onOpenGoal(goal)}
                    />
                  ))}
                  {forgivenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowForgiven(!showForgiven)}
                      className="flex items-center justify-center gap-1 rounded-lg border border-dashed py-1.5 text-[10px] text-muted-foreground/80 transition-colors hover:text-foreground"
                    >
                      {showForgiven ? <ChevronDown className="h-3 w-3" /> : <Leaf className="h-3 w-3" />}
                      {forgivenCount} forgiven
                      {!showForgiven && ' — let go'}
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* routine management — tucked away: the week grid above is what a
          session needs; editing a routine is occasional housekeeping */}
      <div className="frosted rounded-xl border bg-card">
        <button
          type="button"
          onClick={() => setShowManage((v) => !v)}
          aria-expanded={showManage}
          className="flex w-full items-center gap-2 rounded-xl p-3.5 text-left transition-colors hover:bg-accent/40"
        >
          <Repeat className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Manage routines</span>
          <span className="text-xs font-normal text-muted-foreground">
            {allRoutines.length} · edit cadence, duration, focus
          </span>
          <ChevronDown
            className={cn('ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform', showManage && 'rotate-180')}
          />
        </button>
        {showManage && (
          <div className="space-y-2 border-t p-3.5 pt-3">
            {allRoutines.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                No routines yet. Add one with <span className="font-medium text-foreground">New routine</span> — e.g.
                &ldquo;drills every 2 days&rdquo; or &ldquo;focused practice every Sunday&rdquo;.
              </div>
            ) : (
              allRoutines.map(({ routine, goal }) => (
                <RoutineManageRow
                  key={routine.id}
                  routine={routine}
                  goal={goal}
                  onEdit={() => setEditRoutine({ routine, goal })}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* dialogs */}
      {addFor && (
        <RoutineDialog goal={addFor} routine={null} open onOpenChange={(o) => !o && setAddFor(null)} />
      )}
      {editRoutine && (
        <RoutineDialog
          goal={editRoutine.goal}
          routine={editRoutine.routine}
          open
          onOpenChange={(o) => !o && setEditRoutine(null)}
        />
      )}
      <EditLogDialog key={editLog?.logId ?? 'none'} target={editLog} onClose={() => setEditLog(null)} />
    </div>
  )
}
