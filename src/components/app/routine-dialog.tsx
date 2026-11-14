'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, Dumbbell, ListChecks, NotebookPen, Repeat, Sparkles, Target } from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData, RoutineData } from '@/lib/types'
import { buildSkillMap } from '@/lib/skill-tree'
import { WEEKDAY_LABELS, WEEKDAY_ORDER, describeCadence } from '@/lib/routine-math'
import { dayKeyOf, getAppTimezone, isoForDayKey } from '@/lib/app-time'
import {
  autoLogAmount,
  checkoffUnit,
  creditUnitLabel,
  logAmountLabel,
  routineNodeUnit,
} from '@/lib/recording'
import { useAddRoutine, useUpdateRoutine } from '@/hooks/use-goals'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/** App-tz calendar day of a stored instant, as "YYYY-MM-DD" for date inputs. */
function toDateString(iso: string | null | undefined): string {
  if (!iso) return ''
  return dayKeyOf(new Date(iso), getAppTimezone())
}

type Cadence = 'interval' | 'weekly' | 'flexible'

export function RoutineDialog({
  goal,
  routine,
  open,
  onOpenChange,
}: {
  goal: GoalData
  routine: RoutineData | null // null = create
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const addRoutine = useAddRoutine(goal.id)
  const updateRoutine = useUpdateRoutine(goal.id)
  const isEdit = !!routine

  // NOTE: this component is always remounted via `key` when it opens,
  // so initializing state from props here is safe (no effects needed).
  const [title, setTitle] = useState(routine?.title ?? '')
  const [notes, setNotes] = useState(routine?.notes ?? '')
  const [cadence, setCadence] = useState<Cadence>(routine?.cadence ?? 'interval')
  const [everyNDays, setEveryNDays] = useState(String(routine?.everyNDays ?? 2))
  const [weekdays, setWeekdays] = useState<number[]>(routine?.weekdays ?? [1, 3])
  const [timesPerWeek, setTimesPerWeek] = useState(String(routine?.timesPerWeek ?? 3))
  const [nodeId, setNodeId] = useState<string>(routine?.nodeId ?? 'none')
  const [credit, setCredit] = useState(routine?.credit != null ? String(routine.credit) : '')
  const [duration, setDuration] = useState(routine?.durationMin != null ? String(routine.durationMin) : '')
  const [extra, setExtra] = useState(routine?.optional ?? false)
  const [startDate, setStartDate] = useState(toDateString(routine?.startDate ?? new Date().toISOString()))

  const [endDate, setEndDate] = useState(toDateString(routine?.endDate))

  // ---- the plan step this routine works toward (routine side of the link;
  // the step editor offers the same choice from the other side) ----
  const orderedSteps = useMemo(() => [...goal.steps].sort((a, b) => a.order - b.order), [goal.steps])
  const linkedStep = useMemo(
    () => (routine ? orderedSteps.find((s) => s.trigger === 'routine' && s.routineId === routine.id) ?? null : null),
    [orderedSteps, routine],
  )
  const [stepId, setStepId] = useState<string>(linkedStep?.id ?? 'none')
  const [stepCount, setStepCount] = useState<string>(String(linkedStep?.triggerCount ?? 1))

  // the goal's checkpoints, grouped by path — what this session advances
  const nodeGroups = useMemo(() => {
    const map = buildSkillMap(goal)
    return map.paths.map((p) => ({
      title: p.path.title,
      icon: p.path.icon,
      nodes: p.nodes.map((v) => ({
        id: v.node.id,
        label: v.node.title,
        locked: v.locked && v.status !== 'mastered',
        mastered: v.status === 'mastered',
      })),
    }))
  }, [goal])

  const selectedNode = useMemo(
    () => nodeGroups.flatMap((g) => g.nodes).find((n) => n.id === nodeId),
    [nodeGroups, nodeId],
  )

  // ---- what one check-off records, live from the form ----
  // the same resolution the server applies on tick (recording.ts), so the
  // preview can never promise something different from what gets logged
  const linked = nodeId !== 'none'
  const routineDraft = useMemo(
    () => ({
      nodeId: linked ? nodeId : null,
      durationMin: duration ? parseInt(duration, 10) : null,
      credit: credit ? parseFloat(credit) : null,
    }),
    [linked, nodeId, duration, credit],
  )
  const draftNodeUnit = useMemo(
    () => (linked ? routineNodeUnit(goal, { nodeId }) : null),
    [goal, linked, nodeId],
  )
  const draftUnit = checkoffUnit(goal, routineDraft, draftNodeUnit)
  const draftAmount = autoLogAmount(goal, routineDraft, draftNodeUnit)
  const draftUnitLabel = creditUnitLabel(goal, routineDraft, draftNodeUnit)
  const logsSomething = draftAmount != null && draftAmount > 0

  const countNum = Math.min(999, Math.max(1, Math.round(Number(stepCount) || 1)))
  const pickedStep = stepId !== 'none' ? orderedSteps.find((s) => s.id === stepId) ?? null : null
  const isPickedCurrent =
    !!pickedStep && orderedSteps.find((s) => s.status !== 'done')?.id === pickedStep.id

  const valid =
    title.trim().length > 0 &&
    (cadence === 'interval'
      ? parseInt(everyNDays, 10) >= 1
      : cadence === 'flexible'
        ? parseInt(timesPerWeek, 10) >= 1
        : weekdays.length > 0) &&
    (!credit || parseFloat(credit) > 0)

  function handleSave() {
    if (!valid) return
    const payload = {
      title: title.trim(),
      notes: notes.trim() || null,
      cadence,
      everyNDays: cadence === 'interval' ? parseInt(everyNDays, 10) : null,
      weekdays: cadence === 'weekly' ? [...weekdays].sort() : null,
      timesPerWeek: cadence === 'flexible' ? parseInt(timesPerWeek, 10) : null,
      nodeId: nodeId === 'none' ? null : nodeId,
      // what one check-off logs — also without a linked checkpoint (then
      // it's the amount in the goal's own unit; see recording.ts)
      credit: credit ? parseFloat(credit) : null,
      durationMin: duration ? parseInt(duration, 10) : null,
      startDate: startDate ? isoForDayKey(startDate, '12:00') : null,
      endDate: endDate ? isoForDayKey(endDate, '23:59:59') : null,
      optional: extra,
      // the step link — null (not undefined) so saving deliberately unlinks
      stepId: stepId === 'none' ? null : stepId,
      stepCount: stepId === 'none' ? null : countNum,
    }
    if (isEdit && routine) {
      updateRoutine.mutate(
        { routineId: routine.id, patch: payload },
        {
          onSuccess: () => {
            toast.success('Routine updated')
            onOpenChange(false)
          },
          onError: (e) => toast.error('Could not update routine', { description: e.message }),
        },
      )
    } else {
      addRoutine.mutate(payload, {
        onSuccess: () => {
          toast.success('Routine scheduled', {
            description: selectedNode
              ? `${describeCadence(payload)} · advances ${selectedNode.label}`
              : pickedStep
                ? `${describeCadence(payload)} · works toward “${pickedStep.title}”`
                : describeCadence(payload),
          })
          onOpenChange(false)
        },
        onError: (e) => toast.error('Could not schedule routine', { description: e.message }),
      })
    }
  }

  const hasNodes = nodeGroups.some((g) => g.nodes.length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* p-4 on phones (p-6 is desktop), overflow-x-hidden as a last-resort
          clip: iOS date/number controls carry a wide intrinsic min-width and
          some iOS states (desktop-mode request, zoomed display) squeeze the
          viewport below what Chromium at 375px ever shows — nothing may
          push the dialog past the screen edge. */}
      {/* md:max-w-xl lg:max-w-2xl: the Minutes/Starts/Ends block is
          2-col at md (Starts/Ends share a row) and 3-col only at lg, where
          the widened dialog guarantees ~200px per track — always wider than
          the ~180px intrinsic min-width iOS Safari insists on for its native
          date controls. Below md everything stacks, so no phone viewport can
          push the dialog sideways. */}
      <DialogContent className="max-h-[90dvh] overflow-x-hidden overflow-y-auto p-4 sm:max-w-md sm:p-6 md:max-w-xl lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-4 w-4 shrink-0 text-primary" />
            {isEdit ? 'Edit routine' : 'New routine'}
          </DialogTitle>
          <DialogDescription className="break-words">
            A recurring practice slot for <span className="font-medium text-foreground">{goal.emoji} {goal.title}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="routine-title">What will you do?</Label>
            <Input
              id="routine-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Chord drills · Vocab review · Form shooting"
              maxLength={120}
            />
          </div>

          {/* cadence */}
          <div className="space-y-2">
            <Label>How often?</Label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setCadence('interval')}
                className={cn(
                  'min-w-0 rounded-xl border-2 p-2.5 text-left transition-colors',
                  cadence === 'interval' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40',
                )}
              >
                <CalendarDays className="mb-1 h-4 w-4 text-primary" />
                <div className="text-[13px] font-semibold leading-tight">Every N days</div>
                <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">drills every 2 days</div>
              </button>
              <button
                type="button"
                onClick={() => setCadence('weekly')}
                className={cn(
                  'min-w-0 rounded-xl border-2 p-2.5 text-left transition-colors',
                  cadence === 'weekly' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40',
                )}
              >
                <Repeat className="mb-1 h-4 w-4 text-primary" />
                <div className="text-[13px] font-semibold leading-tight">Fixed days</div>
                <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">every Tue &amp; Sun</div>
              </button>
              <button
                type="button"
                onClick={() => setCadence('flexible')}
                className={cn(
                  'min-w-0 rounded-xl border-2 p-2.5 text-left transition-colors',
                  cadence === 'flexible' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40',
                )}
              >
                <Dumbbell className="mb-1 h-4 w-4 text-primary" />
                <div className="text-[13px] font-semibold leading-tight">N× a week</div>
                <div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">any day — rest days built in</div>
              </button>
            </div>
          </div>

          {cadence === 'interval' ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Label htmlFor="every-n" className="shrink-0">
                Repeat every
              </Label>
              <Input
                id="every-n"
                type="number"
                min={1}
                max={365}
                value={everyNDays}
                onChange={(e) => setEveryNDays(e.target.value)}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          ) : cadence === 'flexible' ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Label htmlFor="times-week" className="shrink-0">
                Sessions per week
              </Label>
              <Input
                id="times-week"
                type="number"
                min={1}
                max={14}
                value={timesPerWeek}
                onChange={(e) => setTimesPerWeek(e.target.value)}
                className="w-24"
              />
              <span className="text-xs text-muted-foreground">pick any days</span>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>On days</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_ORDER.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={weekdays.includes(d)}
                    aria-label={WEEKDAY_LABELS[d]}
                    onClick={() => setWeekdays(weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d])}
                    className={cn(
                      'h-9 w-12 rounded-lg border text-xs font-medium transition-colors',
                      weekdays.includes(d)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card hover:border-muted-foreground/40',
                    )}
                  >
                    {WEEKDAY_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* extra credit — nice to do, never a penalty when skipped */}
          <button
            type="button"
            role="switch"
            aria-checked={extra}
            onClick={() => setExtra(!extra)}
            className={cn(
              'flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-colors',
              extra
                ? 'border-violet-500/50 bg-violet-500/8'
                : 'border-border hover:border-muted-foreground/40',
            )}
          >
            <Sparkles className={cn('h-4 w-4 shrink-0', extra ? 'text-violet-500' : 'text-muted-foreground')} />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-tight">Extra credit</span>
              <span className="block text-[11px] leading-tight text-muted-foreground">
                Nice to do — skipping it never counts against you
              </span>
            </span>
            {/* toggle track — the thumb keeps an even inset on all sides and
                slides between positions instead of snapping to the edge */}
            <span
              className={cn(
                'relative block h-6 w-11 shrink-0 rounded-full border-2 transition-colors duration-200',
                extra ? 'border-violet-500 bg-violet-500/20' : 'border-muted-foreground/30',
              )}
              aria-hidden
            >
              <span
                className={cn(
                  'absolute top-1/2 left-[3px] h-4 w-4 -translate-y-1/2 rounded-full transition-all duration-200',
                  extra ? 'translate-x-[18px] bg-violet-500' : 'bg-muted-foreground/40',
                )}
              />
            </span>
          </button>

          {/* what it advances in the skill tree */}
          {hasNodes && (
            <div className="space-y-2">
              <Label htmlFor="routine-node" className="flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-primary" />
                What does it advance? <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Select value={nodeId} onValueChange={setNodeId}>
                <SelectTrigger id="routine-node" className="w-full">
                  <SelectValue placeholder="Pick a checkpoint in your roadmap…" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="none">Nothing specific</SelectItem>
                  {nodeGroups.map((g) => (
                    <SelectGroup key={g.title}>
                      <SelectLabel>
                        {g.icon} {g.title}
                      </SelectLabel>
                      {g.nodes.map((n) => (
                        <SelectItem key={n.id} value={n.id} disabled={n.locked}>
                          {n.label}
                          {n.mastered ? ' ✓' : n.locked ? ' (locked)' : ''}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* what it works toward in the plan — the step side of the link */}
          {orderedSteps.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="routine-step" className="flex items-center gap-1.5">
                <ListChecks className="h-3.5 w-3.5 text-primary" />
                Which plan step does it work toward? <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Select value={stepId} onValueChange={setStepId}>
                <SelectTrigger id="routine-step" className="w-full" aria-label="Which plan step does it work toward">
                  <SelectValue placeholder="Pick a step…" />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  <SelectItem value="none">No step in particular</SelectItem>
                  {orderedSteps.map((s, i) => (
                    <SelectItem key={s.id} value={s.id} disabled={s.status === 'done' && s.id !== linkedStep?.id}>
                      Step {i + 1} · {s.title}
                      {s.status === 'done' ? ' ✓' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pickedStep && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-2">
                  <span className="text-[11px] leading-tight text-muted-foreground">Completes it after</span>
                  <Input
                    type="number"
                    min={1}
                    max={999}
                    value={stepCount}
                    onChange={(e) => setStepCount(e.target.value)}
                    inputMode="numeric"
                    aria-label="Check-offs needed to complete the step"
                    className="h-8 w-16 px-2"
                  />
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    check-off{countNum === 1 ? '' : 's'} of this routine
                  </span>
                  <p className="w-full text-[11px] leading-snug text-muted-foreground">
                    {isPickedCurrent ? (
                      <>Ticking this routine off ticks the step automatically — {countNum === 1 ? 'one check-off completes it.' : `${countNum} check-offs complete it.`}</>
                    ) : (
                      <>Check-offs count while “{pickedStep.title}” is the current step — it starts counting once the steps before it are done.</>
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* what one check-off logs — amount + unit, with a live preview of
              the exact entry a tick will create */}
          <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
            <Label htmlFor="routine-credit" className="flex items-center gap-1.5 text-xs">
              <NotebookPen className="h-3.5 w-3.5 text-primary" />
              One check-off logs
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="routine-credit"
                type="number"
                min={0}
                step="any"
                value={credit}
                onChange={(e) => setCredit(e.target.value)}
                placeholder="1"
                className="h-8 w-24"
                inputMode="decimal"
              />
              <span className="text-xs text-muted-foreground">{draftUnitLabel}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {logsSomething ? (
                <>
                  Each check-off adds{' '}
                  <span className="font-medium text-foreground">
                    {logAmountLabel(draftAmount!, draftUnit ?? draftUnitLabel)}
                  </span>{' '}
                  to this goal&rsquo;s history
                  {linked && selectedNode ? (
                    <> and advances <span className="font-medium text-foreground">{selectedNode.label}</span> by the same amount</>
                  ) : null}
                  {routineDraft.durationMin ? <> — you can edit the real amount right after ticking</> : null}
                  {!linked && hasNodes ? (
                    <> · link a checkpoint above to count it in the skill tree</>
                  ) : null}
                </>
              ) : (
                <>
                  Set minutes or an amount above so check-offs record something — until then a tick only marks the
                  calendar
                </>
              )}
            </p>
          </div>

          {/* minutes / start / end — stacked below md; at md Minutes spans
              the full row and Starts/Ends share the second row (two ~250px
              tracks); at lg+ all three sit in one row of ~200px tracks.
              Every track stays wider than iOS Safari's hard intrinsic
              min-width for native date inputs, so the fields can never
              poke past the dialog edge. */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <div className="min-w-0 space-y-2 md:col-span-2 lg:col-span-1">
              <Label htmlFor="routine-duration">Minutes</Label>
              <Input
                id="routine-duration"
                type="number"
                min={5}
                max={720}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="30"
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="routine-start">Starts</Label>
              {/* px-2.5: the native date control carries its own wide
                  intrinsic content; slimmer side padding buys the value
                  text room to breathe inside the narrowest phone dialog */}
              <Input
                id="routine-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="min-w-0 px-2.5"
              />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="routine-end">Ends</Label>
              <Input
                id="routine-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="min-w-0 px-2.5"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="routine-notes">
              How to do it well <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="routine-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Metronome at 60bpm, focus on clean transitions"
              rows={2}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!valid || addRoutine.isPending || updateRoutine.isPending}>
            {addRoutine.isPending || updateRoutine.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Schedule it'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
