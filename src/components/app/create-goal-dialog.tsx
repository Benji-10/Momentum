'use client'

import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Check,
  ListChecks,
  Plus,
  Sparkles,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { CreateGoalInput, GoalData, GoalType } from '@/lib/types'
import { TEMPLATES, type GoalTemplate } from '@/lib/templates'
import { EMOJI_CHOICES, GOAL_COLORS, GOAL_COLOR_KEYS, goalColor } from '@/lib/goal-colors'
import { useCreateGoal, useUpdateGoal } from '@/hooks/use-goals'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { WEEK_MS, formatNumber } from '@/lib/goal-math'
import { dayKeyOf, getAppTimezone, isoForDayKey, todayDayKey } from '@/lib/app-time'

const UNIT_OPTIONS = ['books', 'pages', 'chapters', 'hours', 'sessions', 'km', 'workouts', 'words', 'reps', 'recipes']

function defaultDeadlineISO(): string {
  // Dec 31 of the current app-tz year, end of that day in the app timezone
  return isoForDayKey(`${todayDayKey().slice(0, 4)}-12-31`, '23:59:59')
}

/** App-tz calendar day of a stored deadline instant, for the date input. */
function toDateString(iso: string | null | undefined): string {
  if (!iso) return ''
  return dayKeyOf(new Date(iso), getAppTimezone())
}

/** Store the picked day as end-of-day in the app timezone. */
function fromDateString(ds: string): string | null {
  if (!ds) return null
  const iso = isoForDayKey(ds, '23:59:59')
  return isNaN(Date.parse(iso)) ? null : iso
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  editGoal?: GoalData | null
  categories?: string[]
}

export function CreateGoalDialog({ open, onOpenChange, editGoal, categories = [] }: Props) {
  const isEdit = !!editGoal
  const createGoal = useCreateGoal()
  const updateGoal = useUpdateGoal()

  const [step, setStep] = useState(0) // 0 type, 1 details, 2 review
  const [type, setType] = useState<GoalType>('quantitative')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [emoji, setEmoji] = useState('🎯')
  const [color, setColor] = useState('emerald')
  const [targetValue, setTargetValue] = useState('')
  const [unit, setUnit] = useState('books')
  const [weeklyTarget, setWeeklyTarget] = useState('')
  const [deadline, setDeadline] = useState(toDateString(defaultDeadlineISO()))
  const [steps, setSteps] = useState<string[]>([])
  const [newStep, setNewStep] = useState('')

  // reset form when the dialog opens
  useMemo(() => {
    if (!open) return
    if (editGoal) {
      setType(editGoal.type)
      setTitle(editGoal.title)
      setDescription(editGoal.description ?? '')
      setCategory(editGoal.category ?? '')
      setEmoji(editGoal.emoji)
      setColor(editGoal.color)
      setTargetValue(editGoal.targetValue != null ? String(editGoal.targetValue) : '')
      setUnit(editGoal.unit ?? '')
      setWeeklyTarget(editGoal.weeklyTarget != null ? String(editGoal.weeklyTarget) : '')
      setDeadline(toDateString(editGoal.deadline))
      setSteps(editGoal.steps.map((s) => s.title))
      setStep(1)
    } else {
      setType('quantitative')
      setTitle('')
      setDescription('')
      setCategory('')
      setEmoji('🎯')
      setColor('emerald')
      setTargetValue('')
      setUnit('books')
      setWeeklyTarget('')
      setDeadline(toDateString(defaultDeadlineISO()))
      setSteps([])
      setStep(0)
    }
  }, [open, editGoal])

  const deadlineISO = fromDateString(deadline)
  const targetNum = parseFloat(targetValue)
  const weeklyNum = parseFloat(weeklyTarget)
  const weeksLeft = deadlineISO ? Math.max(0, (+new Date(deadlineISO) - Date.now()) / WEEK_MS) : null

  const previewRequiredPerWeek =
    type === 'quantitative' && !isNaN(targetNum) && targetNum > 0 && weeksLeft && weeksLeft > 0
      ? targetNum / weeksLeft
      : null

  function applyTemplate(t: GoalTemplate) {
    setType(t.type)
    setTitle(t.title)
    setDescription(t.description)
    setEmoji(t.emoji)
    setColor(t.color)
    if (t.targetValue) setTargetValue(String(t.targetValue))
    if (t.unit) setUnit(t.unit)
    setWeeklyTarget(t.weeklyTarget != null ? String(t.weeklyTarget) : '')
    setSteps(t.steps ? [...t.steps] : [])
  }

  function detailsValid(): boolean {
    if (!title.trim()) return false
    if (type === 'quantitative' && (isNaN(targetNum) || targetNum <= 0)) return false
    if (weeklyTarget && (isNaN(weeklyNum) || weeklyNum <= 0)) return false
    return true
  }

  function handleCreate() {
    if (!detailsValid()) return
    const input: CreateGoalInput = {
      title: title.trim(),
      description: description.trim() || null,
      emoji,
      color,
      category: category.trim() || null,
      type,
      targetValue: type === 'quantitative' ? targetNum : null,
      unit: unit.trim() || null,
      weeklyTarget: !isNaN(weeklyNum) && weeklyNum > 0 ? weeklyNum : null,
      deadline: deadlineISO,
      steps:
        type === 'plan'
          ? steps
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => ({ title: s }))
          : [],
    }
    createGoal.mutate(input, {
      onSuccess: () => {
        toast.success('Goal created', { description: `${emoji} ${title.trim()}` })
        onOpenChange(false)
      },
      onError: (e) => toast.error('Could not create goal', { description: e.message }),
    })
  }

  function handleSaveEdit() {
    if (!editGoal || !detailsValid()) return
    updateGoal.mutate(
      {
        id: editGoal.id,
        patch: {
          title: title.trim(),
          description: description.trim() || null,
          emoji,
          color,
          category: category.trim() || null,
          unit: unit.trim() || null,
          targetValue: type === 'quantitative' ? (isNaN(targetNum) ? null : targetNum) : null,
          weeklyTarget: !isNaN(weeklyNum) && weeklyNum > 0 ? weeklyNum : null,
          deadline: deadlineISO,
        },
      },
      {
        onSuccess: () => {
          toast.success('Goal updated')
          onOpenChange(false)
        },
        onError: (e) => toast.error('Could not update goal', { description: e.message }),
      },
    )
  }

  const c = goalColor(color)
  const stepTitles = isEdit ? ['Details'] : ['Type', 'Details', 'Review']

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto nice-scroll sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit goal' : 'New goal'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Adjust the details of your goal.'
              : 'Set a measurable target or build a step-by-step plan.'}
          </DialogDescription>
        </DialogHeader>

        {/* step indicator */}
        {!isEdit && (
          <div className="flex items-center gap-2">
            {stepTitles.map((t, i) => (
              <div key={t} className="flex flex-1 items-center gap-2">
                <div
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    i < step
                      ? 'bg-primary text-primary-foreground'
                      : i === step
                        ? 'bg-primary/15 text-primary ring-2 ring-primary'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span className={cn('text-xs', i === step ? 'font-medium' : 'text-muted-foreground')}>{t}</span>
                {i < stepTitles.length - 1 && <div className="h-px flex-1 bg-border" />}
              </div>
            ))}
          </div>
        )}

        {/* ---------- STEP 0: type ---------- */}
        {!isEdit && step === 0 && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setType('quantitative')}
                className={cn(
                  'rounded-xl border-2 p-4 text-left transition-colors',
                  type === 'quantitative' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40',
                )}
              >
                <Target className="mb-2 h-5 w-5 text-primary" />
                <div className="font-semibold">Target goal</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  A number with a deadline — e.g. &ldquo;read 12 books this year&rdquo;. The app works out the weekly pace you need.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setType('plan')}
                className={cn(
                  'rounded-xl border-2 p-4 text-left transition-colors',
                  type === 'plan' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40',
                )}
              >
                <ListChecks className="mb-2 h-5 w-5 text-primary" />
                <div className="font-semibold">Plan goal</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  A step-by-step plan for learning a skill — e.g. &ldquo;learn guitar&rdquo;. Track steps and practice sessions.
                </p>
              </button>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" /> Start from a template
              </div>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.filter((t) => t.type === type).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t)}
                    className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-primary/5"
                  >
                    <span>{t.emoji}</span> {t.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ---------- STEP 1: details ---------- */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <Label htmlFor="goal-title">Title</Label>
                <Input
                  id="goal-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={type === 'quantitative' ? 'Read 12 books' : 'Learn guitar'}
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label>Icon</Label>
                <div className="flex h-9 items-center gap-1 rounded-lg border bg-card px-2">
                  <span className="text-lg">{emoji}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {EMOJI_CHOICES.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors hover:bg-accent',
                    emoji === e ? 'border-primary bg-primary/10' : 'border-transparent',
                  )}
                >
                  {e}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {GOAL_COLOR_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-label={GOAL_COLORS[k].name}
                    onClick={() => setColor(k)}
                    className={cn(
                      'h-8 w-8 rounded-full transition-transform hover:scale-110',
                      color === k && 'ring-2 ring-offset-2 ring-offset-background',
                    )}
                    style={{ background: GOAL_COLORS[k].hex, ...(color === k ? { boxShadow: `0 0 0 2px ${GOAL_COLORS[k].hex}` } : {}) }}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="goal-desc">Why this matters <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea
                id="goal-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A short reminder of what you're aiming for…"
                rows={2}
                maxLength={2000}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="goal-category">
                Category <span className="text-muted-foreground">(optional — used for filtering)</span>
              </Label>
              <Input
                id="goal-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Music, Fitness, Language…"
                list="category-options"
                maxLength={40}
              />
              <datalist id="category-options">
                {categories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>

            {type === 'quantitative' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="goal-target">Target amount</Label>
                  <Input
                    id="goal-target"
                    type="number"
                    min={0.1}
                    step="any"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                    placeholder="12"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="goal-unit">Unit</Label>
                  <Input
                    id="goal-unit"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="books"
                    list="unit-options"
                    maxLength={30}
                  />
                  <datalist id="unit-options">
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </div>
              </div>
            )}

            {type === 'plan' && (
              <div className="space-y-2">
                <Label>Plan steps</Label>
                <div className="space-y-2">
                  {steps.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                        {i + 1}
                      </span>
                      <Input
                        value={s}
                        onChange={(e) => setSteps(steps.map((x, j) => (j === i ? e.target.value : x)))}
                        maxLength={200}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Move step up"
                        disabled={i === 0}
                        onClick={() => setSteps(steps.map((x, j) => (j === i - 1 ? steps[i] : j === i ? steps[i - 1] : x)))}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Move step down"
                        disabled={i === steps.length - 1}
                        onClick={() => setSteps(steps.map((x, j) => (j === i + 1 ? steps[i] : j === i ? steps[i + 1] : x)))}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove step"
                        onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newStep}
                    onChange={(e) => setNewStep(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newStep.trim()) {
                        e.preventDefault()
                        setSteps([...steps, newStep.trim()])
                        setNewStep('')
                      }
                    }}
                    placeholder="Add a step and press Enter…"
                    maxLength={200}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      if (newStep.trim()) {
                        setSteps([...steps, newStep.trim()])
                        setNewStep('')
                      }
                    }}
                  >
                    <Plus className="h-4 w-4" /> Add
                  </Button>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="goal-deadline">Deadline</Label>
                <Input id="goal-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-weekly">
                  {type === 'plan' ? 'Practice commitment' : 'Weekly commitment'}{' '}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="goal-weekly"
                  type="number"
                  min={0}
                  step="any"
                  value={weeklyTarget}
                  onChange={(e) => setWeeklyTarget(e.target.value)}
                  placeholder={type === 'plan' ? 'e.g. 4 sessions/week' : 'e.g. 1 book/week'}
                />
                <p className="text-xs text-muted-foreground">
                  {type === 'plan'
                    ? 'How many sessions/hours you commit to per week.'
                    : 'Overrides the computed pace for streaks and reminders.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ---------- STEP 2: review ---------- */}
        {!isEdit && step === 2 && (
          <div className="space-y-4">
            <div
              className="flex items-center gap-3 rounded-xl border p-4"
              style={{ background: c.soft, borderColor: `${c.hex}44` }}
            >
              <span className="text-3xl">{emoji}</span>
              <div>
                <div className="font-semibold">{title || 'Untitled goal'}</div>
                <div className="text-xs text-muted-foreground">
                  {type === 'quantitative' ? 'Target goal' : 'Plan goal'}
                  {deadlineISO ? ` · by ${new Date(deadlineISO).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: getAppTimezone() })}` : ''}
                </div>
              </div>
            </div>

            {type === 'quantitative' && (
              <div className="rounded-xl border bg-card p-4 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-muted-foreground">Target</span>
                  <span className="font-semibold">
                    {isNaN(targetNum) ? '—' : formatNumber(targetNum)} {unit}
                  </span>
                </div>
                {previewRequiredPerWeek != null && (
                  <>
                    <div className="mt-2 flex items-baseline justify-between">
                      <span className="text-muted-foreground">Time left</span>
                      <span className="font-semibold">
                        {weeksLeft ? `${Math.ceil(weeksLeft)} weeks` : '—'}
                      </span>
                    </div>
                    <div className="mt-3 rounded-lg bg-primary/10 p-3 text-center">
                      <div className="text-xs text-muted-foreground">You&apos;ll need roughly</div>
                      <div className="text-xl font-bold text-primary">
                        {formatNumber(Math.ceil(previewRequiredPerWeek * 10) / 10)} {unit}/week
                      </div>
                      <div className="text-xs text-muted-foreground">
                        ≈ {formatNumber(Math.ceil((previewRequiredPerWeek / 7) * 10) / 10)} {unit}/day
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {type === 'plan' && (
              <div className="rounded-xl border bg-card p-4 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-muted-foreground">Steps</span>
                  <span className="font-semibold">{steps.filter((s) => s.trim()).length} steps</span>
                </div>
                {weeklyTarget && !isNaN(weeklyNum) && weeklyNum > 0 && (
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="text-muted-foreground">Practice commitment</span>
                    <span className="font-semibold">
                      {formatNumber(weeklyNum)} {unit || 'sessions'}/week
                    </span>
                  </div>
                )}
                {weeksLeft && steps.length > 0 && (
                  <div className="mt-3 rounded-lg bg-primary/10 p-3 text-center">
                    <div className="text-xs text-muted-foreground">To finish by the deadline</div>
                    <div className="text-xl font-bold text-primary">
                      ~{Math.ceil(steps.filter((s) => s.trim()).length / Math.max(weeksLeft, 0.1))} steps/week
                    </div>
                  </div>
                )}
                <ol className="mt-3 list-decimal space-y-1 pl-5 text-muted-foreground">
                  {steps.filter((s) => s.trim()).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mt-2 gap-2 sm:gap-0">
          {!isEdit && step > 0 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          )}
          {!isEdit && step === 0 && (
            <Button onClick={() => setStep(1)}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          )}
          {!isEdit && step === 1 && (
            <Button disabled={!detailsValid()} onClick={() => setStep(2)}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          )}
          {!isEdit && step === 2 && (
            <Button onClick={handleCreate} disabled={createGoal.isPending}>
              {createGoal.isPending ? 'Creating…' : (
                <>
                  <Check className="h-4 w-4" /> Create goal
                </>
              )}
            </Button>
          )}
          {isEdit && (
            <div className="flex w-full justify-between">
              <p className="self-center text-xs text-muted-foreground">
                {type === 'quantitative' ? 'Targets & steps move to the goal page' : 'Steps are managed on the goal page'}
              </p>
              <Button onClick={handleSaveEdit} disabled={!detailsValid() || updateGoal.isPending}>
                {updateGoal.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
