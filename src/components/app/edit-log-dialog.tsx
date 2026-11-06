'use client'

import { useState } from 'react'
import { CalendarDays, Check, Loader2, Minus, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/goal-math'
import { dayKeyAgo, isoForDayKey, todayDayKey } from '@/lib/app-time'
import { useUpdateLog } from '@/hooks/use-goals'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface EditLogTarget {
  goalId: string
  logId: string
  amount: number
  /** display unit, e.g. "min", "hours", "sessions" */
  unit: string
  /** what the entry was about (shown as context) */
  title: string
  /** the entry's current note, if any */
  note?: string | null
  /** the calendar day this entry currently lands on, "YYYY-MM-DD" */
  day: string
}

/** Nudge size for the ± buttons, in the goal's unit. */
function stepFor(unit: string): number {
  const u = unit.toLowerCase()
  if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(u)) return 0.5
  if (['m', 'min', 'mins', 'minute', 'minutes'].includes(u)) return 15
  return 1
}

/** "hours" for 2, "hour" for 1 — display-only pluralisation. */
function plural(unit: string, n: number): string {
  const u = unit.replace(/s$/, '')
  return `${u}${n === 1 ? '' : 's'}`
}

/**
 * Full after-the-fact editor for one logged entry — amount, day and note.
 *
 * Opens from the toast right after a check-off (which logged the routine's
 * default amount — "Volleyball · 180m" → 180 min) and from any row in a
 * goal's log history, so "it was really 50 minutes" or "that was Tuesday's
 * session" is a two-tap fix instead of delete-and-relog.
 */
export function EditLogDialog({ target, onClose }: { target: EditLogTarget | null; onClose: () => void }) {
  // remounted (key=) for each new target, so plain state is enough here
  const [value, setValue] = useState(String(target?.amount ?? ''))
  const [note, setNote] = useState(target?.note ?? '')
  const [day, setDay] = useState(target?.day ?? todayDayKey())
  const update = useUpdateLog(target?.goalId ?? null)

  const today = todayDayKey()

  function nudge(delta: number) {
    const current = parseFloat(value)
    const next = Math.max(0, Math.round(((isNaN(current) ? 0 : current) + delta) * 100) / 100)
    setValue(String(next))
  }

  function save() {
    if (!target) return
    const n = parseFloat(value)
    if (isNaN(n) || n <= 0) {
      toast.error('Enter an amount greater than 0')
      return
    }
    // only move the stored instant when the day actually changed, so an
    // amount-only touch-up keeps the original check-off time
    const patch: { logId: string; amount: number; note: string | null; date?: string } = {
      logId: target.logId,
      amount: n,
      note: note.trim() || null,
    }
    if (day !== target.day) patch.date = isoForDayKey(day, '12:00')
    update.mutate(patch, {
      onSuccess: () => {
        const when =
          day !== target.day
            ? ` on ${new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                timeZone: 'UTC',
              })}`
            : ''
        toast.success(`Saved — ${formatNumber(n)} ${plural(target.unit, n)}${when}`)
        onClose()
      },
      onError: (e) => toast.error('Could not update the entry', { description: e.message }),
    })
  }

  const step = stepFor(target?.unit ?? '')

  const dayChips = [
    { label: 'Today', value: today },
    { label: 'Yesterday', value: dayKeyAgo(1) },
    { label: dayKeyAgo(2).slice(5).replace('-', '/'), value: dayKeyAgo(2) },
  ]

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Edit log entry
          </DialogTitle>
          <DialogDescription>
            {target
              ? `${target.title} — logged ${formatNumber(target.amount)} ${plural(target.unit, target.amount)}. Adjust the amount, day or note.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* amount — quick ± nudges or type it directly */}
          <div className="flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={`Less ${target?.unit ?? ''}`}
              onClick={() => nudge(-step)}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              autoFocus
              className="w-28 text-center text-lg font-semibold tabular-nums"
              aria-label="Amount"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={`More ${target?.unit ?? ''}`}
              onClick={() => nudge(step)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="Note — how did it go?"
            maxLength={500}
            aria-label="Note"
          />

          {/* day — move the entry to another day */}
          <div>
            <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <CalendarDays className="h-3 w-3" /> Which day?
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {dayChips.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDay(d.value)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                    day === d.value
                      ? 'bg-primary text-primary-foreground'
                      : 'border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                  )}
                >
                  {d.label}
                </button>
              ))}
              <Input
                type="date"
                value={day}
                max={today}
                onChange={(e) => setDay(e.target.value)}
                aria-label="Date of this entry"
                className="h-7 w-[135px] px-2 text-xs"
              />
            </div>
            {target && day !== target.day && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Moving this entry to {new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">in {target?.unit ?? ''}</span>
          <Button size="sm" onClick={save} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
