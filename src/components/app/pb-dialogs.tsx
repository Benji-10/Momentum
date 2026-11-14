'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Loader2, Minus, Pencil, Plus, Target, Trash2, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData, PbNodeCreditData, PersonalBestData, PbRecordData } from '@/lib/types'
import { formatNumber } from '@/lib/goal-math'
import { beatsPb, currentPb, sortedRecords } from '@/lib/pb-math'
import { buildSkillMap } from '@/lib/skill-tree'
import { dayKeyAgo, dayKeyOf, getAppTimezone, isoForDayKey, todayDayKey } from '@/lib/app-time'
import { useAddPb, useAddPbRecord, useDeletePbRecord, useUpdatePb, useUpdatePbRecord } from '@/hooks/use-goals'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

/** Today in the app timezone. */
function todayStr(): string {
  return todayDayKey()
}

/** The skill checkpoint a PB feeds, if its link still resolves. */
export function pbFedNode(goal: GoalData, pb: PersonalBestData) {
  if (!pb.nodeId) return null
  for (const p of goal.skillPaths) {
    const node = p.nodes.find((n) => n.id === pb.nodeId)
    if (node) return { node, path: p }
  }
  return null
}

/** What a logged attempt did to the linked checkpoint — as toasts. */
export function toastNodeCredit(nc: PbNodeCreditData | null | undefined) {
  if (!nc) return
  if (nc.skipped === 'locked') {
    toast(`${nc.nodeTitle} is still locked`, {
      description: 'This metric feeds the checkpoint once it unlocks.',
    })
    return
  }
  if (nc.skipped === 'short-window') {
    toast(`${nc.nodeTitle} · avg ${formatNumber(nc.average ?? 0)}${nc.nodeUnit ? ` ${nc.nodeUnit}` : ''}`, {
      description: `The checkpoint starts tracking once the average has all ${nc.window} attempts — ${nc.attempts} so far.`,
    })
    return
  }
  if (nc.skipped) return // mastered or missing — nothing new to say
  if (nc.mode === 'sum' && nc.delta > 0) {
    toast.success(`${nc.nodeTitle} +${formatNumber(nc.delta)}${nc.nodeUnit ? ` ${nc.nodeUnit}` : ''}`, {
      description: 'The attempt fed your roadmap checkpoint.',
    })
  } else if (nc.mode === 'average' && nc.average != null) {
    toast.success(`${nc.nodeTitle} · avg ${formatNumber(nc.average)}${nc.nodeUnit ? ` ${nc.nodeUnit}` : ''}`, {
      description: `The checkpoint tracks your rolling average — ${formatNumber(nc.value)}/${formatNumber(nc.target)}.`,
    })
  }
  if (nc.mastered) {
    toast.success(`Checkpoint mastered — ${nc.nodeTitle} ⭐`, {
      description: 'The roadmap moves on. Time for the next one?',
    })
  }
}

/** The goal's checkpoints grouped by path, for the feed-a-checkpoint picker. */
function nodeGroupsOf(goal: GoalData) {
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
}

/**
 * The roadmap link editor shared by the add + edit metric dialogs: which
 * checkpoint the metric feeds, and how — every attempt adds its value, or
 * the checkpoint tracks the rolling average (higher-is-better metrics only,
 * since checkpoints master at >= target).
 */
function NodeLinkSection({
  goal,
  direction,
  nodeId,
  onNodeId,
  mode,
  onMode,
  win,
  onWin,
}: {
  goal: GoalData
  direction: 'up' | 'down'
  nodeId: string
  onNodeId: (v: string) => void
  mode: 'sum' | 'average'
  onMode: (m: 'sum' | 'average') => void
  win: string
  onWin: (w: string) => void
}) {
  const groups = useMemo(() => nodeGroupsOf(goal), [goal])
  const hasNodes = groups.some((g) => g.nodes.length > 0)
  if (!hasNodes) return null
  const picked = nodeId !== 'none'
  const winNum = Math.min(50, Math.max(1, Math.round(Number(win) || 3)))
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-2.5">
      <Label className="flex items-center gap-1.5 text-xs font-medium">
        <Target className="h-3.5 w-3.5 text-primary" /> Feed a roadmap checkpoint{' '}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Select value={nodeId} onValueChange={onNodeId}>
        <SelectTrigger className="h-9 w-full text-xs" aria-label="Feed a roadmap checkpoint">
          <SelectValue placeholder="Pick a checkpoint…" />
        </SelectTrigger>
        <SelectContent className="max-h-56">
          <SelectItem value="none">Don&apos;t feed the roadmap</SelectItem>
          {groups.map((g) => (
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
      {picked && (
        <>
          <div role="radiogroup" aria-label="How attempts feed the checkpoint" className="grid grid-cols-2 gap-2">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'sum'}
              onClick={() => onMode('sum')}
              className={cn(
                'rounded-lg border-2 p-2 text-left transition-colors',
                mode === 'sum' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40',
              )}
            >
              <span className="block text-xs font-semibold leading-tight">Every attempt adds</span>
              <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
                words · pages · algs — the value counts toward the target
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'average'}
              disabled={direction === 'down'}
              onClick={() => onMode('average')}
              className={cn(
                'rounded-lg border-2 p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                mode === 'average' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40',
              )}
            >
              <span className="block text-xs font-semibold leading-tight">Tracks the average</span>
              <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
                speed · score — the checkpoint shows your rolling average
                {direction === 'down' ? ' (higher-is-better only)' : ''}
              </span>
            </button>
          </div>
          {mode === 'average' && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Average of the last</span>
              <Input
                type="number"
                min={1}
                max={50}
                value={win}
                onChange={(e) => onWin(e.target.value)}
                inputMode="numeric"
                className="h-8 w-16 px-2"
                aria-label="Rolling-average window"
              />
              <span className="text-[11px] text-muted-foreground">attempt{winNum === 1 ? '' : 's'}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
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
  // roadmap link: which checkpoint this metric feeds (if any)
  const [nodeId, setNodeId] = useState('none')
  const [nodeMode, setNodeMode] = useState<'sum' | 'average'>('sum')
  const [nodeWindow, setNodeWindow] = useState('3')
  const addPb = useAddPb(goal.id)

  function save() {
    const n = name.trim()
    if (!n) {
      toast.error('Give the metric a name', { description: 'e.g. WPM, BLD, 5K time' })
      return
    }
    const v = parseFloat(firstValue)
    const winNum = Math.min(50, Math.max(1, Math.round(Number(nodeWindow) || 3)))
    addPb.mutate(
      {
        name: n,
        unit: unit.trim() || null,
        direction,
        firstValue: !isNaN(v) && v > 0 ? v : null,
        nodeId: nodeId !== 'none' ? nodeId : null,
        nodeMode: nodeId !== 'none' ? nodeMode : null,
        nodeWindow: nodeId !== 'none' && nodeMode === 'average' ? winNum : null,
      },
      {
        onSuccess: (res) => {
          toast.success(`Tracking ${n} 🏆`, {
            description:
              direction === 'up'
                ? 'Higher is better — every attempt shows on the summary.'
                : 'Lower is better — every attempt shows on the summary.',
          })
          toastNodeCredit(res.nodeCredit)
          setName('')
          setUnit('')
          setFirstValue('')
          setDirection('up')
          setNodeId('none')
          setNodeMode('sum')
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
          {/* no `truncate` here — nowrap text in a max-w-sm dialog blows out
              the grid track and every field overflows the dialog edge */}
          <DialogDescription className="line-clamp-2">
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
                onClick={() => {
                  setDirection(opt.key)
                  // the average mirror needs a "up" metric — flip back to sum
                  if (opt.key === 'down') setNodeMode('sum')
                }}
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

          {/* roadmap link — feed a checkpoint from every logged attempt */}
          <NodeLinkSection
            goal={goal}
            direction={direction}
            nodeId={nodeId}
            onNodeId={setNodeId}
            mode={nodeMode}
            onMode={setNodeMode}
            win={nodeWindow}
            onWin={setNodeWindow}
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

/** Edit an existing PB metric — rename it, change the unit, flip which
 *  direction is better, or change which roadmap checkpoint it feeds. The
 *  logged history is untouched. */
export function EditPbDialog({
  goal,
  pb,
  open,
  onOpenChange,
}: {
  goal: GoalData
  pb: PersonalBestData | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState(pb?.name ?? '')
  const [unit, setUnit] = useState(pb?.unit ?? '')
  const [direction, setDirection] = useState<'up' | 'down'>(pb?.direction ?? 'up')
  // roadmap link — seeded from the metric, saved with the patch
  const [nodeId, setNodeId] = useState<string>(pb?.nodeId ?? 'none')
  const [nodeMode, setNodeMode] = useState<'sum' | 'average'>((pb?.nodeMode as 'sum' | 'average') ?? 'sum')
  const [nodeWindow, setNodeWindow] = useState(String(pb?.nodeWindow ?? 3))
  const updatePb = useUpdatePb(goal.id)

  if (!pb) return null

  function save() {
    if (!pb) return
    const n = name.trim()
    if (!n) {
      toast.error('Give the metric a name')
      return
    }
    const winNum = Math.min(50, Math.max(1, Math.round(Number(nodeWindow) || 3)))
    updatePb.mutate(
      {
        pbId: pb.id,
        patch: {
          name: n,
          unit: unit.trim() || null,
          direction,
          nodeId: nodeId !== 'none' ? nodeId : null,
          nodeMode: nodeId !== 'none' ? nodeMode : null,
          nodeWindow: nodeId !== 'none' && nodeMode === 'average' ? winNum : null,
        },
      },
      {
        onSuccess: (res) => {
          toast.success('Metric updated')
          toastNodeCredit(res.nodeCredit)
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
                onClick={() => {
                  setDirection(opt.key)
                  // the average mirror needs a "up" metric — flip back to sum
                  if (opt.key === 'down') setNodeMode('sum')
                }}
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

          {/* roadmap link — feed a checkpoint from every logged attempt */}
          <NodeLinkSection
            goal={goal}
            direction={direction}
            nodeId={nodeId}
            onNodeId={setNodeId}
            mode={nodeMode}
            onMode={setNodeMode}
            win={nodeWindow}
            onWin={setNodeWindow}
          />
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

/** Log an attempt at a PB metric — tells you straight away if it's a new
 *  PB, and feeds the linked roadmap checkpoint when one is configured. */
export function RecordPbDialog({
  goalId,
  goal,
  pb,
  open,
  onOpenChange,
}: {
  goalId: string
  /** the owning goal, when the caller has it — used to name the checkpoint
   *  this metric feeds (the line is skipped without it) */
  goal?: GoalData
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
  const fed = goal ? pbFedNode(goal, pb) : null

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
        onSuccess: (res) => {
          const unit = pb.unit ? ` ${pb.unit}` : ''
          if (isRecord) {
            toast.success(`New PB — ${formatNumber(n)}${unit} 🎉`)
          } else {
            const cur = currentPb(pb)
            toast.success(`Recorded ${formatNumber(n)}${unit}`, {
              description: cur ? `PB stays ${formatNumber(cur.value)}${unit}` : undefined,
            })
          }
          // a metric-triggered step may have just cleared its bar
          if (res.stepsAdvanced?.length) {
            toast.success(`Step complete — “${res.stepsAdvanced[0].title}”`, {
              icon: '⚡',
              description: 'It completed itself from your activity — the plan moved on.',
            })
          }
          // the linked checkpoint got its share of the attempt
          toastNodeCredit(res.nodeCredit)
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

        {fed && (
          <p className="flex items-start gap-1.5 rounded-lg bg-primary/8 px-2 py-1.5 text-[11px] font-medium text-primary">
            <Target className="mt-px h-3 w-3 shrink-0" />
            <span>
              Feeds {fed.node.icon} {fed.node.title} —{' '}
              {pb.nodeMode === 'average'
                ? `the checkpoint tracks your average of the last ${pb.nodeWindow ?? 3} attempts`
                : 'every attempt adds its value to the checkpoint'}
            </span>
          </p>
        )}

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

/** Fix one logged attempt — wrong number, wrong day, missing note — or
 *  remove it entirely. Opened by tapping an attempt chip. */
export function EditPbRecordDialog({
  goalId,
  pb,
  record,
  open,
  onOpenChange,
}: {
  goalId: string
  pb: PersonalBestData | null
  record: PbRecordData | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // remounted (key=) per record, so plain state is enough here
  const [value, setValue] = useState(String(record?.value ?? ''))
  const [note, setNote] = useState(record?.note ?? '')
  const [day, setDay] = useState(record ? dayKeyOf(new Date(record.date), getAppTimezone()) : todayDayKey())
  const [confirmRemove, setConfirmRemove] = useState(false)
  const update = useUpdatePbRecord(goalId)
  const remove = useDeletePbRecord(goalId)

  if (!pb || !record) return null

  const today = todayDayKey()
  const isBest = currentPb(pb)?.id === record.id
  const n = parseFloat(value)
  const nowBeats = !isNaN(n) && n > 0 && beatsPb(pb, n)

  function nudge(delta: number) {
    const cur = parseFloat(value)
    const next = Math.max(0, Math.round(((isNaN(cur) ? 0 : cur) + delta) * 100) / 100)
    setValue(String(next))
  }

  function save() {
    if (!pb || !record) return
    if (isNaN(n) || n <= 0) {
      toast.error('Enter a result greater than 0')
      return
    }
    const patch: { pbId: string; recordId: string; value: number; note: string | null; date?: string } = {
      pbId: pb.id,
      recordId: record.id,
      value: n,
      note: note.trim() || null,
    }
    // only move the stored instant when the day actually changed
    if (day !== dayKeyOf(new Date(record.date), getAppTimezone())) patch.date = isoForDayKey(day, '12:00')
    update.mutate(patch, {
      onSuccess: () => {
        toast.success(`Attempt saved — ${formatNumber(n)}${pb.unit ? ` ${pb.unit}` : ''}`)
        onOpenChange(false)
      },
      onError: (e) => toast.error('Could not update the attempt', { description: e.message }),
    })
  }

  const dayChips = [
    { label: 'Today', value: today },
    { label: 'Yesterday', value: dayKeyAgo(1) },
    { label: dayKeyAgo(2).slice(5).replace('-', '/'), value: dayKeyAgo(2) },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> {isBest ? 'Current PB' : 'Attempt'} — {pb.name}
          </DialogTitle>
          <DialogDescription>
            Fix the number, the day or the note. {pb.direction === 'up' ? 'Higher is better' : 'Lower is better'}
            {pb.unit ? ` (${pb.unit})` : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* result — quick ± nudges or type it directly */}
          <div className="flex items-center justify-center gap-2">
            <Button type="button" variant="outline" size="icon" aria-label="Less" onClick={() => nudge(-1)}>
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
              aria-label="Result"
            />
            <Button type="button" variant="outline" size="icon" aria-label="More" onClick={() => nudge(1)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {nowBeats && !isBest && (
            <p className="text-center text-xs font-semibold text-emerald-500">
              That would be the new PB 🎉
            </p>
          )}

          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="Note (optional)"
            maxLength={200}
            aria-label="Note"
          />

          {/* day — move the attempt to another day */}
          <div>
            <Label className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Which day?
            </Label>
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
                aria-label="Date of this attempt"
                className="h-7 w-[135px] px-2 text-xs"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-destructive hover:text-destructive"
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={update.isPending}>
              {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
            </Button>
          </div>
        </DialogFooter>

        <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this attempt?</AlertDialogTitle>
              <AlertDialogDescription>
                The {formatNumber(record.value)}
                {pb.unit ? ` ${pb.unit}` : ''} attempt on{' '}
                {new Date(record.date).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  timeZone: getAppTimezone(),
                })}{' '}
                will be deleted. The other attempts stay.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() =>
                  remove.mutate(
                    { pbId: pb.id, recordId: record.id },
                    {
                      onSuccess: () => {
                        toast.success('Attempt removed')
                        onOpenChange(false)
                      },
                      onError: (e) => toast.error('Could not remove the attempt', { description: e.message }),
                    },
                  )
                }
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
