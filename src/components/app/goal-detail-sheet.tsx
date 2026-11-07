'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  ClipboardList,
  Flame,
  ListChecks,
  Map as MapIcon,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Repeat,
  Sparkles,
  StickyNote,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData, GoalStepData, RoutineData, StepStatus } from '@/lib/types'
import {
  computeGoalStats,
  cumulativeSeries,
  formatDateLong,
  formatDateShort,
  formatNumber,
  weeklyHistory,
} from '@/lib/goal-math'
import { goalColor } from '@/lib/goal-colors'
import { buildSkillMap } from '@/lib/skill-tree'
import { describeCadence, occurrencesInRange, relativeDayLabel, routineStats, sameDay, startOfWeek, addDays, toDayKey } from '@/lib/routine-math'
import { dayKeyOf, isoForDayKey, todayDayKey } from '@/lib/app-time'
import { parseGoalScopeImport } from '@/lib/import-format'
import { EditLogDialog, type EditLogTarget } from '@/components/app/edit-log-dialog'
import {
  useAddLog,
  useAddNote,
  useAddStep,
  useDeleteGoal,
  useDeleteLog,
  useDeleteNote,
  useDeleteRoutine,
  useDeleteStep,
  useGoalScopeImport,
  useToggleRoutineDone,
  useUpdateNote,
  useUpdateStep,
} from '@/hooks/use-goals'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { StatusBadge, StatTile } from '@/components/app/goal-visuals'
import { CumulativeChart, WeeklyBars } from '@/components/app/charts'
import { SkillMapGrid } from '@/components/app/skill-map'
import { RoutineDialog } from '@/components/app/routine-dialog'
import { cn } from '@/lib/utils'

/** Today in the app timezone. */
function todayStr(): string {
  return todayDayKey()
}

function quickAmounts(unit: string | null): number[] {
  switch (unit) {
    case 'pages':
      return [10, 25, 50]
    case 'words':
      return [250, 500, 1000]
    case 'hours':
      return [0.5, 1, 2]
    case 'km':
      return [3, 5, 10]
    default:
      return [1, 2, 5]
  }
}

/** Goal description, clamped to two lines until expanded — on a phone a long
 *  description used to push the tabs (and everything below) off-screen. */
function ClampedDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    // measure only while collapsed; once we know it overflows, keep the
    // toggle so "less" stays available after expanding
    if (expanded) return
    const el = ref.current
    if (el && el.scrollHeight > el.clientHeight + 2) setOverflows(true)
  }, [text, expanded])

  return (
    <div>
      <SheetDescription ref={ref} className={cn('mt-1 leading-snug', !expanded && 'line-clamp-2')}>
        {text}
      </SheetDescription>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-xs font-medium text-primary hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step row
// ---------------------------------------------------------------------------

function StepRow({
  step,
  isNext,
  onCycle,
  onMove,
  onDelete,
  onEdit,
  busy,
}: {
  step: GoalStepData
  isNext: boolean
  onCycle: () => void
  onMove: (dir: 'up' | 'down') => void
  onDelete: () => void
  onEdit: (patch: { title: string; notes: string | null }) => void
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(step.title)
  const [notes, setNotes] = useState(step.notes ?? '')

  const icon =
    step.status === 'done' ? (
      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
    ) : step.status === 'in_progress' ? (
      <CircleDot className="h-5 w-5 text-amber-500" />
    ) : (
      <Circle className="h-5 w-5 text-muted-foreground" />
    )

  return (
    <div
      className={cn(
        'group rounded-lg border p-2.5 transition-colors',
        isNext && 'border-primary/40 bg-primary/5',
        step.status === 'done' && 'opacity-70',
      )}
    >
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onCycle}
          disabled={busy}
          aria-label={`Mark step "${step.title}" as ${step.status === 'pending' ? 'in progress' : step.status === 'in_progress' ? 'done' : 'pending'}`}
          className="shrink-0 transition-transform hover:scale-110 disabled:opacity-50"
        >
          {icon}
        </button>
        <div className="min-w-0 flex-1">
          <div className={cn('text-sm font-medium leading-snug', step.status === 'done' && 'line-through')}>
            {step.title}
          </div>
          {step.notes && !editing && (
            <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{step.notes}</div>
          )}
          {isNext && step.status !== 'done' && !editing && (
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-primary">Next up</div>
          )}
        </div>
        {/* always visible on touch — hover-reveal only on desktop */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={`Edit step "${step.title}"`}
            title="Rename or add notes"
            onClick={() => {
              setTitle(step.title)
              setNotes(step.notes ?? '')
              setEditing(!editing)
            }}
            disabled={busy}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move up" onClick={() => onMove('up')} disabled={busy}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move down" onClick={() => onMove('down')} disabled={busy}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="Delete step" onClick={onDelete} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {editing && (
        <div className="mt-2 space-y-1.5 border-t pt-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Step title"
            maxLength={200}
            className="h-8 text-xs"
            aria-label="Step title"
            autoFocus
          />
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (optional) — how to do this step well"
            maxLength={2000}
            rows={2}
            className="text-xs"
            aria-label="Step notes"
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!title.trim() || busy}
              onClick={() => {
                onEdit({ title: title.trim(), notes: notes.trim() || null })
                setEditing(false)
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sheet
// ---------------------------------------------------------------------------

export function GoalDetailSheet({
  goal,
  onOpenChange,
  onEdit,
  initialTab,
}: {
  goal: GoalData | null
  onOpenChange: (open: boolean) => void
  onEdit: (g: GoalData) => void
  initialTab?: string
}) {
  if (!goal) return null
  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DetailBody
          key={goal.id + (initialTab ?? '')}
          goal={goal}
          onOpenChange={onOpenChange}
          onEdit={onEdit}
          initialTab={initialTab}
        />
      </SheetContent>
    </Sheet>
  )
}

function DetailBody({
  goal,
  onOpenChange,
  onEdit,
  initialTab,
}: {
  goal: GoalData
  onOpenChange: (open: boolean) => void
  onEdit: (g: GoalData) => void
  initialTab?: string
}) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayStr())
  const [newStep, setNewStep] = useState('')
  const [newNote, setNewNote] = useState('')
  const [routineDialogOpen, setRoutineDialogOpen] = useState(false)
  const [editRoutine, setEditRoutine] = useState<RoutineData | null>(null)
  const [scopeJson, setScopeJson] = useState('')
  const [scopeOpen, setScopeOpen] = useState(false)
  /** full editor for one history entry (amount, day, note) */
  const [editLog, setEditLog] = useState<EditLogTarget | null>(null)

  const addLog = useAddLog(goal.id)
  const deleteLog = useDeleteLog(goal.id)
  const addStep = useAddStep(goal.id)
  const updateStep = useUpdateStep(goal.id)
  const deleteStep = useDeleteStep(goal.id)
  const deleteGoal = useDeleteGoal()
  const addNote = useAddNote(goal.id)
  const updateNote = useUpdateNote(goal.id)
  const deleteNote = useDeleteNote(goal.id)
  const toggleDone = useToggleRoutineDone()
  const scopeImport = useGoalScopeImport(goal.id)
  const deleteRoutine = useDeleteRoutine(goal.id)

  const stats = useMemo(() => computeGoalStats(goal), [goal])
  const series = useMemo(() => cumulativeSeries(goal), [goal])
  const weekly = useMemo(() => weeklyHistory(goal.logs, 8), [goal])
  const skillMap = useMemo(() => buildSkillMap(goal), [goal])
  const c = goalColor(goal.color)
  const unit = goal.unit ?? ''
  // display unit for the log editor (falls back to sessions/units)
  const logUnit = goal.unit ?? (goal.type === 'plan' ? 'sessions' : 'units')

  const weekRequirement =
    goal.type === 'quantitative' ? (stats.idealWeeklyPace ?? null) : goal.weeklyTarget

  const routines = goal.routines.filter((r) => !r.archived)
  const weekRoutineOccs = useMemo(() => {
    const mon = startOfWeek(new Date())
    const sun = addDays(mon, 6)
    return occurrencesInRange(routines, goal.deadline, mon, sun)
  }, [routines, goal.deadline])

  function handleLog() {
    const n = parseFloat(amount)
    if (isNaN(n) || n <= 0) {
      toast.error('Enter an amount greater than 0')
      return
    }
    const iso = date === todayStr() ? new Date().toISOString() : isoForDayKey(date, '12:00')
    addLog.mutate(
      { amount: n, note: note.trim() || null, date: iso },
      {
        onSuccess: () => {
          toast.success(`Logged ${formatNumber(n)} ${unit || 'progress'}`)
          setAmount('')
          setNote('')
        },
        onError: (e) => toast.error('Could not log progress', { description: e.message }),
      },
    )
  }

  function cycleStepStatus(step: GoalStepData) {
    const order: StepStatus[] = ['pending', 'in_progress', 'done']
    const next = order[(order.indexOf(step.status) + 1) % 3]
    updateStep.mutate(
      { stepId: step.id, patch: { status: next } },
      {
        onSuccess: () => {
          if (next === 'done') toast.success('Step completed! 🎉', { description: step.title })
        },
        onError: (e) => toast.error('Could not update step', { description: e.message }),
      },
    )
  }

  function handleScopeImport() {
    try {
      const parsed = parseGoalScopeImport(JSON.parse(scopeJson))
      const total = parsed.paths.length + parsed.steps.length + parsed.routines.length
      if (total === 0) {
        toast.error('Nothing to import — no paths, steps or routines found')
        return
      }
      scopeImport.mutate(JSON.parse(scopeJson), {
        onSuccess: (res) => {
          const s = res.summary
          const mergedAny =
            s && (s.pathsUpdated + s.nodesUpdated + s.routinesUpdated + s.stepsUpdated + s.donesAdded) > 0
          toast.success('Imported into goal', {
            description: s
              ? `${res.added.paths} new paths · ${res.added.steps} new steps · ${res.added.routines} new routines${mergedAny ? ' — matching items updated, progress kept' : ''}`
              : `${res.added.paths} paths · ${res.added.steps} steps · ${res.added.routines} routines`,
          })
          setScopeJson('')
          setScopeOpen(false)
        },
        onError: (e) => toast.error('Import failed', { description: e.message }),
      })
    } catch (e) {
      toast.error('Invalid JSON', { description: e instanceof Error ? e.message : undefined })
    }
  }

  const projection = (() => {
    if (stats.status === 'completed') return { text: 'Goal completed — nice work!', tone: 'good' as const }
    if (!stats.projectedFinishDate)
      return { text: 'Log some progress to see your projection.', tone: 'muted' as const }
    const d = stats.projectedFinishDate
    if (goal.deadline && d.getTime() <= new Date(goal.deadline).getTime()) {
      const daysEarly = Math.ceil((new Date(goal.deadline).getTime() - d.getTime()) / 86_400_000)
      return {
        text: `At your current pace you'll finish around ${formatDateShort(d)} — ${daysEarly} day${daysEarly === 1 ? '' : 's'} early.`,
        tone: 'good' as const,
      }
    }
    const daysLate = goal.deadline
      ? Math.ceil((d.getTime() - new Date(goal.deadline).getTime()) / 86_400_000)
      : null
    return {
      text: `At your current pace you'll finish around ${formatDateShort(d)}${daysLate ? ` — ${daysLate} day${daysLate === 1 ? '' : 's'} late` : ''}. Time to pick up the pace!`,
      tone: 'warn' as const,
    }
  })()

  return (
    <>
      {/* header — compact on phones so the tabs below stay on-screen */}
      <SheetHeader
        className="space-y-0 border-b p-4 pb-3 sm:p-6 sm:pb-4"
        style={{ background: `linear-gradient(135deg, ${c.soft}, transparent 60%)` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3 sm:gap-3.5">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-xl sm:h-14 sm:w-14 sm:text-2xl"
              style={{ background: c.soft, borderColor: `${c.hex}55` }}
            >
              {goal.emoji}
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-lg leading-tight sm:text-xl">{goal.title}</SheetTitle>
              {goal.description && <ClampedDescription text={goal.description} />}
              {/* one scrollable line on phones, wrapping on larger screens */}
              <div className="nice-scroll mt-2 flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 sm:mt-2.5 sm:flex-wrap sm:overflow-visible sm:pb-0">
                <Badge variant="secondary" className="gap-1">
                  {goal.type === 'quantitative' ? <Target className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
                  {goal.type === 'quantitative' ? 'Target goal' : 'Plan goal'}
                </Badge>
                {goal.category && (
                  <Badge variant="secondary" className="gap-1">
                    <ClipboardList className="h-3 w-3" />
                    {goal.category}
                  </Badge>
                )}
                {goal.deadline && (
                  <Badge variant="secondary" className="gap-1">
                    <CalendarDays className="h-3 w-3" />
                    by {formatDateLong(new Date(goal.deadline))}
                    {stats.daysLeft != null && stats.status !== 'completed' && ` · ${stats.daysLeft}d left`}
                  </Badge>
                )}
                {stats.streakWeeks > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    <Flame className="h-3 w-3 text-orange-500" /> {stats.streakWeeks}w streak
                  </Badge>
                )}
                {skillMap.stats.totalNodes > 0 && (
                  <Badge variant="secondary" className="gap-1">
                    <MapIcon className="h-3 w-3" />
                    {skillMap.stats.progressPct}% skills
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 gap-1 pr-9">
            <Button variant="outline" size="icon" aria-label="Edit goal" onClick={() => onEdit(goal)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Delete goal" className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this goal?</AlertDialogTitle>
                  <AlertDialogDescription>
                    &ldquo;{goal.title}&rdquo; and all of its steps, routines, skill maps and logged progress will be
                    permanently removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-white hover:bg-destructive/90"
                    onClick={() => {
                      deleteGoal.mutate(goal.id, {
                        onSuccess: () => {
                          toast.success('Goal deleted')
                          onOpenChange(false)
                        },
                        onError: (e) => toast.error('Could not delete goal', { description: e.message }),
                      })
                    }}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <div className="mt-2 sm:mt-3">
          <StatusBadge status={stats.status} />
        </div>
      </SheetHeader>

      {/* tabs */}
      <div className="nice-scroll flex-1 overflow-y-auto">
        <Tabs defaultValue={initialTab ?? 'overview'} className="gap-0">
          <div className="sticky top-0 z-10 border-b bg-background/90 px-4 pt-3 backdrop-blur sm:px-6">
            <TabsList className="nice-scroll h-10 w-full justify-start gap-1 overflow-x-auto rounded-lg bg-muted/60 p-1">
              {[
                { v: 'overview', label: 'Overview', icon: TrendingUp },
                { v: 'steps', label: 'Steps', icon: ListChecks },
                { v: 'skills', label: 'Skills', icon: MapIcon },
                { v: 'routine', label: 'Routine', icon: Repeat },
                { v: 'log', label: 'Log', icon: CalendarDays },
                { v: 'notes', label: 'Notes', icon: StickyNote },
              ].map((t) => (
                <TabsTrigger
                  key={t.v}
                  value={t.v}
                  className="gap-1.5 rounded-md px-2.5 text-xs data-[state=active]:bg-background sm:text-sm"
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="space-y-6 p-4 sm:p-6">
            {/* ============ OVERVIEW ============ */}
            <TabsContent value="overview" className="mt-0">
              {stats.status === 'completed' && (
                <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <Trophy className="h-6 w-6 shrink-0 text-emerald-500" />
                  <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    Goal completed! Time to set the next one.
                  </div>
                </div>
              )}

              {goal.type === 'quantitative' && stats.targetValue != null ? (
                <>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatTile
                      label="Progress"
                      value={
                        <>
                          {formatNumber(stats.currentValue)}
                          <span className="text-sm font-normal text-muted-foreground">
                            {' '}/ {formatNumber(stats.targetValue)} {unit}
                          </span>
                        </>
                      }
                      accent={c.hex}
                      sub={`${stats.progressPct}%`}
                    />
                    <StatTile
                      label="Need per week"
                      value={
                        stats.requiredPerWeek != null && stats.requiredPerWeek > 0 ? (
                          <>
                            {formatNumber(stats.requiredPerWeek)}
                            <span className="text-sm font-normal text-muted-foreground"> {unit}</span>
                          </>
                        ) : (
                          '—'
                        )
                      }
                      sub={stats.requiredPerDay ? `≈ ${formatNumber(stats.requiredPerDay)}/day` : 'nothing left'}
                    />
                    <StatTile
                      label="Your pace"
                      value={
                        <>
                          {formatNumber(stats.actualPacePerWeek)}
                          <span className="text-sm font-normal text-muted-foreground"> {unit}/w</span>
                        </>
                      }
                      sub={`ideal: ${formatNumber(stats.idealWeeklyPace ?? 0)}/w`}
                    />
                    <StatTile
                      label="Should be at"
                      value={stats.idealValueNow != null ? formatNumber(stats.idealValueNow) : '—'}
                      sub={
                        stats.status === 'behind'
                          ? `${formatNumber(Math.max(0, (stats.idealValueNow ?? 0) - stats.currentValue))} ${unit} behind`
                          : 'on schedule'
                      }
                    />
                  </div>

                  <div
                    className={cn(
                      'rounded-xl border p-3.5 text-sm leading-relaxed',
                      projection.tone === 'good'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                        : projection.tone === 'warn'
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                          : 'border-border bg-muted/40 text-muted-foreground',
                    )}
                  >
                    <TrendingUp className="mr-1.5 inline h-4 w-4" />
                    {projection.text}
                  </div>

                  <div>
                    <h4 className="mb-2 text-sm font-semibold">Progress vs on-pace line</h4>
                    {series.length > 1 ? (
                      <CumulativeChart data={series} color={c.hex} unit={goal.unit} targetValue={stats.targetValue} />
                    ) : (
                      <div className="flex h-40 items-center justify-center rounded-xl border text-sm text-muted-foreground">
                        Start logging to see your progress chart.
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="h-0.5 w-4 rounded" style={{ background: c.hex }} /> Your progress
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-0.5 w-4 rounded border-t-2 border-dashed border-muted-foreground" /> On pace
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <StatTile
                      label={skillMap.stats.totalNodes > 0 ? 'Skills' : 'Steps done'}
                      value={
                        skillMap.stats.totalNodes > 0
                          ? `${skillMap.stats.mastered}/${skillMap.stats.totalNodes}`
                          : `${stats.stepsDone}/${stats.stepsTotal}`
                      }
                      accent={c.hex}
                      sub={
                        skillMap.stats.totalNodes > 0
                          ? `${skillMap.stats.progressPct}% · ${skillMap.stats.xpEarned} XP`
                          : `${stats.progressPct}% of the plan`
                      }
                    />
                    <StatTile
                      label="This week"
                      value={
                        <>
                          {formatNumber(stats.thisWeekLogged)}
                          <span className="text-sm font-normal text-muted-foreground">
                            {goal.weeklyTarget ? ` / ${formatNumber(goal.weeklyTarget)}` : ''} {unit || 'sessions'}
                          </span>
                        </>
                      }
                      sub={goal.weeklyTarget ? 'practice commitment' : 'logged practice'}
                    />
                    <StatTile
                      label={stats.stepsTotal > 0 ? 'Steps / week' : 'Routines'}
                      value={
                        stats.stepsTotal > 0
                          ? stats.requiredStepsPerWeek != null
                            ? `~${stats.requiredStepsPerWeek}`
                            : '—'
                          : String(routines.length)
                      }
                      sub={stats.stepsTotal > 0 ? 'to finish on time' : 'scheduled'}
                    />
                    <StatTile
                      label="Streak"
                      value={`${stats.streakWeeks}w`}
                      sub="weeks kept up"
                    />
                  </div>

                  {skillMap.stats.totalNodes > 0 && (
                    <div
                      className={cn(
                        'rounded-xl border p-3.5 text-sm leading-relaxed',
                        skillMap.stats.pace === 'ahead'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                          : skillMap.stats.pace === 'behind'
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                            : 'border-border bg-muted/40 text-muted-foreground',
                      )}
                    >
                      <MapIcon className="mr-1.5 inline h-4 w-4" />
                      Skill map at {skillMap.stats.progressPct}%
                      {skillMap.stats.expectedPct != null && (
                        <> — you should be around {skillMap.stats.expectedPct}% by now.</>
                      )}
                      {skillMap.stats.pace === 'behind' && ' A small tier win today is all it takes to shift the curve.'}
                      {skillMap.stats.pace === 'ahead' && ' Ahead of the curve — keep going!'}
                    </div>
                  )}

                  {goal.logs.length > 0 && (
                    <div>
                      <h4 className="mb-2 text-sm font-semibold">Practice — last 8 weeks</h4>
                      <WeeklyBars
                        data={weekly}
                        color={c.hex}
                        unit={goal.unit}
                        requirement={weekRequirement}
                      />
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* ============ STEPS ============ */}
            <TabsContent value="steps" className="mt-0">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold">
                  Your plan <span className="font-normal text-muted-foreground">({stats.stepsDone}/{stats.stepsTotal} done)</span>
                </h4>
                <span className="text-xs text-muted-foreground">tap the circle to change status</span>
              </div>
              <div className="space-y-1.5">
                {goal.steps.map((step) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    isNext={stats.nextStep?.id === step.id}
                    busy={updateStep.isPending || deleteStep.isPending}
                    onCycle={() => cycleStepStatus(step)}
                    onMove={(dir) =>
                      updateStep.mutate({ stepId: step.id, patch: { move: dir } }, {
                        onError: (e) => toast.error('Could not move step', { description: e.message }),
                      })
                    }
                    onEdit={(patch) =>
                      updateStep.mutate(
                        { stepId: step.id, patch },
                        {
                          onSuccess: () => toast.success('Step updated'),
                          onError: (e) => toast.error('Could not update step', { description: e.message }),
                        },
                      )
                    }
                    onDelete={() =>
                      deleteStep.mutate(step.id, {
                        onSuccess: () => toast.success('Step removed'),
                        onError: (e) => toast.error('Could not remove step', { description: e.message }),
                      })
                    }
                  />
                ))}
                {goal.steps.length === 0 && (
                  <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No steps yet — break this goal into concrete steps below.
                  </div>
                )}
              </div>
              <div className="mt-2.5 flex gap-2">
                <Input
                  value={newStep}
                  onChange={(e) => setNewStep(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newStep.trim()) {
                      e.preventDefault()
                      addStep.mutate(
                        { title: newStep.trim() },
                        {
                          onSuccess: () => {
                            setNewStep('')
                            toast.success('Step added')
                          },
                          onError: (e2) => toast.error('Could not add step', { description: e2.message }),
                        },
                      )
                    }
                  }}
                  placeholder="Add a step to your plan…"
                  maxLength={200}
                />
                <Button
                  variant="secondary"
                  disabled={!newStep.trim() || addStep.isPending}
                  onClick={() =>
                    addStep.mutate(
                      { title: newStep.trim() },
                      {
                        onSuccess: () => {
                          setNewStep('')
                          toast.success('Step added')
                        },
                        onError: (e2) => toast.error('Could not add step', { description: e2.message }),
                      },
                    )
                  }
                >
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>
            </TabsContent>

            {/* ============ SKILLS ============ */}
            <TabsContent value="skills" className="mt-0">
              {skillMap.stats.totalNodes > 0 && (
                <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatTile
                    label="Map progress"
                    value={`${skillMap.stats.progressPct}%`}
                    accent={c.hex}
                    sub={`${formatNumber(skillMap.stats.current)} / ${formatNumber(skillMap.stats.target)}`}
                  />
                  <StatTile
                    label="Tiers mastered"
                    value={`${skillMap.stats.mastered}/${skillMap.stats.totalNodes}`}
                    sub={`${skillMap.stats.inProgress} in progress`}
                  />
                  <StatTile
                    label="XP earned"
                    value={skillMap.stats.xpEarned}
                    sub={`of ${skillMap.stats.xpTotal} in this map`}
                  />
                  <StatTile
                    label="Pace"
                    value={
                      skillMap.stats.pace === 'ahead'
                        ? 'Ahead'
                        : skillMap.stats.pace === 'on_track'
                          ? 'On pace'
                          : skillMap.stats.pace === 'behind'
                            ? 'Behind'
                            : '—'
                    }
                    sub={skillMap.stats.expectedPct != null ? `expected ${skillMap.stats.expectedPct}%` : 'no deadline'}
                  />
                </div>
              )}

              <SkillMapGrid goal={goal} />

              {/* scope import */}
              <div className="mt-4">
                {scopeOpen ? (
                  <div className="rounded-xl border bg-card p-3">
                    <Label className="text-xs font-semibold">Add paths/steps/routines from JSON</Label>
                    <Textarea
                      value={scopeJson}
                      onChange={(e) => setScopeJson(e.target.value)}
                      placeholder={'{ "paths": [ { "title": "Vocabulary", "nodes": [ { "title": "HSK4", "target": 1200 } ] } ] }'}
                      rows={5}
                      className="mt-1.5 font-mono text-xs"
                      spellCheck={false}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setScopeOpen(false)}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={handleScopeImport} disabled={scopeImport.isPending || !scopeJson.trim()}>
                        {scopeImport.isPending ? 'Importing…' : 'Import into this goal'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setScopeOpen(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed p-3 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" /> Import paths from JSON
                  </button>
                )}
              </div>
            </TabsContent>

            {/* ============ ROUTINE ============ */}
            <TabsContent value="routine" className="mt-0">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold">Weekly routine</h4>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditRoutine(null)
                    setRoutineDialogOpen(true)
                  }}
                >
                  <Plus className="h-4 w-4" /> Add routine
                </Button>
              </div>

              {routines.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No routine yet. Add e.g. <span className="font-medium text-foreground">&ldquo;drills every 2 days&rdquo;</span> or
                  a deeper <span className="font-medium text-foreground">&ldquo;focused session every Sunday&rdquo;</span>.
                </div>
              ) : (
                <>
                  {/* this week */}
                  <div className="rounded-xl border bg-card p-4">
                    <div className="mb-3 text-sm font-semibold">This week</div>
                    <div className="space-y-1.5">
                      {weekRoutineOccs.length === 0 && (
                        <div className="text-xs text-muted-foreground">Nothing scheduled this week.</div>
                      )}
                      {weekRoutineOccs.map((o) => (
                        <div
                          key={o.routine.id + o.date.toISOString()}
                          className={cn(
                            'flex items-center gap-2.5 rounded-lg border p-2',
                            o.done ? 'border-primary/25 bg-primary/5' : 'border-border/70',
                          )}
                        >
                          <button
                            type="button"
                            aria-label={o.done ? `Undo ${o.routine.title}` : `Mark ${o.routine.title} done`}
                            onClick={() =>
                              toggleDone.mutate(
                                {
                                  goalId: goal.id,
                                  routineId: o.routine.id,
                                  date: toDayKey(o.date), // calendar day — TZ-proof
                                  undo: o.done,
                                },
                                {
                                  onSuccess: (res) => {
                                    if (res.creditSkipped) {
                                      toast('Session logged — but its checkpoint is still locked, so no tree progress yet', {
                                        icon: '🔒',
                                      })
                                    }
                                  },
                                },
                              )
                            }
                            className={cn(
                              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all hover:scale-110',
                              o.done
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-muted-foreground/40 hover:border-primary',
                            )}
                          >
                            {o.done && <Check className="h-3 w-3" strokeWidth={3} />}
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className={cn('text-xs font-semibold', o.done && 'line-through')}>{o.routine.title}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {relativeDayLabel(o.date)}
                              {o.routine.durationMin != null && ` · ${o.routine.durationMin}m`}
                            </div>
                          </div>
                          {o.isToday && !o.done && (
                            <Badge className="bg-primary/15 text-primary hover:bg-primary/15">Today</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* routine list */}
                  <div className="space-y-2">
                    {routines.map((r) => {
                      const rs = routineStats(r, goal.deadline, 4)
                      return (
                        <div key={r.id} className="group flex items-center gap-3 rounded-xl border bg-card p-3">
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                            style={{ background: c.soft }}
                          >
                            <Repeat className="h-4 w-4" style={{ color: c.hex }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">
                              {r.title}
                              {r.optional && (
                                <span
                                  className="ml-1.5 rounded-full bg-violet-500/15 px-1.5 py-px align-middle text-[9px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400"
                                  title="Extra credit — nice to do, skipping it never counts against you"
                                >
                                  extra
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                              <span>{describeCadence(r)}</span>
                              {r.durationMin != null && <span>· {r.durationMin}m</span>}
                              {rs.next && (
                                <span>
                                  · next {sameDay(rs.next, new Date()) ? 'today' : relativeDayLabel(rs.next)}
                                </span>
                              )}
                            </div>
                            {r.notes && <div className="mt-1 truncate text-[11px] italic text-muted-foreground/80">{r.notes}</div>}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {r.optional ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-violet-500/12 px-2 py-0.5 text-[11px] font-semibold text-violet-600 tabular-nums dark:text-violet-400"
                                title="Extra credit — nice to do, skipping it never counts against you"
                              >
                                <Sparkles className="h-3 w-3" /> extra credit
                              </span>
                            ) : (
                              rs.adherencePct != null && (
                                <span
                                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                                  style={{
                                    background:
                                      rs.adherencePct >= 70
                                        ? 'rgba(16,185,129,0.12)'
                                        : rs.adherencePct >= 40
                                          ? 'rgba(245,158,11,0.14)'
                                          : 'rgba(100,116,139,0.14)',
                                    color:
                                      rs.adherencePct >= 70 ? '#10b981' : rs.adherencePct >= 40 ? '#f59e0b' : '#64748b',
                                  }}
                                  title="Recent adherence — forgiven sessions don't count against you"
                                >
                                  {rs.adherencePct}%
                                </span>
                              )
                            )}
                            {/* always visible on touch — hover-reveal only on desktop */}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
                              aria-label="Edit routine"
                              onClick={() => {
                                setEditRoutine(r)
                                setRoutineDialogOpen(true)
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-destructive opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
                                  aria-label={`Delete routine ${r.title}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete this routine?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    &ldquo;{r.title}&rdquo; stops repeating and its check-off history is removed. Practice
                                    you already logged stays in your history.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-white hover:bg-destructive/90"
                                    onClick={() =>
                                      deleteRoutine.mutate(
                                        { routineId: r.id },
                                        {
                                          onSuccess: () => toast.success('Routine deleted'),
                                          onError: (e) =>
                                            toast.error('Could not delete routine', { description: e.message }),
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
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </TabsContent>

            {/* ============ LOG ============ */}
            <TabsContent value="log" className="mt-0">
              <h4 className="mb-3 text-sm font-semibold">
                Log {goal.type === 'plan' ? 'a practice session' : 'progress'}
              </h4>
              <div className="space-y-3 rounded-xl border bg-card p-4">
                <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                  <div className="space-y-1.5">
                    <Label htmlFor="log-amount">
                      Amount {goal.type === 'plan' && !goal.unit ? '(e.g. 1 session)' : `(${unit || 'amount'})`}
                    </Label>
                    <Input
                      id="log-amount"
                      type="number"
                      min={0}
                      step="any"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLog()}
                      placeholder={goal.type === 'plan' ? '1' : 'e.g. 25'}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="log-note">Note (optional)</Label>
                    <Input
                      id="log-note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLog()}
                      placeholder={goal.type === 'plan' ? 'What did you practice?' : 'e.g. chapter 4'}
                      maxLength={500}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {quickAmounts(goal.unit).map((q) => (
                    <Button key={q} type="button" variant="secondary" size="sm" onClick={() => setAmount(String(q))}>
                      +{formatNumber(q)} {unit}
                    </Button>
                  ))}
                  <div className="w-[150px]">
                    <Input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} aria-label="Date of this entry" />
                  </div>
                  <Button className="ml-auto" onClick={handleLog} disabled={addLog.isPending}>
                    <Check className="h-4 w-4" /> Log it
                  </Button>
                </div>
              </div>

              {goal.logs.length > 0 && (
                <div className="mt-5">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <h4 className="text-sm font-semibold">History</h4>
                    <span className="text-[11px] text-muted-foreground">tap an entry to edit it</span>
                  </div>
                  <div className="max-h-72 space-y-1.5 overflow-y-auto nice-scroll pr-1">
                    {goal.logs.map((log) => (
                      <div
                        key={log.id}
                        className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm transition-colors hover:border-primary/40"
                      >
                        {/* the row itself opens the full editor — amount, day, note */}
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                          aria-label={`Edit entry: ${formatNumber(log.amount)} ${unit || 'logged'}`}
                          title="Edit amount, day or note"
                          onClick={() =>
                            setEditLog({
                              goalId: goal.id,
                              logId: log.id,
                              amount: log.amount,
                              unit: logUnit,
                              title: goal.title,
                              note: log.note,
                              day: dayKeyOf(new Date(log.date)),
                            })
                          }
                        >
                          <div className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                            {formatDateShort(new Date(log.date))}
                          </div>
                          <div className="flex shrink-0 items-center gap-1 font-semibold tabular-nums" style={{ color: c.hex }}>
                            +{formatNumber(log.amount)} {unit}
                            <Pencil className="h-3 w-3 opacity-30 transition-opacity group-hover:opacity-70" />
                          </div>
                          <div className="min-w-0 flex-1 truncate text-muted-foreground">{log.note ?? ''}</div>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-destructive opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
                          aria-label="Delete log entry"
                          disabled={deleteLog.isPending}
                          onClick={() =>
                            deleteLog.mutate(log.id, {
                              onSuccess: () => toast.success('Entry removed'),
                              onError: (e) => toast.error('Could not remove entry', { description: e.message }),
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ============ NOTES ============ */}
            <TabsContent value="notes" className="mt-0">
              <h4 className="mb-3 text-sm font-semibold">Notes &amp; references</h4>
              <div className="flex gap-2">
                <Textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && newNote.trim()) {
                      e.preventDefault()
                      addNote.mutate(
                        { content: newNote.trim() },
                        {
                          onSuccess: () => {
                            setNewNote('')
                            toast.success('Note added')
                          },
                          onError: (e2) => toast.error('Could not add note', { description: e2.message }),
                        },
                      )
                    }
                  }}
                  placeholder="Insights, links, what worked, what to try next…"
                  rows={2}
                  maxLength={2000}
                />
                <Button
                  className="self-end"
                  disabled={!newNote.trim() || addNote.isPending}
                  onClick={() =>
                    addNote.mutate(
                      { content: newNote.trim() },
                      {
                        onSuccess: () => {
                          setNewNote('')
                          toast.success('Note added')
                        },
                        onError: (e2) => toast.error('Could not add note', { description: e2.message }),
                      },
                    )
                  }
                >
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>

              <div className="mt-4 space-y-2">
                {goal.notes.length === 0 && (
                  <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No notes yet — capture the small things you&apos;ll forget.
                  </div>
                )}
                {goal.notes.map((n) => (
                  <div
                    key={n.id}
                    className={cn(
                      'group rounded-xl border bg-card p-3 text-sm leading-relaxed',
                      n.pinned && 'border-primary/30 bg-primary/5',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 whitespace-pre-wrap">{n.content}</p>
                      {/* always visible on touch — hover-reveal only on desktop */}
                      <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          aria-label={n.pinned ? 'Unpin note' : 'Pin note'}
                          onClick={() =>
                            updateNote.mutate({ noteId: n.id, patch: { pinned: !n.pinned } })
                          }
                        >
                          {n.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          aria-label="Delete note"
                          onClick={() =>
                            deleteNote.mutate(n.id, {
                              onSuccess: () => toast.success('Note removed'),
                              onError: (e) => toast.error('Could not remove note', { description: e.message }),
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-1.5 text-[10px] text-muted-foreground">
                      {n.pinned ? 'Pinned · ' : ''}
                      {new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* log entry editor — keyed so form state resets for each entry */}
      <EditLogDialog key={editLog?.logId ?? 'none'} target={editLog} onClose={() => setEditLog(null)} />

      {/* routine dialog — keyed so form state resets each time it opens */}
      <RoutineDialog
        key={`${editRoutine?.id ?? 'new'}-${routineDialogOpen}`}
        goal={goal}
        routine={editRoutine}
        open={routineDialogOpen}
        onOpenChange={(o) => {
          setRoutineDialogOpen(o)
          if (!o) setEditRoutine(null)
        }}
      />
    </>
  )
}
