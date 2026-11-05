'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, Dumbbell, Repeat, Target } from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData, RoutineData } from '@/lib/types'
import { buildSkillMap } from '@/lib/skill-tree'
import { WEEKDAY_LABELS, WEEKDAY_ORDER, describeCadence } from '@/lib/routine-math'
import { dayKeyOf, getAppTimezone, isoForDayKey } from '@/lib/app-time'
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
  const [startDate, setStartDate] = useState(toDateString(routine?.startDate ?? new Date().toISOString()))

  const [endDate, setEndDate] = useState(toDateString(routine?.endDate))

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
      credit: nodeId !== 'none' && credit ? parseFloat(credit) : null,
      durationMin: duration ? parseInt(duration, 10) : null,
      startDate: startDate ? isoForDayKey(startDate, '12:00') : null,
      endDate: endDate ? isoForDayKey(endDate, '23:59:59') : null,
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
            description: selectedNode ? `${describeCadence(payload)} · advances ${selectedNode.label}` : describeCadence(payload),
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-primary" />
            {isEdit ? 'Edit routine' : 'New routine'}
          </DialogTitle>
          <DialogDescription>
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
                  'rounded-xl border-2 p-2.5 text-left transition-colors',
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
                  'rounded-xl border-2 p-2.5 text-left transition-colors',
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
                  'rounded-xl border-2 p-2.5 text-left transition-colors',
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
            <div className="flex items-center gap-3">
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
            <div className="flex items-center gap-3">
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
              {nodeId !== 'none' && (
                <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/30 p-2.5">
                  <Label htmlFor="routine-credit" className="shrink-0 text-xs">
                    Add per session
                  </Label>
                  <Input
                    id="routine-credit"
                    type="number"
                    min={0}
                    step="any"
                    value={credit}
                    onChange={(e) => setCredit(e.target.value)}
                    placeholder="e.g. 10"
                    className="h-8 w-24 text-xs"
                    inputMode="decimal"
                  />
                  <span className="text-[11px] leading-tight text-muted-foreground">
                    progress added to {selectedNode?.label ?? 'the checkpoint'} each time you check it off
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
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
            <div className="space-y-2">
              <Label htmlFor="routine-start">Starts</Label>
              <Input id="routine-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="routine-end">Ends</Label>
              <Input id="routine-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
