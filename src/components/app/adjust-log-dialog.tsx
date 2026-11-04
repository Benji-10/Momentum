'use client'

import { useState } from 'react'
import { Check, Loader2, Minus, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { formatNumber } from '@/lib/goal-math'
import { useUpdateLog } from '@/hooks/use-goals'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export interface AdjustLogTarget {
  goalId: string
  logId: string
  amount: number
  /** display unit, e.g. "min", "hours", "session" */
  unit: string
  /** what the log entry was about (shown as context) */
  title: string
}

/** Nudge size for the ± buttons, in the goal's unit. */
function stepFor(unit: string): number {
  const u = unit.toLowerCase()
  if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(u)) return 0.5
  if (['m', 'min', 'mins', 'minute', 'minutes'].includes(u)) return 15
  return 1
}

/**
 * Quick "how long did it really take?" editor — opens straight from the
 * toast after a check-off (which logged the routine's default amount), so
 * adjusting "work 2 hours" down to "50 minutes" takes two taps.
 */
export function AdjustLogDialog({ target, onClose }: { target: AdjustLogTarget | null; onClose: () => void }) {
  // remounted (key=) for each new target, so plain state is enough here
  const [value, setValue] = useState(String(target?.amount ?? ''))
  const update = useUpdateLog(target?.goalId ?? null)

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
    update.mutate(
      { logId: target.logId, amount: n },
      {
        onSuccess: () => {
          const unitLabel = target.unit.replace(/s$/, '')
          toast.success(`Updated — logged ${formatNumber(n)} ${unitLabel}${n === 1 ? '' : 's'}`)
          onClose()
        },
        onError: (e) => toast.error('Could not update the entry', { description: e.message }),
      },
    )
  }

  const step = stepFor(target?.unit ?? '')

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Adjust the amount
          </DialogTitle>
          <DialogDescription className="truncate">
            {target ? (() => { const u = target.unit.replace(/s$/, ''); return `${target.title} — planned ${formatNumber(target.amount)} ${u}${target.amount === 1 ? '' : 's'}. How much did you actually do?` })() : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" aria-label={`Less ${target?.unit ?? ''}`} onClick={() => nudge(-step)}>
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
            className="text-center text-lg font-semibold tabular-nums"
            aria-label="Amount"
          />
          <Button type="button" variant="outline" size="icon" aria-label={`More ${target?.unit ?? ''}`} onClick={() => nudge(step)}>
            <Plus className="h-4 w-4" />
          </Button>
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
