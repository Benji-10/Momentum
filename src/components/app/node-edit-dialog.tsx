'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Lock, Plus, Trash2, Wand2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData } from '@/lib/types'
import type { SkillNodeView } from '@/lib/skill-tree'
import { formatNumber } from '@/lib/goal-math'
import { useDeleteNode, useUpdateNode } from '@/hooks/use-goals'
import { EmojiPicker } from '@/components/app/emoji-picker'
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

/** Is `target` reachable from `start` following requires edges? (client mirror
 *  of the server's cycle check, used to disable loop-forming choices) */
function reachable(requires: Map<string, string[]>, start: string, target: string): boolean {
  const queue = [...(requires.get(start) ?? [])]
  const visited = new Set<string>([start])
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === target) return true
    if (visited.has(cur)) continue
    visited.add(cur)
    queue.push(...(requires.get(cur) ?? []))
  }
  return false
}

interface MilestoneRow {
  value: string
  label: string
}

/**
 * Full checkpoint editor — every property a JSON import can set, editable
 * in the app: icon, title, unit, target, XP, description, sub-checkpoints
 * (milestones), unlock gating (requires) and auto-advance (derivation).
 * Opened from the node popover's "Edit" button; the node popover itself
 * stays focused on logging progress.
 */
export function NodeEditDialog({
  goal,
  view,
  open,
  onOpenChange,
}: {
  goal: GoalData
  view: SkillNodeView
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const updateNode = useUpdateNode(goal.id)
  const deleteNode = useDeleteNode(goal.id)
  const n = view.node

  // NOTE: remounted via `key` whenever it opens for a different node, so
  // initializing from props once here is safe.
  const [icon, setIcon] = useState(n.icon)
  const [title, setTitle] = useState(n.title)
  const [target, setTarget] = useState(String(n.targetValue))
  const [xp, setXp] = useState(String(n.xpValue))
  const [unit, setUnit] = useState(n.unit ?? '')
  const [desc, setDesc] = useState(n.description ?? '')
  // derivation: source id ('none' = off) + source units per 1 of ours
  const [source, setSource] = useState<string>(n.deriveFromId ?? 'none')
  const [factor, setFactor] = useState(n.deriveFactor != null ? String(n.deriveFactor) : '')
  // sub-checkpoints
  const [rows, setRows] = useState<MilestoneRow[]>(
    [...n.milestones].sort((a, b) => a.value - b.value).map((m) => ({ value: String(m.value), label: m.label ?? '' })),
  )
  // unlock gating: default in-path ladder, or an explicit set of checkpoints
  const [gateMode, setGateMode] = useState<'default' | 'custom'>(view.explicitDeps ? 'custom' : 'default')
  const [selected, setSelected] = useState<string[]>(() => (n.requiresIds.length ? n.requiresIds : []))

  const [confirmDelete, setConfirmDelete] = useState(false)

  const targetNum = parseFloat(target)
  const xpNum = parseInt(xp, 10)
  const factorNum = parseFloat(factor)
  const isMeter = source !== 'none'

  // the goal's requires graph (node -> ids it requires) for cycle preview
  const requiresGraph = useMemo(() => {
    const g = new Map<string, string[]>()
    for (const p of goal.skillPaths) for (const x of p.nodes) g.set(x.id, x.requiresIds ?? [])
    return g
  }, [goal])

  // derivation candidates: any checkpoint in this goal except itself and
  // other derived meters (a meter can't be a source — one level only)
  const sourceGroups = useMemo(
    () =>
      goal.skillPaths
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((p) => ({
          title: p.title,
          icon: p.icon,
          nodes: p.nodes
            .slice()
            .sort((a, b) => a.order - b.order)
            .filter((x) => x.id !== n.id && x.deriveFromId == null)
            .map((x) => ({ id: x.id, title: x.title, unit: x.unit ?? p.unit ?? null })),
        })),
    [goal, n.id],
  )

  // unlock candidates: any checkpoint except this one (and nodes that only
  // appear through a cycle — requiring them back would loop)
  const gateGroups = useMemo(
    () =>
      goal.skillPaths
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((p) => ({
          title: p.title,
          icon: p.icon,
          nodes: p.nodes
            .slice()
            .sort((a, b) => a.order - b.order)
            .filter((x) => x.id !== n.id)
            .map((x) => ({
              ...x,
              loops: reachable(requiresGraph, x.id, n.id),
              mastered: x.currentValue >= x.targetValue && x.targetValue > 0,
            })),
        })),
    [goal, n.id, requiresGraph],
  )

  const milestoneError = useMemo(() => {
    const target = targetNum
    for (const r of rows) {
      const v = parseFloat(r.value)
      if (isNaN(v) || v <= 0) return 'Sub-checkpoints need a value above 0'
      if (!isNaN(target) && v >= target) return 'Sub-checkpoints sit below the target'
    }
    return null
  }, [rows, targetNum])

  const valid =
    title.trim().length > 0 &&
    !isNaN(targetNum) &&
    targetNum > 0 &&
    !isNaN(xpNum) &&
    xpNum >= 1 &&
    !milestoneError &&
    (!isMeter || (!isNaN(factorNum) && factorNum > 0))

  function toggleSelected(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  function handleDelete() {
    deleteNode.mutate(
      { nodeId: n.id },
      {
        onSuccess: () => {
          toast.success('Checkpoint removed')
          onOpenChange(false)
        },
        onError: (e) => toast.error('Could not remove checkpoint', { description: e.message }),
      },
    )
  }

  function handleSave() {
    if (!valid) return
    const deriveChanged =
      (n.deriveFromId ?? null) !== (isMeter ? source : null) || (n.deriveFactor ?? null) !== (isMeter ? factorNum : null)
    updateNode.mutate(
      {
        nodeId: n.id,
        patch: {
          title: title.trim(),
          icon,
          description: desc.trim() || null,
          targetValue: targetNum,
          xpValue: xpNum,
          unit: unit.trim() || null,
          milestones: rows
            .map((r) => ({ value: parseFloat(r.value), label: r.label.trim() || null }))
            .filter((m) => !isNaN(m.value) && m.value > 0),
          // meters are never gated — only send gating for plain checkpoints
          ...(isMeter ? {} : { requiresIds: gateMode === 'custom' ? selected : null }),
          ...(deriveChanged ? { deriveFromId: isMeter ? source : null, deriveFactor: isMeter ? factorNum : null } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success('Checkpoint updated')
          onOpenChange(false)
        },
        onError: (e) => toast.error('Could not update checkpoint', { description: e.message }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setConfirmDelete(false); onOpenChange(o) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-lg leading-none">{icon}</span>
            Checkpoint settings
          </DialogTitle>
          <DialogDescription className="truncate">
            {view.path.icon} {view.path.title} · {formatNumber(n.currentValue)}/{formatNumber(n.targetValue)}
            {view.unit ? ` ${view.unit}` : ''} logged
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* basics */}
          <div className="space-y-2.5">
            <div className="flex gap-2">
              <EmojiPicker value={icon} onChange={setIcon} ariaLabel="Checkpoint icon" />
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Checkpoint title" maxLength={120} className="min-w-0 flex-1" aria-label="Checkpoint title" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="ne-target" className="text-xs">Target</Label>
                <Input id="ne-target" type="number" min={1} step="any" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ne-xp" className="text-xs">XP</Label>
                <Input id="ne-xp" type="number" min={1} max={500} value={xp} onChange={(e) => setXp(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ne-unit" className="text-xs">
                  Unit <span className="text-muted-foreground">(opt.)</span>
                </Label>
                <Input id="ne-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="words" maxLength={30} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-desc" className="text-xs">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea id="ne-desc" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} maxLength={1000} placeholder="What does finishing this look like?" />
            </div>
          </div>

          {/* auto-advance (derivation) */}
          <div className="space-y-2 rounded-lg border border-dashed p-2.5">
            <Label className="flex items-center gap-1.5 text-xs font-medium">
              <Wand2 className="h-3.5 w-3.5 text-violet-500" /> Auto-advance from another checkpoint
            </Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="h-9 w-full text-xs" aria-label="Derivation source">
                <SelectValue placeholder="Pick a source checkpoint…" />
              </SelectTrigger>
              <SelectContent className="max-h-56">
                <SelectItem value="none">Off — enter progress by hand</SelectItem>
                {sourceGroups.map((g) => (
                  <SelectGroup key={g.title}>
                    <SelectLabel>
                      {g.icon} {g.title}
                    </SelectLabel>
                    {g.nodes.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.title}
                        {x.unit ? ` (${x.unit})` : ''}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {isMeter && (
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[11px] leading-tight text-muted-foreground">Every</span>
                <Input
                  value={factor}
                  onChange={(e) => setFactor(e.target.value)}
                  type="number"
                  min={0.01}
                  step="any"
                  className="h-8 w-24"
                  aria-label="Source units per 1 of this checkpoint"
                  placeholder="e.g. 300"
                />
                <span className="min-w-0 text-[11px] leading-tight text-muted-foreground">
                  of the source = 1 {unit.trim() || 'unit'} here
                </span>
              </div>
            )}
          </div>

          {/* sub-checkpoints */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Sub-checkpoints</Label>
              <span className="text-[11px] text-muted-foreground">
                little stars on the bar — {formatNumber(targetNum || 0)} max
              </span>
            </div>
            {rows.length > 0 && (
              <div className="space-y-1.5">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      value={r.value}
                      onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))}
                      type="number"
                      min={1}
                      step="any"
                      inputMode="decimal"
                      className="h-8 w-20"
                      aria-label={`Sub-checkpoint ${i + 1} value`}
                    />
                    <Input
                      value={r.label}
                      onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
                      placeholder="Label (optional)"
                      maxLength={60}
                      className="h-8 min-w-0 flex-1"
                      aria-label={`Sub-checkpoint ${i + 1} label`}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove sub-checkpoint ${i + 1}`}
                      onClick={() => setRows(rows.filter((_, k) => k !== i))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {milestoneError && <p className="text-xs font-medium text-destructive">{milestoneError}</p>}
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-full gap-1 text-xs"
              disabled={rows.length >= 20}
              onClick={() => {
                const t = targetNum
                const suggested = !isNaN(t) && t > 0 ? Math.max(1, Math.round(t / (rows.length + 2))) : 50
                setRows([...rows, { value: String(suggested), label: '' }])
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Add sub-checkpoint
            </Button>
          </div>

          {/* unlock gating */}
          {isMeter ? (
            <div className="flex items-start gap-2 rounded-lg border border-violet-500/25 bg-violet-500/8 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
              Meters are never locked — they convert the source&apos;s progress automatically, so unlock gating doesn&apos;t apply.
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-xs font-medium">
                <Lock className="h-3.5 w-3.5 text-primary" /> Unlocks after
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={gateMode === 'default'}
                  onClick={() => setGateMode('default')}
                  className={cn(
                    'rounded-lg border-2 p-2 text-left text-xs transition-colors',
                    gateMode === 'default' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40',
                  )}
                >
                  <span className="block font-semibold">Previous tier</span>
                  <span className="block text-[11px] leading-tight text-muted-foreground">the natural ladder in this path</span>
                </button>
                <button
                  type="button"
                  aria-pressed={gateMode === 'custom'}
                  onClick={() => setGateMode('custom')}
                  className={cn(
                    'rounded-lg border-2 p-2 text-left text-xs transition-colors',
                    gateMode === 'custom' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40',
                  )}
                >
                  <span className="block font-semibold">Specific checkpoints</span>
                  <span className="block text-[11px] leading-tight text-muted-foreground">cross-path gates welcome</span>
                </button>
              </div>
              {gateMode === 'custom' && (
                <div className="nice-scroll max-h-44 space-y-2 overflow-y-auto rounded-lg border p-2">
                  {gateGroups.map((g) => (
                    <div key={g.title}>
                      <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {g.icon} {g.title}
                      </div>
                      {g.nodes.map((x) => {
                        const on = selected.includes(x.id)
                        return (
                          <label
                            key={x.id}
                            className={cn(
                              'flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors',
                              on ? 'bg-primary/10' : 'hover:bg-muted/60',
                              x.loops && 'cursor-not-allowed opacity-40',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={x.loops}
                              onChange={() => toggleSelected(x.id)}
                              className="h-3.5 w-3.5 accent-[var(--primary)]"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {x.icon} {x.title}
                            </span>
                            {x.mastered && <span className="shrink-0 text-[10px] text-emerald-500">✓</span>}
                            {x.loops && <span className="shrink-0 text-[10px] text-muted-foreground">loops</span>}
                          </label>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
              {gateMode === 'custom' && selected.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Nothing picked — this checkpoint unlocks straight away.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row flex-wrap items-center gap-2 sm:justify-between">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              aria-label="Move checkpoint up"
              title="Swap with the checkpoint above"
              disabled={updateNode.isPending}
              onClick={() => updateNode.mutate({ nodeId: n.id, patch: { move: 'up' } })}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              aria-label="Move checkpoint down"
              title="Swap with the checkpoint below"
              disabled={updateNode.isPending}
              onClick={() => updateNode.mutate({ nodeId: n.id, patch: { move: 'down' } })}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            {confirmDelete ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-8 gap-1 text-xs"
                disabled={deleteNode.isPending}
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5" /> Really delete?
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                aria-label="Delete checkpoint"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={!valid || updateNode.isPending}>
              {updateNode.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
