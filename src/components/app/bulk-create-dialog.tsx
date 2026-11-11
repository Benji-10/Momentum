'use client'

import { useRef, useState } from 'react'
import { Check, CopyPlus, Dices, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { TEMPLATES } from '@/lib/templates'
import { isoForDayKey, todayDayKey } from '@/lib/app-time'
import { useBulkCreateGoals, type BulkGoalInput } from '@/hooks/use-goals'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const EMOJI_POOL = ['🎯', '📚', '🏃', '🎸', '🀄', '💪', '🧘', '🍳', '💻', '✍️', '🎨', '🏀', '🌍', '💰', '🧠', '🌱']
const UNIT_POOL = ['books', 'pages', 'km', 'hours', 'sessions', 'words', 'min', 'reps', 'lessons', 'times']

interface Row {
  key: number
  emoji: string
  title: string
  category: string
  type: 'quantitative' | 'plan'
  target: string
  unit: string
  weekly: string
  deadline: string
}

let rowKeySeq = 1
function emptyRow(): Row {
  return {
    key: rowKeySeq++,
    emoji: '🎯',
    title: '',
    category: '',
    type: 'quantitative',
    target: '',
    unit: '',
    weekly: '',
    deadline: '',
  }
}

function rowFromTemplate(t: (typeof TEMPLATES)[number]): Row {
  const r = emptyRow()
  r.emoji = t.emoji
  r.title = t.title
  r.category = t.category ?? ''
  r.type = t.type
  r.unit = t.unit ?? ''
  r.target = t.type === 'quantitative' && t.targetValue ? String(t.targetValue) : ''
  r.weekly = t.weeklyTarget ? String(t.weeklyTarget) : ''
  return r
}

function nextEmoji(idx: number) {
  return EMOJI_POOL[(idx + 1 + Math.floor(Math.random() * 3)) % EMOJI_POOL.length]
}

export function BulkCreateDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  categories: string[]
}) {
  const [rows, setRows] = useState<Row[]>([emptyRow()])
  const bulkCreate = useBulkCreateGoals()
  const listRef = useRef<HTMLDivElement>(null)

  function handleOpenChange(o: boolean) {
    onOpenChange(o)
    if (!o) setRows([emptyRow()])
  }

  function patchRow(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function addRow(fill?: Row) {
    setRows((rs) => [...rs, fill ?? emptyRow()])
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    })
  }

  function removeRow(key: number) {
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.key !== key)))
  }

  function applyTemplate(t: (typeof TEMPLATES)[number]) {
    const empty = rows.find((r) => !r.title.trim())
    const filled = rowFromTemplate(t)
    if (empty) patchRow(empty.key, filled)
    else addRow(filled)
  }

  function cycleEmoji(key: number, current: string) {
    const idx = EMOJI_POOL.indexOf(current)
    patchRow(key, { emoji: nextEmoji(idx) })
  }

  function submit() {
    const inputs: BulkGoalInput[] = []
    for (const r of rows) {
      const title = r.title.trim()
      if (!title) continue
      const target = parseFloat(r.target)
      if (r.type === 'quantitative' && (isNaN(target) || target <= 0)) {
        toast.error(`"${title}" needs a target`, {
          description: 'Target goals aim for a number — fill the Target field or switch the row to Plan.',
        })
        return
      }
      inputs.push({
        title,
        emoji: r.emoji || '🎯',
        category: r.category.trim() || null,
        type: r.type,
        targetValue: r.type === 'quantitative' ? target : null,
        // only target goals carry a unit — a value left over from switching
        // the row's type would break what routine check-offs log
        unit: r.type === 'quantitative' ? r.unit.trim() || null : null,
        weeklyTarget: r.weekly ? parseFloat(r.weekly) || null : null,
        deadline: r.deadline ? isoForDayKey(r.deadline, '23:59:59') : null,
      })
    }
    if (inputs.length === 0) {
      toast.error('Add at least one tracker with a title')
      return
    }
    bulkCreate.mutate(inputs, {
      onSuccess: (res) => {
        toast.success(`Created ${res.created} tracker${res.created === 1 ? '' : 's'} 🎉`, {
          description: 'They are on your dashboard — add skill maps & routines inside each one.',
        })
        onOpenChange(false)
      },
      onError: (e) => toast.error('Could not create trackers', { description: e.message }),
    })
  }

  const validCount = rows.filter((r) => r.title.trim()).length

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2">
            <CopyPlus className="h-5 w-5 text-primary" /> Add trackers in bulk
          </DialogTitle>
          <DialogDescription>
            Set up a whole batch of trackers at once — mix target goals and plan goals. Fine-tune each one later.
          </DialogDescription>
        </DialogHeader>

        {/* presets */}
        <div className="border-b bg-muted/30 px-6 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Quick presets — tap to fill a row
          </div>
          <div className="nice-scroll flex gap-1.5 overflow-x-auto pb-1">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <span>{t.emoji}</span>
                <span className="max-w-36 truncate">{t.title}</span>
              </button>
            ))}
          </div>
        </div>

        {/* rows */}
        <div ref={listRef} className="nice-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto px-6 py-4">
          {rows.map((r, i) => (
            <div key={r.key} className="rounded-xl border bg-card p-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => cycleEmoji(r.key, r.emoji)}
                  title="Shuffle emoji"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-lg transition-transform hover:scale-105 active:scale-95"
                >
                  {r.emoji}
                </button>
                <Input
                  value={r.title}
                  onChange={(e) => patchRow(r.key, { title: e.target.value })}
                  placeholder={`Tracker ${i + 1} — e.g. Read 12 books`}
                  className="min-w-0 flex-1"
                  maxLength={120}
                  autoFocus={i === 0}
                />
                <div className="flex shrink-0 overflow-hidden rounded-lg border">
                  <button
                    type="button"
                    onClick={() => patchRow(r.key, { type: 'quantitative' })}
                    className={cn(
                      'px-2.5 py-1.5 text-xs font-medium transition-colors',
                      r.type === 'quantitative'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    Target
                  </button>
                  <button
                    type="button"
                    onClick={() => patchRow(r.key, { type: 'plan' })}
                    className={cn(
                      'px-2.5 py-1.5 text-xs font-medium transition-colors',
                      r.type === 'plan' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    Plan
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Remove row"
                  disabled={rows.length <= 1}
                  onClick={() => removeRow(r.key)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {r.type === 'quantitative' ? (
                  <>
                    <div>
                      <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Target</label>
                      <Input
                        type="number"
                        min={0}
                        value={r.target}
                        onChange={(e) => patchRow(r.key, { target: e.target.value })}
                        placeholder="12"
                        className="mt-0.5 h-8"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Unit</label>
                      <Input
                        list="bulk-units"
                        value={r.unit}
                        onChange={(e) => patchRow(r.key, { unit: e.target.value })}
                        placeholder="books"
                        className="mt-0.5 h-8"
                        maxLength={30}
                      />
                    </div>
                  </>
                ) : (
                  <div className="col-span-2">
                    <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Weekly target
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={r.weekly}
                      onChange={(e) => patchRow(r.key, { weekly: e.target.value })}
                      placeholder="e.g. 4 sessions / week"
                      className="mt-0.5 h-8"
                    />
                  </div>
                )}
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Category</label>
                  <Input
                    list="bulk-categories"
                    value={r.category}
                    onChange={(e) => patchRow(r.key, { category: e.target.value })}
                    placeholder="optional"
                    className="mt-0.5 h-8"
                    maxLength={40}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Deadline</label>
                  <Input
                    type="date"
                    value={r.deadline}
                    min={todayDayKey()}
                    onChange={(e) => patchRow(r.key, { deadline: e.target.value })}
                    className="mt-0.5 h-8"
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => addRow()}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed p-2.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <Plus className="h-4 w-4" /> Add another tracker
          </button>
        </div>

        <DialogFooter className="flex-wrap items-center justify-between gap-2 border-t px-6 py-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Dices className="h-3.5 w-3.5" />
            {validCount} tracker{validCount === 1 ? '' : 's'} ready
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={bulkCreate.isPending || validCount === 0}>
              {bulkCreate.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" /> Create {validCount || ''}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>

        <datalist id="bulk-units">
          {UNIT_POOL.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <datalist id="bulk-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </DialogContent>
    </Dialog>
  )
}
