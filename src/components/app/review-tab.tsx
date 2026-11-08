'use client'

import { useState } from 'react'
import { Activity, CalendarClock, Clock, Flame, Gauge, Pencil, Plus, Timer, Trash2, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData, PersonalBestData, PbRecordData } from '@/lib/types'
import { computeGoalStats, formatDateShort, formatHours, formatNumber, weeklyHistory } from '@/lib/goal-math'
import { goalColor } from '@/lib/goal-colors'
import { currentPb, formatPbValue, pbDelta, pbSeries, sortedRecords } from '@/lib/pb-math'
import { timeSpent } from '@/lib/goal-math'
import { useDeletePb } from '@/hooks/use-goals'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { StatusBadge } from '@/components/app/goal-visuals'
import { PbChart, TimeAreaChart, WeeklyBars } from '@/components/app/charts'
import { AddPbMetricDialog, EditPbDialog, EditPbRecordDialog, RecordPbDialog } from '@/components/app/pb-dialogs'
import { cn } from '@/lib/utils'

/** One PB metric: current best, the PB-over-time chart, record + manage. */
function PbMetricBlock({
  goal,
  pb,
  onRecord,
}: {
  goal: GoalData
  pb: PersonalBestData
  onRecord: (pb: PersonalBestData) => void
}) {
  const c = goalColor(goal.color)
  const best = currentPb(pb)
  const delta = pbDelta(pb)
  const records = sortedRecords(pb)
  const deletePb = useDeletePb(goal.id)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  /** the attempt being edited, or null (editor closed) */
  const [editRecord, setEditRecord] = useState<PbRecordData | null>(null)

  const improving = delta == null ? null : pb.direction === 'up' ? delta > 0 : delta < 0

  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">
            🏆 {pb.name}
          </span>
          {best && (
            <span className="text-2xl font-bold tabular-nums" style={{ color: c.hex }}>
              {formatPbValue(pb)}
              {pb.unit ? <span className="ml-1 text-xs font-medium text-muted-foreground">{pb.unit}</span> : null}
            </span>
          )}
          {delta != null && delta !== 0 && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                improving ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
              )}
              title="Change since your previous PB"
            >
              {delta > 0 ? '+' : ''}
              {formatNumber(delta)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2.5 text-xs" onClick={() => onRecord(pb)}>
            <Plus className="h-3.5 w-3.5" /> Record
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label={`Edit ${pb.name} metric`}
            title="Rename, change unit or direction"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            aria-label={`Stop tracking ${pb.name}`}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {records.length > 0 && (
        <>
          <div className="mt-2">
            <PbChart data={pbSeries(pb)} color={c.hex} unit={pb.unit} direction={pb.direction} />
          </div>
          {/* attempts, newest first — tap one to fix the number, day or note */}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {[...records].reverse().map((r) => {
              const isBest = best != null && r.id === best.id
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-label={`Edit the ${formatNumber(r.value)} attempt from ${formatDateShort(new Date(r.date))}`}
                  title={r.note ?? 'Tap to edit or remove'}
                  onClick={() => setEditRecord(r)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] tabular-nums transition-colors hover:border-primary/50',
                    isBest
                      ? 'border-primary/50 bg-primary/10 font-semibold'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {formatDateShort(new Date(r.date))} · {formatNumber(r.value)}
                  {isBest && <Trophy className="h-3 w-3 text-amber-500" />}
                </button>
              )
            })}
          </div>
        </>
      )}

      <EditPbDialog key={pb.id} goalId={goal.id} pb={pb} open={editOpen} onOpenChange={setEditOpen} />

      {/* attempt editor — keyed so form state resets per attempt */}
      <EditPbRecordDialog
        key={editRecord?.id ?? 'none'}
        goalId={goal.id}
        pb={pb}
        record={editRecord}
        open={!!editRecord}
        onOpenChange={(o) => !o && setEditRecord(null)}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop tracking {pb.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the metric and its {records.length} {records.length === 1 ? 'attempt' : 'attempts'} for “{goal.title}”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deletePb.mutate(
                  { pbId: pb.id },
                  {
                    onSuccess: () => toast.success(`Stopped tracking ${pb.name}`),
                    onError: (e) => toast.error('Could not delete the metric', { description: e.message }),
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

/**
 * One goal's review — a single card with a switch: the rhythm view (what you
 * logged each week vs pace) or the bests view (PB metrics and their charts),
 * collapsed into the same section instead of a separate one below it.
 */
function GoalReviewCard({
  goal,
  onOpen,
  onAddPb,
  onRecord,
}: {
  goal: GoalData
  onOpen: (g: GoalData) => void
  onAddPb: (g: GoalData) => void
  onRecord: (pb: PersonalBestData) => void
}) {
  const [view, setView] = useState<'rhythm' | 'bests'>('rhythm')
  const stats = computeGoalStats(goal)
  const c = goalColor(goal.color)
  const weekly = weeklyHistory(goal, 8)
  const requirement =
    goal.type === 'quantitative' ? (stats.idealWeeklyPace ?? goal.weeklyTarget) : goal.weeklyTarget
  const weeksMet = weekly.filter(
    (w) => (requirement != null ? w.amount >= requirement * 0.99 : w.amount > 0),
  ).length
  const avg = weekly.reduce((s, w) => s + w.amount, 0) / (weekly.length || 1)
  const time = timeSpent(goal)
  const pbs = goal.pbs
  const hasBests = pbs.length > 0

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpen(goal)}
      onKeyDown={(e) => {
        // only when the card itself is focused — keydowns from inputs and
        // portaled dialogs (edit PB, confirm…) bubble here through the React
        // tree and must never open the goal (the "space while typing" bug)
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(goal)
        }
      }}
      className="cursor-pointer p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl text-lg"
            style={{ background: c.soft }}
          >
            {goal.emoji}
          </div>
          <div>
            <h3 className="font-semibold leading-tight">{goal.title}</h3>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {goal.type === 'quantitative'
                ? `${formatNumber(stats.currentValue)} / ${formatNumber(stats.targetValue ?? 0)} ${goal.unit ?? ''} · ${stats.progressPct}%`
                : `${stats.stepsDone}/${stats.stepsTotal} steps · ${stats.progressPct}%`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* rhythm ⇄ bests switch — one section, two views */}
          <div role="radiogroup" aria-label="Review view" className="flex rounded-full border p-0.5">
            <button
              type="button"
              role="radio"
              aria-checked={view === 'rhythm'}
              onClick={() => setView('rhythm')}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                view === 'rhythm' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Activity className="h-3.5 w-3.5" /> Rhythm
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={view === 'bests'}
              onClick={() => setView('bests')}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                view === 'bests' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Trophy className={cn('h-3.5 w-3.5', view === 'bests' && 'text-amber-400')} /> Bests
              {hasBests && view !== 'bests' && (
                <span className="rounded-full bg-primary/15 px-1 text-[9px] font-bold tabular-nums text-primary">
                  {pbs.length}
                </span>
              )}
            </button>
          </div>
          <StatusBadge status={stats.status} />
        </div>
      </div>

      {view === 'rhythm' ? (
        <>
          <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_260px]">
            <WeeklyBars
              data={weekly}
              color={c.hex}
              unit={goal.unit}
              requirement={requirement}
              height={150}
            />
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2">
                <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="text-xs">
                  <span className="font-semibold tabular-nums">{formatNumber(Math.round(avg * 10) / 10)}</span>{' '}
                  <span className="text-muted-foreground">
                    avg {goal.unit || 'sessions'}/week (8w)
                  </span>
                </div>
              </div>
              {time && (
                <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="text-xs">
                    <span className="font-semibold tabular-nums">{formatHours(time.total)}</span>{' '}
                    <span className="text-muted-foreground">invested · {formatHours(time.thisWeek)} this week</span>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2">
                <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="text-xs">
                  <span className="font-semibold tabular-nums">
                    {weeksMet}/{weekly.length}
                  </span>{' '}
                  <span className="text-muted-foreground">weeks kept pace</span>
                </div>
              </div>
              <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2">
                <Flame className="h-4 w-4 shrink-0 text-orange-500" />
                <div className="text-xs">
                  <span className="font-semibold tabular-nums">{stats.streakWeeks} week</span>{' '}
                  <span className="text-muted-foreground">current streak</span>
                </div>
              </div>
              {goal.type === 'quantitative' && stats.projectedFinishDate && goal.deadline && (
                <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2">
                  <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="text-xs">
                    <span className="text-muted-foreground">projected finish </span>{' '}
                    <span
                      className="font-semibold tabular-nums"
                      style={{
                        color:
                          stats.projectedFinishDate.getTime() <= new Date(goal.deadline).getTime()
                            ? '#10b981'
                            : '#f59e0b',
                      }}
                    >
                      {stats.projectedFinishDate.toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {time && time.series.length > 1 && (
            <div className="mt-4 border-t pt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Timer className="h-4 w-4" style={{ color: c.hex }} /> Time spent
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatHours(time.total)} total · {formatHours(time.thisWeek)} this week
                </span>
              </div>
              <TimeAreaChart data={time.series} color={c.hex} />
            </div>
          )}
        </>
      ) : (
        /* bests view — the PB metrics live inside the same card */
        <div className="mt-4" onClick={(e) => e.stopPropagation()}>
          {hasBests ? (
            <div className="grid gap-3 md:grid-cols-2">
              {pbs.map((pb) => (
                <PbMetricBlock key={pb.id} goal={goal} pb={pb} onRecord={onRecord} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-6 text-center">
              <Trophy className="mx-auto h-5 w-5 text-muted-foreground/60" />
              <p className="mt-2 text-sm text-muted-foreground">
                No metrics yet — track a personal best (WPM, 5K time, heaviest lift…).
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-1.5"
                onClick={() => onAddPb(goal)}
                aria-label={`Track a personal best for ${goal.title}`}
              >
                <Plus className="h-3.5 w-3.5" /> Track a metric
              </Button>
            </div>
          )}
          {hasBests && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-muted-foreground"
                onClick={() => onAddPb(goal)}
                aria-label={`Track another personal best for ${goal.title}`}
              >
                <Plus className="h-3 w-3" /> Track another metric
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export function ReviewTab({ goals, onOpen }: { goals: GoalData[]; onOpen: (g: GoalData) => void }) {
  const [pbGoal, setPbGoal] = useState<GoalData | null>(null)
  const [recordPb, setRecordPb] = useState<PersonalBestData | null>(null)
  /** which goal's review is shown — "all" keeps the scrollable overview */
  const [pickedId, setPickedId] = useState<string | null>(null)

  if (goals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        Nothing to review yet — create a goal and start logging.
      </div>
    )
  }

  const picked = pickedId ? goals.find((g) => g.id === pickedId) ?? null : null
  const shown = picked ? [picked] : goals

  return (
    <div className="space-y-4">
      {/* goal switcher — jump straight to the one you want instead of
          scrolling past every other card to find it */}
      {goals.length > 1 && (
        <div className="nice-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Which goal to review">
          <button
            type="button"
            role="tab"
            aria-selected={pickedId === null}
            onClick={() => setPickedId(null)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-all',
              pickedId === null
                ? 'border-transparent bg-primary text-primary-foreground shadow-md'
                : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground',
            )}
          >
            <Activity className="h-3.5 w-3.5" /> All goals
            <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', pickedId === null ? 'bg-primary-foreground/20' : 'bg-muted')}>
              {goals.length}
            </span>
          </button>
          {goals.map((g) => {
            const c = goalColor(g.color)
            const selected = g.id === pickedId
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setPickedId(selected ? null : g.id)}
                title={g.title}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all',
                  selected ? 'border-transparent shadow-md' : 'border-border bg-card hover:border-muted-foreground/30',
                )}
                style={selected ? { background: c.soft, borderColor: c.hex } : undefined}
              >
                <span className="text-lg leading-none">{g.emoji}</span>
                <span className="min-w-0">
                  <span className="block max-w-44 truncate text-sm font-semibold leading-tight">{g.title}</span>
                  <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground">
                    {g.pbs.length > 0 ? `${g.pbs.length} metric${g.pbs.length === 1 ? '' : 's'}` : 'rhythm only'}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {shown.length === 1 ? (
        <p className="text-sm text-muted-foreground">
          What you actually logged each week for <span className="font-medium text-foreground">{shown[0].title}</span> — the
          dashed line is its pace. Flip to <span className="font-medium text-foreground">Bests</span> for its personal-best
          metrics.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          A friendly look at your rhythm — what you actually logged each week, with the dashed line showing each
          goal&apos;s pace. Flip a card to <span className="font-medium text-foreground">Bests</span> for its personal-best
          metrics.
        </p>
      )}

      {shown.map((goal) => (
        <GoalReviewCard
          key={goal.id}
          goal={goal}
          onOpen={onOpen}
          onAddPb={setPbGoal}
          onRecord={setRecordPb}
        />
      ))}

      {/* dialogs (portal-rendered, outside the clickable cards) */}
      {pbGoal && (
        <AddPbMetricDialog goal={pbGoal} open onOpenChange={(open) => !open && setPbGoal(null)} />
      )}
      {recordPb && (
        <RecordPbDialog
          goalId={recordPb.goalId}
          pb={recordPb}
          open
          onOpenChange={(open) => !open && setRecordPb(null)}
        />
      )}
    </div>
  )
}
