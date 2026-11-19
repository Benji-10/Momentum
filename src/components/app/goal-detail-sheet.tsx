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
  Clock,
  Eye,
  EyeOff,
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
  isSessionCountingGoal,
  weeklyHistory,
} from '@/lib/goal-math'
import { goalColor } from '@/lib/goal-colors'
import { logRowUnit, logAmountLabel, checkoffDisplayUnit, isTimeUnitString } from '@/lib/recording'
import { countsTowardGoal, sameUnitFamily } from '@/lib/units'
import { beatsPb } from '@/lib/pb-math'
import { buildSkillMap } from '@/lib/skill-tree'
import { describeCadence, occurrencesInRange, relativeDayLabel, routineStats, sameDay, startOfWeek, addDays, toDayKey } from '@/lib/routine-math'
import { dayKeyOf, getAppTimezone, isoForDayKey, todayDayKey } from '@/lib/app-time'
import { parseGoalScopeImport } from '@/lib/import-format'
import { EditLogDialog, type EditLogTarget } from '@/components/app/edit-log-dialog'
import {
  useAddLog,
  useAddNote,
  useAddPbRecord,
  useAddStep,
  useDeleteGoal,
  useDeleteLog,
  useDeleteNote,
  useDeleteRoutine,
  useDeleteStep,
  useGoalScopeImport,
  useToggleRoutineDone,
  useUpdateGoal,
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
import { RoutineTitle } from '@/components/app/routine-title'
import { stepTriggerInfo } from '@/lib/step-triggers'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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

/** Patch shape StepRow can send back (title/notes plus automation). */
export interface StepEditPatch {
  title: string
  notes: string | null
  /** target date — ISO instant, or null to clear it */
  dueDate?: string | null
  trigger?: 'manual' | 'routine' | 'metric'
  routineId?: string | null
  triggerCount?: number
  metricName?: string | null
  metricWindow?: number | null
  metricOp?: 'under' | 'over' | null
  metricValue?: number | null
}

/** a − b in whole days, both "YYYY-MM-DD" day keys */
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)
}

/** Due-date chip text: "Due today" / "Due tomorrow" / "Due 24 Nov" / "3d overdue" */
function dueMeta(step: GoalStepData): { label: string; overdue: boolean } | null {
  if (!step.dueDate || step.status === 'done') return null
  const dueKey = dayKeyOf(new Date(step.dueDate), getAppTimezone())
  const today = todayDayKey()
  const diff = dayDiff(dueKey, today)
  if (diff < 0) return { label: `${-diff}d overdue`, overdue: true }
  if (diff === 0) return { label: 'Due today', overdue: true }
  if (diff === 1) return { label: 'Due tomorrow', overdue: false }
  if (diff <= 7) return { label: `Due in ${diff}d`, overdue: false }
  return { label: `Due ${formatDateShort(new Date(step.dueDate))}`, overdue: false }
}

function StepRow({
  step,
  goal,
  isNext,
  onCycle,
  onMove,
  onDelete,
  onEdit,
}: {
  step: GoalStepData
  goal: GoalData
  isNext: boolean
  onCycle: () => void
  onMove: (dir: 'up' | 'down') => void
  onDelete: () => void
  onEdit: (patch: StepEditPatch) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(step.title)
  const [notes, setNotes] = useState(step.notes ?? '')

  // automation editor state — seeded from the step, saved with the patch
  const [kind, setKind] = useState<'manual' | 'routine' | 'metric'>(step.trigger ?? 'manual')
  const [routineId, setRoutineId] = useState<string>(step.routineId ?? '')
  const [count, setCount] = useState<string>(String(step.triggerCount ?? 1))
  const [metricName, setMetricName] = useState<string>(step.metricName ?? '')
  const [window, setWindow] = useState<string>(String(step.metricWindow ?? 3))
  const [op, setOp] = useState<'under' | 'over'>(step.metricOp ?? 'under')
  const [value, setValue] = useState<string>(step.metricValue != null ? String(step.metricValue) : '')
  // target date — "" = none (the input's own empty state)
  const [due, setDue] = useState<string>(step.dueDate ? dayKeyOf(new Date(step.dueDate), getAppTimezone()) : '')

  const info = stepTriggerInfo(goal, step)
  const dueChip = dueMeta(step)

  const icon =
    step.status === 'done' ? (
      <CheckCircle2 className="h-5 w-5 text-success" />
    ) : step.status === 'in_progress' ? (
      <CircleDot className="h-5 w-5 text-warning" />
    ) : (
      <Circle className="h-5 w-5 text-muted-foreground" />
    )

  function openEditor() {
    setTitle(step.title)
    setNotes(step.notes ?? '')
    setKind(step.trigger ?? 'manual')
    setRoutineId(step.routineId ?? '')
    setCount(String(step.triggerCount ?? 1))
    setMetricName(step.metricName ?? '')
    setWindow(String(step.metricWindow ?? 3))
    setOp(step.metricOp ?? 'under')
    setValue(step.metricValue != null ? String(step.metricValue) : '')
    setDue(step.dueDate ? dayKeyOf(new Date(step.dueDate), getAppTimezone()) : '')
    setEditing(!editing)
  }

  const countNum = Math.min(999, Math.max(1, Math.round(Number(count) || 1)))
  const windowNum = Math.min(50, Math.max(1, Math.round(Number(window) || 3)))
  const valueNum = Number(value)

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
          {!editing && info.kind !== 'manual' && (
            <div
              className="mt-1 flex items-start gap-1 text-[11px] leading-snug"
              title="Automation — this step completes itself; you can still tick it by hand"
            >
              <Zap className={cn('mt-px h-3 w-3 shrink-0', info.satisfied ? 'text-amber-500' : 'text-muted-foreground/70')} />
              <span className="text-muted-foreground">
                <span className={cn(info.satisfied && 'font-semibold text-amber-600 dark:text-amber-400')}>
                  {info.label}
                </span>
                {info.status ? <span> · {info.status}</span> : null}
              </span>
            </div>
          )}
          {isNext && step.status !== 'done' && !editing && (
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-primary">Next up</div>
          )}
          {dueChip && !editing && (
            <div
              className={cn(
                'mt-0.5 inline-flex w-fit items-center gap-1 rounded px-1 text-[11px] font-semibold leading-snug',
                dueChip.overdue
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-muted text-muted-foreground',
              )}
              title={step.dueDate ? `Target date — ${formatDateLong(new Date(step.dueDate))}` : undefined}
            >
              <CalendarDays className="h-3 w-3 shrink-0" />
              {dueChip.label}
            </div>
          )}
        </div>
        {/* always visible on touch — hover-reveal only on desktop */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={`Edit step "${step.title}"`}
            title="Rename, add notes, set up automation"
            onClick={openEditor}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move up" onClick={() => onMove('up')}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move down" onClick={() => onMove('down')}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label="Delete step" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {editing && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Step title"
            maxLength={200}
            className="h-8"
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

          {/* target date — the step's own deadline, separate from how it completes */}
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={`step-due-${step.id}`} className="flex shrink-0 items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <CalendarDays className="h-3 w-3" /> Target date
            </Label>
            <Input
              id={`step-due-${step.id}`}
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-label="Target date (optional)"
              className="h-8 min-w-0 px-2.5 text-xs"
            />
            {due && (
              <button
                type="button"
                onClick={() => setDue('')}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          {/* ---- automation: how does this step complete? ---- */}
          <div className="rounded-lg border bg-muted/30 p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
              <Zap className="h-3.5 w-3.5 text-amber-500" /> How does this step complete?
            </div>
            <div role="radiogroup" aria-label="Step automation" className="flex rounded-full border p-0.5">
              {(
                [
                  { v: 'manual', label: 'Tick by hand' },
                  { v: 'routine', label: 'Routine check-offs' },
                  { v: 'metric', label: 'Metric bar' },
                ] as const
              ).map((o) => (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={kind === o.v}
                  onClick={() => setKind(o.v)}
                  className={cn(
                    'flex-1 rounded-full px-2 py-1 text-[11px] font-semibold transition-colors',
                    kind === o.v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {kind === 'routine' && (
              <div className="mt-2 grid grid-cols-[1fr_88px] gap-2">
                <Select value={routineId} onValueChange={setRoutineId}>
                  <SelectTrigger className="h-8 text-xs" aria-label="Which routine advances this step">
                    <SelectValue placeholder="Any routine" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any routine (broadest)</SelectItem>
                    {goal.routines
                      .filter((r) => !r.archived)
                      .map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.title}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center rounded-md border">
                  <span className="pl-2 text-xs text-muted-foreground">×</span>
                  <Input
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    inputMode="numeric"
                    aria-label="Check-offs needed"
                    className="h-8 border-0 focus-visible:ring-0"
                  />
                </div>
                <p className="col-span-2 text-[11px] leading-snug text-muted-foreground">
                  Completes itself after {countNum} check-off{countNum === 1 ? '' : 's'} of{' '}
                  {routineId && routineId !== 'any'
                    ? `“${goal.routines.find((r) => r.id === routineId)?.title ?? 'that routine'}”`
                    : 'any routine'}
                  . Only check-offs made while it&rsquo;s the current step count.
                </p>
              </div>
            )}

            {kind === 'metric' && (
              <div className="mt-2 space-y-2">
                {goal.pbs.length === 0 ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    No metrics yet — track one on the <span className="font-medium text-foreground">Review</span> tab
                    first (e.g. “Inspection”, lower is better), then pick it here.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-[1fr_88px] gap-2">
                      <Select value={metricName} onValueChange={setMetricName}>
                        <SelectTrigger className="h-8 text-xs" aria-label="Which metric unlocks this step">
                          <SelectValue placeholder="Pick a metric" />
                        </SelectTrigger>
                        <SelectContent>
                          {goal.pbs.map((pb) => (
                            <SelectItem key={pb.id} value={pb.name}>
                              {pb.name}
                              {pb.unit ? ` (${pb.unit})` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center rounded-md border">
                        <span className="pl-2 text-xs text-muted-foreground">avg</span>
                        <Input
                          value={window}
                          onChange={(e) => setWindow(e.target.value)}
                          inputMode="numeric"
                          aria-label="Rolling-average window (attempts)"
                          className="h-8 border-0 text-xs focus-visible:ring-0"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-[1fr_96px] gap-2">
                      <Select value={op} onValueChange={(v) => setOp(v as 'under' | 'over')}>
                        <SelectTrigger className="h-8 text-xs" aria-label="Threshold direction">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="under">drops below</SelectItem>
                          <SelectItem value="over">rises above</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        inputMode="decimal"
                        placeholder="15"
                        aria-label="Threshold value"
                        className="h-8"
                      />
                    </div>
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Completes itself when the average of the last {windowNum} attempt
                      {windowNum === 1 ? '' : 's'} of {metricName ? `“${metricName}”` : 'the metric'}{' '}
                      {op === 'under' ? 'drops below' : 'rises above'} {value.trim() || '—'}
                      {goal.pbs.find((p) => p.name === metricName)?.unit
                        ? ` ${goal.pbs.find((p) => p.name === metricName)?.unit}`
                        : ''}
                      .
                    </p>
                  </>
                )}
              </div>
            )}

            {kind === 'manual' && (
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                The classic checklist: you tick the circle yourself, nothing happens automatically.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={!title.trim() || (kind === 'metric' && (!metricName || !(valueNum > 0)))}
              onClick={() => {
                onEdit({
                  title: title.trim(),
                  notes: notes.trim() || null,
                  // "" clears the date; a picked day is stored as ~noon in the
                  // app timezone so it renders on that day on every device
                  dueDate: due ? isoForDayKey(due, '12:00') : null,
                  ...(kind === 'routine'
                    ? {
                        trigger: 'routine',
                        routineId: routineId && routineId !== 'any' ? routineId : null,
                        triggerCount: countNum,
                      }
                    : {}),
                  ...(kind === 'metric'
                    ? {
                        trigger: 'metric',
                        metricName,
                        metricWindow: windowNum,
                        metricOp: op,
                        metricValue: valueNum,
                      }
                    : {}),
                  ...(kind === 'manual' ? { trigger: 'manual' } : {}),
                })
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
  /** the Log tab's "counts toward" pick: 'goal' = the goal's own ledger,
   *  else the checkpoint id the entry should credit ("150 pages") */
  const [creditTo, setCreditTo] = useState('goal')
  /** unit picked for a goal-ledger entry that ISN'T the goal's own ("45 min"
   *  of reading on a pages goal) — null = the goal's unit. Foreign-unit
   *  entries are real, editable history that never inflate the goal's sums. */
  const [unitTo, setUnitTo] = useState<string | null>(null)
  /** PB metrics to also record this entry as an attempt for (opt-in chips —
   *  one session, one tap, no second trip to the Review tab). Keyed by the
   *  entry's unit so switching the "counts toward" pick starts fresh. */
  const [attemptPick, setAttemptPick] = useState<{ unit: string; ids: string[] }>({ unit: '', ids: [] })
  const [newStep, setNewStep] = useState('')
  const [newNote, setNewNote] = useState('')
  /** per-goal "hide done steps" on: shows the hidden completed steps for
   *  this open sheet until it closes (the persisted flag is untouched) */
  const [revealDone, setRevealDone] = useState(false)
  const [routineDialogOpen, setRoutineDialogOpen] = useState(false)
  const [editRoutine, setEditRoutine] = useState<RoutineData | null>(null)
  const [scopeJson, setScopeJson] = useState('')
  const [scopeOpen, setScopeOpen] = useState(false)
  /** full editor for one history entry (amount, day, note) */
  const [editLog, setEditLog] = useState<EditLogTarget | null>(null)

  const addLog = useAddLog(goal.id)
  const addPbRecord = useAddPbRecord(goal.id)
  const deleteLog = useDeleteLog(goal.id)
  const addStep = useAddStep(goal.id)
  const updateStep = useUpdateStep(goal.id)
  const deleteStep = useDeleteStep(goal.id)
  const updateGoal = useUpdateGoal()
  const deleteGoal = useDeleteGoal()
  const addNote = useAddNote(goal.id)
  const updateNote = useUpdateNote(goal.id)
  const deleteNote = useDeleteNote(goal.id)
  const toggleDone = useToggleRoutineDone()
  const scopeImport = useGoalScopeImport(goal.id)
  const deleteRoutine = useDeleteRoutine(goal.id)

  const stats = useMemo(() => computeGoalStats(goal), [goal])
  // plan list for the Steps tab: the per-goal "hide done steps" preference
  // filters completed steps out of the list; revealDone (local to this open
  // sheet) shows them anyway without touching the saved preference
  const doneStepCount = goal.steps.filter((s) => s.status === 'done').length
  const shownSteps =
    goal.hideDoneSteps && !revealDone ? goal.steps.filter((s) => s.status !== 'done') : goal.steps
  const series = useMemo(() => cumulativeSeries(goal), [goal])
  const weekly = useMemo(() => weeklyHistory(goal, 8), [goal])
  const skillMap = useMemo(() => buildSkillMap(goal), [goal])
  // checkpoints a Log-tab entry can credit: unlocked, not mastered, not a
  // derived meter — on ANY goal type. The checkpoint's unit is the entry's
  // unit: when it matches the goal's own, the entry advances both; when it
  // differs, it's history for the goal's sums and progress for the tree
  const creditNodes = useMemo(
    () =>
      skillMap.paths
        .flatMap((p) => p.nodes)
        .filter((v) => !v.node.deriveFromId && !v.locked && v.status !== 'mastered'),
    [skillMap],
  )
  const creditTarget = creditNodes.find((v) => v.node.id === creditTo) ?? null
  // the unit this Log-tab entry will be recorded in: the credited
  // checkpoint's ("pages"), the picked alternative ("min") or the goal's own
  const entryUnit = (creditTarget?.unit ?? unitTo ?? goal.unit ?? '').trim()
  // when the entry speaks the goal's own unit it advances the goal's total
  // too; a foreign unit is history for the goal (one ledger, many units)
  const entryOnGoalLedger = creditTarget
    ? countsTowardGoal(goal, { unit: creditTarget.unit })
    : countsTowardGoal(goal, { unit: unitTo })
  // other units this goal already speaks — its metrics' and checkpoints'
  // units, plus minutes for time — offered as quick picks on manual entries
  const unitChoices = useMemo(() => {
    const goalUnit = (goal.unit ?? '').trim()
    const set = new Set<string>()
    for (const pb of goal.pbs) {
      const u = (pb.unit ?? '').trim()
      if (u && !sameUnitFamily(u, goalUnit)) set.add(u)
    }
    for (const v of creditNodes) {
      const u = (v.unit ?? '').trim()
      if (u && !sameUnitFamily(u, goalUnit)) set.add(u)
    }
    if (goalUnit && !isTimeUnitString(goalUnit) && !sameUnitFamily('min', goalUnit)) set.add('min')
    return [...set]
  }, [goal.pbs, creditNodes, goal.unit])
  // metrics speaking the same unit can record this entry as an attempt in
  // the same tap (opt-in — attempts are history, not progress, and editing
  // or deleting them works from either surface)
  const attemptablePbs = useMemo(
    () =>
      entryUnit === ''
        ? []
        : goal.pbs.filter((p) => (p.unit ?? '').trim().toLowerCase() === entryUnit.toLowerCase()),
    [goal.pbs, entryUnit],
  )
  // the picks that still apply to the current unit (dormant when the unit
  // changed — no effect needed, it all derives from attemptPick + entryUnit)
  const attemptPbIds =
    attemptPick.unit.toLowerCase() === entryUnit.toLowerCase() && entryUnit !== '' ? attemptPick.ids : []
  // log.nodeId → its checkpoint, for history-row chips and the edit dialog
  const nodeById = useMemo(() => {
    const m = new Map<string, { icon: string; title: string; unit: string | null }>()
    for (const p of goal.skillPaths)
      for (const n of p.nodes) m.set(n.id, { icon: n.icon, title: n.title, unit: n.unit ?? p.unit ?? null })
    return m
  }, [goal])
  // log.pbId → its metric (mirrored attempts), for history-row chips
  const pbById = useMemo(() => {
    const m = new Map<string, { name: string; unit: string | null }>()
    for (const pb of goal.pbs) m.set(pb.id, { name: pb.name, unit: pb.unit })
    return m
  }, [goal])
  const c = goalColor(goal.color)
  const unit = goal.unit ?? ''
  // display unit for the log editor (falls back to sessions/units); entries
  // written by a check-off carry the unit they were recorded in ("words",
  // "min"), older linked entries get it inferred from their checkpoint
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
    // the opt-in attempt records ride along with the entry: same value,
    // same day, same note — each creates its own mirrored history row
    // ("🏆 metric" chip) that edits/deletes from either surface
    const attempts = attemptablePbs.filter((p) => attemptPbIds.includes(p.id))
    addLog.mutate(
      {
        amount: n,
        note: note.trim() || null,
        date: iso,
        // a credited checkpoint owns the entry's unit (server-authoritative);
        // a goal-ledger entry carries the picked alternative unit, if any
        ...(creditTarget ? { nodeId: creditTarget.node.id, unit: creditTarget.unit } : {}),
        ...(!creditTarget && unitTo ? { unit: unitTo } : {}),
      },
      {
        onSuccess: () => {
          toast.success(
            creditTarget
              ? `Logged ${logAmountLabel(n, creditTarget.unit ?? 'units')} — advanced ${creditTarget.node.icon} ${creditTarget.node.title}`
              : unitTo
                ? `Logged ${logAmountLabel(n, unitTo)} for the history`
                : `Logged ${formatNumber(n)} ${unit || 'progress'}`,
          )
          setAmount('')
          setNote('')
          setAttemptPick({ unit: '', ids: [] })
          for (const pb of attempts) {
            const wasBest = beatsPb(pb, n)
            addPbRecord.mutate(
              { pbId: pb.id, value: n, date: iso, note: note.trim() || null },
              {
                onSuccess: () =>
                  toast.success(
                    wasBest
                      ? `New PB — ${pb.name}: ${formatNumber(n)}${pb.unit ? ` ${pb.unit}` : ''} 🏆`
                      : `Attempt recorded for ${pb.name}`,
                    { description: 'Editable from the Review tab or this history below.' },
                  ),
                // errors (incl. offline-queued saves) are reported by the hook
              },
            )
          }
        },
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
        // errors (incl. offline-queued saves) are reported by the hook itself
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
                <div className="mb-4 flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-4">
                  <Trophy className="h-6 w-6 shrink-0 text-success" />
                  <div className="text-sm font-medium text-success">
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
                        ? 'border-success/30 bg-success/10 text-success'
                        : projection.tone === 'warn'
                          ? 'border-warning/30 bg-warning/10 text-warning'
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
                          ? 'border-success/30 bg-success/10 text-success'
                          : skillMap.stats.pace === 'behind'
                            ? 'border-warning/30 bg-warning/10 text-warning'
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
              <div className="mb-1 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">
                  Your plan <span className="font-normal text-muted-foreground">({stats.stepsDone}/{stats.stepsTotal} done)</span>
                </h4>
                {doneStepCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={updateGoal.isPending}
                    className={cn(
                      'h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-xs',
                      goal.hideDoneSteps ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    title={
                      goal.hideDoneSteps
                        ? 'Completed steps are hidden from this list — click to show them again'
                        : 'Hide completed steps — keeps this list focused on what is left (saved per goal)'
                    }
                    onClick={() =>
                      updateGoal.mutate({ id: goal.id, patch: { hideDoneSteps: !goal.hideDoneSteps } })
                    }
                  >
                    {goal.hideDoneSteps ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {goal.hideDoneSteps ? 'Done hidden' : 'Hide done'}
                  </Button>
                )}
              </div>
              <p className="mb-2 text-xs text-muted-foreground">
                tap the circle to tick — ✏️ can automate it from routines or metrics
              </p>
              <div className="space-y-1.5">
                {shownSteps.map((step) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    goal={goal}
                    isNext={stats.nextStep?.id === step.id}
                    onCycle={() => cycleStepStatus(step)}
                    onMove={(dir) => updateStep.mutate({ stepId: step.id, patch: { move: dir } })}
                    onEdit={(patch) =>
                      updateStep.mutate({ stepId: step.id, patch }, {
                        onSuccess: () => toast.success('Step updated'),
                      })
                    }
                    onDelete={() =>
                      deleteStep.mutate(step.id, {
                        onSuccess: () => toast.success('Step removed'),
                      })
                    }
                  />
                ))}
                {goal.hideDoneSteps && doneStepCount > 0 && (
                  <button
                    type="button"
                    className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setRevealDone((v) => !v)}
                  >
                    {revealDone ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {revealDone
                      ? `Hide the ${doneStepCount} completed step${doneStepCount === 1 ? '' : 's'} again`
                      : `${doneStepCount} completed step${doneStepCount === 1 ? '' : 's'} hidden — show`}
                  </button>
                )}
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
                      const title = newStep.trim()
                      setNewStep('') // the row appears optimistically — don't wait for the server
                      addStep.mutate(
                        { title },
                        {
                          onSuccess: () => toast.success('Step added'),
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
                  onClick={() => {
                    const title = newStep.trim()
                    setNewStep('') // the row appears optimistically — don't wait for the server
                    addStep.mutate(
                      { title },
                      {
                        onSuccess: () => toast.success('Step added'),
                      },
                    )
                  }}
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
                                    // the tick also created (or removed) an auto
                                    // log entry — say so, with a one-tap edit
                                    if (o.done) {
                                      const reOpened = res.stepsReverted ?? []
                                      if (res.removedLog || reOpened.length) {
                                        toast('Check-off undone', {
                                          description: [
                                            res.removedLog ? 'The auto log entry was removed too.' : null,
                                            reOpened.length ? `Step re-opened: “${reOpened[0].title}”.` : null,
                                          ]
                                            .filter(Boolean)
                                            .join(' ') || undefined,
                                        })
                                      }
                                      return
                                    }
                                    if (res.stepsAdvanced?.length) {
                                      toast.success(`Step complete — “${res.stepsAdvanced[0].title}”`, {
                                        icon: '⚡',
                                        description: 'It completed itself from your activity — the plan moved on.',
                                      })
                                    }
                                    const autoLog = res.autoLog
                                    if (!autoLog) return
                                    const unit = autoLog.unit ?? checkoffDisplayUnit(goal, o.routine)
                                    toast.success(`${o.routine.title} done`, {
                                      description: `Logged ${logAmountLabel(autoLog.amount, unit)} — not quite right?`,
                                      action: {
                                        label: 'Edit',
                                        onClick: () =>
                                          setEditLog({
                                            goalId: goal.id,
                                            logId: autoLog.id,
                                            amount: autoLog.amount,
                                            unit,
                                            title: o.routine.title,
                                            note: autoLog.note,
                                            day: toDayKey(o.date),
                                          }),
                                      },
                                    })
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
                            <div className="leading-snug">
                              <RoutineTitle
                                routine={o.routine}
                                done={o.done}
                                className={cn('text-xs font-semibold', o.done && 'line-through')}
                              />
                            </div>
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
                            <div className="leading-snug">
                              <RoutineTitle routine={r} className="truncate text-sm font-semibold" />
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
                                      rs.adherencePct >= 70 ? 'var(--success)' : rs.adherencePct >= 40 ? 'var(--warning)' : 'var(--muted-foreground)',
                                  }}
                                  title="Recent adherence (last 4 weeks) — forgiven sessions count too, so the number stays honest; they never pile up as catch-up work"
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
                {/* counts toward — credit a checkpoint instead of (well, on top
                    of) the goal's own ledger. Offered on every goal type:
                    matching units advance both, differing units keep the
                    goal's sums clean. */}
                {creditNodes.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Counts toward</Label>
                    <Select
                      value={creditTo}
                      onValueChange={(v) => {
                        setCreditTo(v)
                        // the checkpoint owns the entry's unit — drop any
                        // manual unit pick from the goal-ledger mode
                        setUnitTo(null)
                      }}
                    >
                      <SelectTrigger className="h-9 text-xs" aria-label="Counts toward">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="goal">Just this goal ({logUnit})</SelectItem>
                        {creditNodes.map((v) => (
                          <SelectItem key={v.node.id} value={v.node.id}>
                            {v.node.icon} {v.node.title}
                            {v.unit ? ` (${v.unit})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {/* unit — goal-ledger entries can speak one of the goal's other
                    units ("45 min" of reading on a pages goal); recorded as
                    history, never summed into the goal's own total */}
                {!creditTarget && unitChoices.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">In:</span>
                    <button
                      type="button"
                      aria-pressed={!unitTo}
                      onClick={() => setUnitTo(null)}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                        !unitTo
                          ? 'border-primary/60 bg-primary/15 text-primary'
                          : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                      )}
                    >
                      {logUnit} · the goal&rsquo;s own
                    </button>
                    {unitChoices.map((u) => (
                      <button
                        key={u}
                        type="button"
                        aria-pressed={unitTo === u}
                        title={`Recorded as history — time entries still feed “time invested”`}
                        onClick={() => setUnitTo(unitTo === u ? null : u)}
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                          unitTo === u
                            ? 'border-primary/60 bg-primary/15 text-primary'
                            : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                        )}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                  <div className="space-y-1.5">
                    <Label htmlFor="log-amount">
                      Amount{' '}
                      {entryUnit
                        ? `(${entryUnit})`
                        : goal.type === 'plan'
                          ? '(e.g. 1 session)'
                          : '(amount)'}
                    </Label>
                    <Input
                      id="log-amount"
                      type="number"
                      min={0}
                      step="any"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLog()}
                      placeholder={creditTarget ? 'e.g. 25' : goal.type === 'plan' ? '1' : 'e.g. 25'}
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
                  {quickAmounts(creditTarget?.unit ?? unitTo ?? goal.unit).map((q) => (
                    <Button key={q} type="button" variant="secondary" size="sm" onClick={() => setAmount(String(q))}>
                      +{formatNumber(q)} {creditTarget?.unit ?? unitTo ?? unit}
                    </Button>
                  ))}
                  <div className="w-[150px]">
                    <Input type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} aria-label="Date of this entry" />
                  </div>
                  <Button className="ml-auto" onClick={handleLog} disabled={addLog.isPending}>
                    <Check className="h-4 w-4" /> Log it
                  </Button>
                </div>
                {creditTarget && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-primary/8 px-2 py-1.5 text-[11px] font-medium text-primary">
                    <Target className="mt-px h-3 w-3 shrink-0" />
                    <span>
                      {isSessionCountingGoal(goal)
                        ? `Advances ${creditTarget.node.icon} ${creditTarget.node.title} (and anything derived from it) and counts as one session — retroactive? Just pick the right day above.`
                        : entryOnGoalLedger
                          ? `Advances ${creditTarget.node.icon} ${creditTarget.node.title} and this goal’s own ${logUnit} total — they speak the same unit.`
                          : `Advances ${creditTarget.node.icon} ${creditTarget.node.title}. Recorded in ${creditTarget.unit || 'its own unit'}, so the goal’s ${logUnit || 'own'} total stays untouched — history for the goal, progress for the tree.`}
                    </span>
                  </p>
                )}
                {!creditTarget && unitTo && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-muted/60 px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
                    <Clock className="mt-px h-3 w-3 shrink-0" />
                    <span>
                      Recorded in {unitTo} — real, editable history that doesn&rsquo;t add to the goal&rsquo;s{' '}
                      {logUnit || 'own'} total
                      {isTimeUnitString(unitTo) ? '; it still feeds the “time invested” chart.' : '.'}
                    </span>
                  </p>
                )}
                {attemptablePbs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Also record as an attempt:
                    </span>
                    {attemptablePbs.map((pb) => {
                      const on = attemptPbIds.includes(pb.id)
                      // if the metric feeds a checkpoint, say so — a recorded
                      // attempt advances it like any other attempt would
                      const fedNode = goal.skillPaths
                        .flatMap((p) => p.nodes)
                        .find((nd) => nd.id === pb.nodeId)
                      return (
                        <button
                          key={pb.id}
                          type="button"
                          aria-pressed={on}
                          title={
                            fedNode
                              ? `Every attempt on ${pb.name} also advances ${fedNode.icon} ${fedNode.title}`
                              : `Keep ${pb.name} history in step with this entry — fully optional`
                          }
                          onClick={() =>
                            setAttemptPick({
                              unit: entryUnit,
                              ids: attemptPbIds.includes(pb.id)
                                ? attemptPbIds.filter((x) => x !== pb.id)
                                : [...attemptPbIds, pb.id],
                            })
                          }
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                            on
                              ? 'border-primary/60 bg-primary/15 text-primary'
                              : 'border-border bg-muted/40 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                          )}
                        >
                          <Trophy className="h-3 w-3 shrink-0" />
                          {pb.name}
                          {on && <Check className="h-3 w-3 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {goal.logs.length > 0 && (
                <div className="mt-5">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <h4 className="text-sm font-semibold">History</h4>
                    <span className="text-[11px] text-muted-foreground">tap an entry to edit it</span>
                  </div>
                  <div className="max-h-72 space-y-1.5 overflow-y-auto nice-scroll pr-1">
                    {goal.logs.map((log) => {
                      // check-off entries speak the unit they were recorded in
                      // ("10 words" / "20 min"), everything else the goal's own
                      const rowUnit = logRowUnit(goal, log)
                      // the checkpoint this entry advanced, when it did
                      const creditNode = log.nodeId ? nodeById.get(log.nodeId) ?? null : null
                      // the metric this entry mirrors (a recorded attempt)
                      const creditPb = log.pbId ? pbById.get(log.pbId) ?? null : null
                      return (
                      <div
                        key={log.id}
                        className="group flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm transition-colors hover:border-primary/40"
                      >
                        {/* the row itself opens the full editor — amount, day, note */}
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                          aria-label={`Edit entry: ${logAmountLabel(log.amount, rowUnit)}`}
                          title="Edit amount, day or note"
                          onClick={() =>
                            setEditLog({
                              goalId: goal.id,
                              logId: log.id,
                              amount: log.amount,
                              unit: rowUnit,
                              title: goal.title,
                              note: log.note,
                              day: dayKeyOf(new Date(log.date)),
                              creditLabel: creditNode
                                ? `${creditNode.icon} ${creditNode.title}`
                                : creditPb
                                  ? creditPb.name
                                  : null,
                              creditKind: creditPb ? 'metric' : 'node',
                            })
                          }
                        >
                          <div className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground">
                            {formatDateShort(new Date(log.date))}
                          </div>
                          <div className="flex shrink-0 items-center gap-1 font-semibold tabular-nums" style={{ color: c.hex }}>
                            +{logAmountLabel(log.amount, rowUnit)}
                            <Pencil className="h-3 w-3 opacity-30 transition-opacity group-hover:opacity-70" />
                          </div>
                          {creditNode && (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                              title={`This entry advances ${creditNode.title}`}
                            >
                              <Target className="h-2.5 w-2.5" /> {creditNode.title}
                            </span>
                          )}
                          {creditPb && (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                              title={`${creditPb.name} attempt — edit it here or from the metric's attempt chips`}
                            >
                              <Trophy className="h-2.5 w-2.5" /> {creditPb.name}
                            </span>
                          )}
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
                            })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      )
                    })}
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
