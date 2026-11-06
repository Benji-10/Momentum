'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, Loader2, Pencil, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData, PersonalBestData } from '@/lib/types'
import { formatNumber } from '@/lib/goal-math'
import { beatsPb, currentPb, sortedRecords } from '@/lib/pb-math'
import { isoForDayKey, todayDayKey, getAppTimezone } from '@/lib/app-time'
import { useAddPb, useAddPbRecord, useUpdatePb } from '@/hooks/use-goals'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** Today in the app timezone. */
function todayStr(): string {
  return todayDayKey()
}

/**
 * Start tracking a personal-best metric on a goal — "WPM" (higher is better)
 * or "BLD" (lower is better), with an optional current best.
 */
export function AddPbMetricDialog({
  goal,
  open,
  onOpenChange,
}: {
  goal: GoalData
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [direction, setDirection] = useState<'up' | 'down'>('up')
  const [firstValue, setFirstValue] = useState('')
  const addPb = useAddPb(goal.id)

  function save() {
    const n = name.trim()
    if (!n) {
      toast.error('Give the metric a name', { description: 'e.g. WPM, BLD, 5K time' })
      return
    }
    const v = parseFloat(firstValue)
    addPb.mutate(
      {
        name: n,
        unit: unit.trim() || null,
        direction,
        firstValue: !isNaN(v) && v > 0 ? v : null,
      },
      {
        onSuccess: () => {
          toast.success(`Tracking ${n} 🏆`, {
            description: direction === 'up' ? 'Higher is better — every attempt shows on the summary.' : 'Lower is better — every attempt shows on the summary.',
          })
          setName('')
          setUnit('')
          setFirstValue('')
          setDirection('up')
          onOpenChange(false)
        },
        onError: (e) => toast.error('Could not add the metric', { description: e.message }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" /> Track a personal best
          </DialogTitle>
          <DialogDescription className="truncate">
            {goal.emoji} {goal.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Metric, e.g. WPM"
              maxLength={60}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && save()}
              aria-label="Metric name"
            />
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="Unit, e.g. wpm"
              maxLength={30}
              className="w-32"
              aria-label="Unit (optional)"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { key: 'up', label: 'Higher is better', hint: 'e.g. WPM', icon: ArrowUp },
                { key: 'down', label: 'Lower is better', hint: 'e.g. BLD time', icon: ArrowDown },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setDirection(opt.key)}
                aria-pressed={direction === opt.key}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                  direction === opt.key
                    ? 'border-primary bg-primary/10'
                    : 'hover:border-primary/40 text-muted-foreground',
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <opt.icon className={cn('h-3.5 w-3.5', direction === opt.key && 'text-primary')} />
                  {opt.label}
                </span>
                <span className="text-xs text-muted-foreground">{opt.hint}</span>
              </button>
            ))}
          </div>

          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={firstValue}
            onChange={(e) => setFirstValue(e.target.value)}
            placeholder={`Current best (optional), e.g. ${direction === 'up' ? '92' : '58.5'}`}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            aria-label="Current best (optional)"
          />
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={addPb.isPending}>
            {addPb.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Track it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Edit an existing PB metric — rename it, change the unit, or flip which
 *  direction is better. The logged history is untouched. */
export function EditPbDialog({
  goalId,
  pb,
  open,
  onOpenChange,
}: {
  goalId: string
  pb: PersonalBestData | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState(pb?.name ?? '')
  const [unit, setUnit] = useState(pb?.unit ?? '')
  const [direction, setDirection] = useState<'up' | 'down'>(pb?.direction ?? 'up')
  const updatePb = useUpdatePb(goalId)

  if (!pb) return null

  function save() {
    if (!pb) return
    const n = name.trim()
    if (!n) {
      toast.error('Give the metric a name')
      return
    }
    updatePb.mutate(
      { pbId: pb.id, patch: { name: n, unit: unit.trim() || null, direction } },
      {
        onSuccess: () => {
          toast.success('Metric updated')
          onOpenChange(false)
        },
        onError: (e) => toast.error('Could not update the metric', { description: e.message }),
      },
    )
  }

  const attempts = sortedRecords(pb).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Edit {pb.name}
          </DialogTitle>
          <DialogDescription>
            Rename the metric, change its unit or which direction is better — the {attempts} logged{' '}
            {attempts === 1 ? 'attempt stays' : 'attempts stay'} exactly as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="pb-edit-name" className="text-xs">Name</Label>
              <Input
                id="pb-edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Metric, e.g. WPM"
                maxLength={60}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
            </div>
            <div className="w-32 space-y-1">
              <Label htmlFor="pb-edit-unit" className="text-xs">Unit</Label>
              <Input
                id="pb-edit-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="wpm"
                maxLength={30}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { key: 'up', label: 'Higher is better', hint: 'e.g. WPM', icon: ArrowUp },
                { key: 'down', label: 'Lower is better', hint: 'e.g. BLD time', icon: ArrowDown },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setDirection(opt.key)}
                aria-pressed={direction === opt.key}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                  direction === opt.key
                    ? 'border-primary bg-primary/10'
                    : 'hover:border-primary/40 text-muted-foreground',
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <opt.icon className={cn('h-3.5 w-3.5', direction === opt.key && 'text-primary')} />
                  {opt.label}
                </span>
                <span className="text-xs text-muted-foreground">{opt.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={updatePb.isPending}>
            {updatePb.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Log an attempt at a PB metric — tells you straight away if it's a new PB. */
export function RecordPbDialog({
  goalId,
  pb,
  open,
  onOpenChange,
}: {
  goalId: string
  pb: PersonalBestData | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [value, setValue] = useState('')
  const [date, setDate] = useState(todayStr())
  const [note, setNote] = useState('')
  const addRecord = useAddPbRecord(goalId)

  if (!pb) return null
  const best = currentPb(pb)
  const v = parseFloat(value)
  const isRecord = !isNaN(v) && v > 0 && beatsPb(pb, v)

  function save() {
    if (!pb) return
    const n = parseFloat(value)
    if (isNaN(n) || n <= 0) {
      toast.error('Enter the result')
      return
    }
    const iso = date === todayStr() ? new Date().toISOString() : isoForDayKey(date, '12:00')
    addRecord.mutate(
      { pbId: pb.id, value: n, date: iso, note: note.trim() || null },
      {
        onSuccess: () => {
          const unit = pb.unit ? ` ${pb.unit}` : ''
          if (isRecord) {
            toast.success(`New PB — ${formatNumber(n)}${unit} 🎉`)
          } else {
            const cur = currentPb(pb)
            toast.success(`Recorded ${formatNumber(n)}${unit}`, {
              description: cur ? `PB stays ${formatNumber(cur.value)}${unit}` : undefined,
            })
          }
          setValue('')
          setNote('')
          setDate(todayStr())
          onOpenChange(false)
        },
        onError: (e) => toast.error('Could not record the attempt', { description: e.message }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" /> {pb.name}
          </DialogTitle>
          <DialogDescription>
            {best
              ? `Current PB: ${formatNumber(best.value)}${pb.unit ? ` ${pb.unit}` : ''} — ${new Date(best.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: getAppTimezone() })}`
              : 'Log your first result to set the baseline.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder={pb.direction === 'up' ? 'e.g. 128' : 'e.g. 55.2'}
              autoFocus
              aria-label="Result"
              className="w-32"
            />
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder="Note (optional)"
              maxLength={200}
              className="min-w-0 flex-1"
              aria-label="Note (optional)"
            />
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              max={todayStr()}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Date of the attempt"
              className="h-9 w-[150px] px-2 text-xs"
            />
            {isRecord && (
              <span className="text-xs font-semibold text-emerald-500">
                That&apos;s a new PB 🎉
              </span>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={addRecord.isPending}>
            {addRecord.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Record it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
