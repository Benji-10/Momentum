'use client'

import { useState } from 'react'
import { CalendarDays, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData } from '@/lib/types'
import { formatNumber } from '@/lib/goal-math'
import { useAddLog, useUpdateNode } from '@/hooks/use-goals'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

function todayStr(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function daysAgoStr(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Quick-add sizes appropriate for the goal's target/unit magnitude. */
function quickAmounts(goal: GoalData): number[] {
  if (goal.type === 'plan') return [1, 2, 3]
  const t = goal.targetValue ?? 10
  if (t >= 1000) return [25, 50, 100]
  if (t >= 300) return [10, 25, 50]
  if (t >= 60) return [5, 10, 25]
  if (t >= 12) return [1, 2, 5]
  return [1]
}

/**
 * Quick progress entry for a goal — amount, day (back-fill friendly) and an
 * optional note, without opening the full detail sheet.
 */
export function QuickLogPopover({
  goal,
  children,
  align = 'end',
}: {
  goal: GoalData
  children: React.ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayStr())
  const [note, setNote] = useState('')
  const addLog = useAddLog(goal.id)

  const unit = goal.unit ?? (goal.type === 'plan' ? 'session' : '')

  function submit(presetAmount?: number) {
    const n = presetAmount != null ? presetAmount : parseFloat(amount)
    if (isNaN(n) || n <= 0) {
      toast.error('Enter an amount greater than 0')
      return
    }
    const iso =
      date === todayStr() ? new Date().toISOString() : new Date(`${date}T12:00:00`).toISOString()
    addLog.mutate(
      { amount: n, note: note.trim() || null, date: iso },
      {
        onSuccess: () => {
          const when = date === todayStr() ? '' : ` for ${new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
          toast.success(`Logged ${formatNumber(n)} ${unit || 'progress'}${when}`)
          setAmount('')
          setNote('')
          setOpen(false)
        },
        onError: (e) => toast.error('Could not log progress', { description: e.message }),
      },
    )
  }

  const dayChips = [
    { label: 'Today', value: todayStr() },
    { label: 'Yesterday', value: daysAgoStr(1) },
    { label: daysAgoStr(2).slice(5).replace('-', '/'), value: daysAgoStr(2) },
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {children}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold">Log progress</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {goal.emoji} {goal.title}
        </div>

        <div className="mt-3 flex gap-2">
          <Input
            type="number"
            min={0}
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={goal.type === 'plan' ? 'e.g. 1 session' : 'e.g. 25'}
            aria-label="Amount"
            className="w-24"
            autoFocus
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Note (optional)"
            maxLength={500}
            className="min-w-0 flex-1"
          />
        </div>

        {/* quick amounts */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {quickAmounts(goal).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => submit(q)}
              disabled={addLog.isPending}
              className="rounded-lg border bg-muted/40 px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
            >
              +{formatNumber(q)} {unit}
            </button>
          ))}
        </div>

        {/* day — pick today or back-fill a missed day */}
        <div className="mt-3">
          <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <CalendarDays className="h-3 w-3" /> Which day?
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {dayChips.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDate(d.value)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                  date === d.value
                    ? 'bg-primary text-primary-foreground'
                    : 'border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                )}
              >
                {d.label}
              </button>
            ))}
            <Input
              type="date"
              value={date}
              max={todayStr()}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Date of this entry"
              className="h-7 w-[135px] px-2 text-xs"
            />
          </div>
          {date !== todayStr() && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Back-filling an earlier day — no judgement, progress is progress.
            </p>
          )}
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" onClick={() => submit()} disabled={addLog.isPending || !amount}>
            {addLog.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Log it
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Quick progress add for one skill-tree checkpoint — "today's focus" rows on
 * the dashboard use this, so ongoing targets are actionable right there
 * (they advance by logged progress, not by a checkbox).
 */
export function NodeQuickAddPopover({
  goalId,
  nodeId,
  nodeTitle,
  unit,
  children,
  align = 'end',
}: {
  goalId: string
  nodeId: string
  nodeTitle: string
  unit?: string | null
  children: React.ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const updateNode = useUpdateNode(goalId)

  function submit(preset?: number) {
    const n = preset != null ? preset : parseFloat(amount)
    if (isNaN(n) || n <= 0) {
      toast.error('Enter an amount greater than 0')
      return
    }
    updateNode.mutate(
      { nodeId, patch: { add: n } },
      {
        onSuccess: (_data, vars) => {
          const added = vars.patch.add ?? 0
          toast.success(`+${formatNumber(added)} ${unit || 'progress'}`, {
            description: `${nodeTitle} advanced — see the roadmap for the full tree.`,
          })
          setAmount('')
          setOpen(false)
        },
        onError: (e) => toast.error('Could not add progress', { description: e.message }),
      },
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {children}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-3" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-semibold">Add progress</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{nodeTitle}</div>
        <div className="mt-2.5 flex gap-2">
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={unit ? `e.g. 10 ${unit}` : 'e.g. 10'}
            autoFocus
            aria-label="Amount"
            className="w-28"
          />
          <Button size="sm" className="flex-1" onClick={() => submit()} disabled={updateNode.isPending || !amount}>
            {updateNode.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Add
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[5, 10, 25].map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => submit(q)}
              disabled={updateNode.isPending}
              className="rounded-lg border bg-muted/40 px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
            >
              +{q} {unit || ''}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
