'use client'

import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Crown, Lock, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData, SkillPathData } from '@/lib/types'
import { buildSkillMap, type SkillNodeView, type SkillPathView } from '@/lib/skill-tree'
import { goalColor } from '@/lib/goal-colors'
import { formatNumber } from '@/lib/goal-math'
import {
  useAddNode,
  useAddPath,
  useDeleteNode,
  useDeletePath,
  useUpdateNode,
  useUpdatePath,
} from '@/hooks/use-goals'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/** Quick-add step sizes appropriate for the node's target magnitude. */
function quickAddSteps(target: number): number[] {
  if (target >= 1000) return [25, 50, 100]
  if (target >= 300) return [10, 25, 50]
  if (target >= 60) return [5, 10, 25]
  if (target >= 10) return [1, 2, 5]
  return [1]
}

function statusStyles(status: SkillNodeView['status'], accent: string) {
  switch (status) {
    case 'mastered':
      return {
        ring: 'border-transparent text-white shadow-sm',
        bg: accent,
        bar: 'rgba(255,255,255,0.9)',
        track: 'rgba(255,255,255,0.28)',
        sub: 'rgba(255,255,255,0.8)',
      }
    case 'in_progress':
      return {
        ring: 'border-primary/40 bg-card hover:border-primary/70',
        bg: undefined as string | undefined,
        bar: accent,
        track: 'var(--muted)',
        sub: 'var(--muted-foreground)',
      }
    default:
      return {
        ring: 'border-border/70 bg-muted/30 hover:border-muted-foreground/30',
        bg: undefined as string | undefined,
        bar: 'var(--muted-foreground)',
        track: 'var(--muted)',
        sub: 'var(--muted-foreground)',
      }
  }
}

// ---------------------------------------------------------------------------
// Node popover (progress + edit)
// ---------------------------------------------------------------------------

function NodePopover({
  goal,
  view,
  open,
  onOpenChange,
  children,
}: {
  goal: GoalData
  view: SkillNodeView
  open: boolean
  onOpenChange: (o: boolean) => void
  children: React.ReactNode
}) {
  const updateNode = useUpdateNode(goal.id)
  const deleteNode = useDeleteNode(goal.id)
  const accent = goalColor(goal.color).hex
  const n = view.node
  const [exact, setExact] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editTitle, setEditTitle] = useState(n.title)
  const [editTarget, setEditTarget] = useState(String(n.targetValue))
  const [editXp, setEditXp] = useState(String(n.xpValue))

  const remaining = Math.max(0, n.targetValue - n.currentValue)

  function handleAdd(delta: number) {
    updateNode.mutate(
      { nodeId: n.id, patch: { add: delta } },
      {
        onSuccess: (res) => {
          const node = res.goal?.skillPaths.flatMap((p) => p.nodes).find((x) => x.id === n.id)
          if (node && node.currentValue >= node.targetValue && n.currentValue < n.targetValue) {
            toast.success(`Mastered: ${n.title}`, { description: `+${n.xpValue} XP 🏆` })
          }
        },
        onError: (e) => toast.error('Could not update', { description: e.message }),
      },
    )
  }

  function handleExact() {
    const v = parseFloat(exact)
    if (isNaN(v) || v < 0) return
    updateNode.mutate({ nodeId: n.id, patch: { currentValue: v } })
    setExact('')
  }

  function handleDelete() {
    deleteNode.mutate(
      { nodeId: n.id },
      {
        onSuccess: () => toast.success('Node removed'),
        onError: (e) => toast.error('Could not remove node', { description: e.message }),
      },
    )
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="center"
        collisionPadding={12}
        className="w-72 p-4"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => {
          // focus the input first — typing a number and hitting Enter just works
          if (view.status !== 'mastered') return
          e.preventDefault()
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-lg leading-none">{n.icon}</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{n.title}</div>
              <div className="text-xs text-muted-foreground">
                {formatNumber(n.currentValue)} / {formatNumber(n.targetValue)}
                {view.unit ? ` ${view.unit}` : ''} · {n.xpValue} XP
              </div>
            </div>
          </div>
          {view.status === 'mastered' && <Crown className="h-4 w-4 shrink-0" style={{ color: accent }} />}
        </div>

        {n.description && (
          <p className="mt-2 rounded-md bg-muted/60 p-2 text-xs leading-relaxed text-muted-foreground">
            {n.description}
          </p>
        )}

        {/* progress bar */}
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--muted)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${view.progressPct}%`, background: accent }}
            />
          </div>
        </div>

        {/* quick add — or the lock notice when gated */}
        {view.locked && view.status !== 'mastered' ? (
          <div className="mt-3 space-y-1.5 rounded-lg bg-muted/60 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" /> Unlocks after
            </div>
            <div className="flex flex-wrap gap-1">
              {view.deps.map((d) => (
                <span
                  key={d.id}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    d.mastered
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  {d.mastered ? '✓' : <Lock className="h-2.5 w-2.5" />}
                  {d.pathTitle && d.pathTitle !== view.path.title ? `${d.pathIcon} ` : ''}
                  {d.title}
                </span>
              ))}
            </div>
          </div>
        ) : view.status !== 'mastered' ? (
          <>
            <div className="mt-2 flex gap-1.5">
              <Input
                value={exact}
                onChange={(e) => setExact(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExact()}
                type="number"
                min={0}
                placeholder={`Set total (${formatNumber(n.currentValue)})`}
                className="h-8 min-w-0 flex-1 text-xs"
                inputMode="decimal"
              />
              <Button size="sm" variant="outline" className="h-8" disabled={!exact} onClick={handleExact}>
                Set
              </Button>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              {quickAddSteps(n.targetValue).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="secondary"
                  className="h-8 flex-1 tabular-nums"
                  disabled={updateNode.isPending}
                  onClick={() => handleAdd(s)}
                >
                  +{s}
                </Button>
              ))}
              <Button
                size="sm"
                className="h-8 flex-1"
                disabled={updateNode.isPending || remaining <= 0}
                onClick={() => handleAdd(remaining)}
                title={`Complete all ${formatNumber(remaining)} remaining`}
              >
                All
              </Button>
            </div>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="mt-3 w-full"
            disabled={updateNode.isPending}
            onClick={() => updateNode.mutate({ nodeId: n.id, patch: { currentValue: 0 } })}
          >
            Reset progress
          </Button>
        )}

        {/* edit / delete — tucked away so the default view stays simple */}
        <div className="mt-3 border-t pt-2">
          <button
            type="button"
            onClick={() => setEditOpen(!editOpen)}
            className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={editOpen}
          >
            <span className="inline-flex items-center gap-1.5">
              <Pencil className="h-3 w-3" /> Edit checkpoint
            </span>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', editOpen && 'rotate-180')} />
          </button>
          {editOpen && (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-[1fr_70px_60px] gap-1.5">
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="h-8 text-xs" aria-label="Node title" />
                <Input
                  value={editTarget}
                  onChange={(e) => setEditTarget(e.target.value)}
                  type="number"
                  min={1}
                  className="h-8 text-xs"
                  aria-label="Target value"
                  title="Target"
                />
                <Input
                  value={editXp}
                  onChange={(e) => setEditXp(e.target.value)}
                  type="number"
                  min={1}
                  className="h-8 text-xs"
                  aria-label="XP value"
                  title="XP"
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8"
                  disabled={updateNode.isPending}
                  onClick={() => updateNode.mutate({ nodeId: n.id, patch: { move: 'up' } })}
                  title="Swap with the checkpoint above"
                >
                  <ArrowUp className="h-3.5 w-3.5" /> Up
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8"
                  disabled={updateNode.isPending}
                  onClick={() => updateNode.mutate({ nodeId: n.id, patch: { move: 'down' } })}
                  title="Swap with the checkpoint below"
                >
                  <ArrowDown className="h-3.5 w-3.5" /> Down
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 flex-1"
                  disabled={updateNode.isPending || !editTitle.trim()}
                  onClick={() => {
                    const t = parseFloat(editTarget)
                    const x = parseInt(editXp, 10)
                    updateNode.mutate({
                      nodeId: n.id,
                      patch: {
                        title: editTitle.trim(),
                        ...(t > 0 ? { targetValue: t } : {}),
                        ...(x > 0 ? { xpValue: x } : {}),
                      },
                    })
                  }}
                >
                  Save
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive"
                  aria-label="Delete node"
                  onClick={handleDelete}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Node cell
// ---------------------------------------------------------------------------

function NodeCell({
  goal,
  view,
  openId,
  setOpenId,
}: {
  goal: GoalData
  view: SkillNodeView
  openId: string | null
  setOpenId: (id: string | null) => void
}) {
  const updateNode = useUpdateNode(goal.id)
  const n = view.node
  const s = statusStyles(view.status, goalColor(goal.color).hex)
  const isOpen = openId === n.id

  return (
    <NodePopover goal={goal} view={view} open={isOpen} onOpenChange={(o) => setOpenId(o ? n.id : null)}>
      <button
        type="button"
        className={cn(
          'w-full rounded-xl border p-3 text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring',
          s.ring,
        )}
        style={s.bg ? { background: s.bg } : undefined}
        aria-label={`${n.title}: ${formatNumber(n.currentValue)} of ${formatNumber(n.targetValue)}${view.unit ? ` ${view.unit}` : ''}`}
      >
        <div className="flex items-center gap-2">
          <span className={cn('text-base leading-none', view.status === 'not_started' && 'opacity-50 grayscale')}>{n.icon}</span>
          <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', view.status === 'mastered' && 'text-white')}>
            {n.title}
          </span>
          {view.locked && view.status !== 'mastered' ? (
            <span
              className="flex shrink-0 items-center gap-1 rounded-full border border-dashed px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground"
              title={`Locked until ${view.deps.filter((d) => !d.mastered).map((d) => d.title).join(' + ')} cleared`}
            >
              <Lock className="h-2.5 w-2.5" /> locked
            </span>
          ) : view.status === 'mastered' ? (
            <Check className="h-4 w-4 shrink-0 text-white" />
          ) : view.status === 'in_progress' ? (
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : null}
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-1 text-[11px] tabular-nums" style={{ color: s.sub }}>
          <span>
            {formatNumber(n.currentValue)} / {formatNumber(n.targetValue)}
          </span>
          {view.unit ? <span className="truncate">{view.unit}</span> : null}
        </div>
        <div className="relative mt-1.5 h-1.5 w-full overflow-visible rounded-full" style={{ background: s.track }}>
          <div
            className="h-full overflow-hidden rounded-full transition-all duration-500"
            style={{ width: `${view.progressPct}%`, background: s.bar }}
          />
          {view.milestones.map((m) => (
            <span
              key={m.data.id}
              className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border transition-colors"
              style={{
                left: `calc(${m.t * 100}% - 5px)`,
                background: m.reached ? '#fbbf24' : 'var(--background)',
                borderColor: m.reached ? '#f59e0b' : 'var(--border)',
                boxShadow: m.reached ? '0 0 6px rgba(251,191,36,0.6)' : undefined,
              }}
              title={`Sub-checkpoint: ${formatNumber(m.data.value)}${m.data.label ? ` — ${m.data.label}` : ''}${m.reached ? ' ✓' : ''}`}
            />
          ))}
        </div>
        {view.milestones.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1" style={{ color: s.sub }}>
            {view.milestones.map((m) => (
              <span
                key={m.data.id}
                className={cn(
                  'rounded-full px-1.5 py-px text-[9px] font-semibold tabular-nums',
                  m.reached && 'bg-amber-400/20 text-amber-600 dark:text-amber-300',
                )}
              >
                {m.reached ? '★' : '·'} {formatNumber(m.data.value)}
              </span>
            ))}
          </div>
        )}
        {view.status === 'mastered' && (
          <div className="mt-1 text-right text-[10px] font-semibold uppercase tracking-wide text-white/80">
            +{n.xpValue} XP
          </div>
        )}
      </button>
    </NodePopover>
  )
}

// ---------------------------------------------------------------------------
// Path column
// ---------------------------------------------------------------------------

function PathColumn({
  goal,
  pv,
  openId,
  setOpenId,
}: {
  goal: GoalData
  pv: SkillPathView
  openId: string | null
  setOpenId: (id: string | null) => void
}) {
  const updatePath = useUpdatePath(goal.id)
  const deletePath = useDeletePath(goal.id)
  const addNode = useAddNode(goal.id)
  const accent = goalColor(goal.color).hex
  const [newNodeOpen, setNewNodeOpen] = useState(false)
  const [nt, setNt] = useState('')

  function addTier() {
    const raw = nt.trim()
    if (!raw) return
    let title = raw
    let target = 100
    const m = raw.match(/^(.*?)\s*\/\s*([\d.]+)\s*$/)
    if (m) {
      title = m[1].trim()
      target = parseFloat(m[2])
    }
    if (!title || isNaN(target) || target <= 0) return
    addNode.mutate(
      {
        pathId: pv.path.id,
        input: { title, targetValue: target },
      },
      {
        onSuccess: () => setNt(''),
        onError: (e) => toast.error('Could not add tier', { description: e.message }),
      },
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-2" data-clickable>
      {/* path header */}
      <div className="group/path relative rounded-xl border bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{pv.path.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{pv.path.title}</div>
            <div className="text-[11px] tabular-nums text-muted-foreground">
              {formatNumber(pv.current)} / {formatNumber(pv.target)}
              {pv.path.unit ? ` ${pv.path.unit}` : ''} · {pv.progressPct}%
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover/path:opacity-100 focus-visible:opacity-100"
                aria-label={`Path options for ${pv.path.title}`}
              >
                ⋯
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => updatePath.mutate({ pathId: pv.path.id, patch: { move: 'left' } })}>
                <ArrowLeft className="h-3.5 w-3.5" /> Move left
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => updatePath.mutate({ pathId: pv.path.id, patch: { move: 'right' } })}>
                <ArrowRight className="h-3.5 w-3.5" /> Move right
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() =>
                  deletePath.mutate(
                    { pathId: pv.path.id },
                    {
                      onSuccess: () => toast.success(`Path "${pv.path.title}" removed`),
                      onError: (e) => toast.error('Could not remove path', { description: e.message }),
                    },
                  )
                }
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete path
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* path total bar */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pv.progressPct}%`, background: accent }}
          />
        </div>
      </div>

      {/* nodes */}
      <div className="flex flex-col gap-2">
        {pv.nodes.map((nv) => (
          <NodeCell key={nv.node.id} goal={goal} view={nv} openId={openId} setOpenId={setOpenId} />
        ))}
      </div>

      {/* add tier */}
      {newNodeOpen ? (
        <div className="rounded-xl border border-dashed p-2">
          <div className="flex gap-1.5">
            <Input
              value={nt}
              onChange={(e) => setNt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTier()}
              placeholder="Title / target"
              className="h-8 text-xs"
              autoFocus
            />
            <Button size="sm" className="h-8" disabled={addNode.isPending} onClick={addTier}>
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Cancel" onClick={() => setNewNodeOpen(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="mt-1 px-0.5 text-[10px] text-muted-foreground">Format: &ldquo;HSK4 / 1200&rdquo; or title only for target 100</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNewNodeOpen(true)}
          className="flex items-center justify-center gap-1 rounded-xl border border-dashed py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <Plus className="h-3.5 w-3.5" /> Add tier
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The full interactive skill map
// ---------------------------------------------------------------------------

export function SkillMapGrid({ goal }: { goal: GoalData }) {
  const map = buildSkillMap(goal)
  const accent = goalColor(goal.color).hex
  const addPath = useAddPath(goal.id)
  const [openNodeId, setOpenNodeId] = useState<string | null>(null)
  const [newPathOpen, setNewPathOpen] = useState(false)
  const [pt, setPt] = useState('')
  const [pu, setPu] = useState('')

  function addPathNow() {
    if (!pt.trim()) return
    addPath.mutate(
      {
        title: pt.trim(),
        unit: pu.trim() || null,
        nodes: [{ title: 'Level 1', targetValue: 100 }],
      },
      {
        onSuccess: () => {
          setPt('')
          setPu('')
          setNewPathOpen(false)
        },
        onError: (e) => toast.error('Could not add path', { description: e.message }),
      },
    )
  }

  if (map.paths.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-2xl">🗺️</div>
        <p className="text-sm font-medium">No skill map yet</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          Add paths (e.g. Vocabulary, Grammar, Shooting…) with measurable tiers, or import them from JSON.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {newPathOpen ? (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <Input value={pt} onChange={(e) => setPt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPathNow()} placeholder="Path name" className="h-9 w-36 text-xs" autoFocus />
              <Input value={pu} onChange={(e) => setPu(e.target.value)} placeholder="Unit (opt.)" className="h-9 w-28 text-xs" />
              <Button size="sm" onClick={addPathNow} disabled={addPath.isPending || !pt.trim()}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNewPathOpen(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setNewPathOpen(true)}>
              <Plus className="h-4 w-4" /> Create a path
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3" onClick={() => undefined}>
      {/* grid of path columns */}
      <div className="nice-scroll -mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex min-w-max items-start gap-3">
          {map.paths.map((pv) => (
            <div key={pv.path.id} className="w-[190px] shrink-0 sm:w-[210px]">
              <PathColumn goal={goal} pv={pv} openId={openNodeId} setOpenId={setOpenNodeId} />
            </div>
          ))}

          {/* add path column */}
          <div className="w-[190px] shrink-0 sm:w-[210px]">
            {newPathOpen ? (
              <div className="rounded-xl border border-dashed p-2">
                <Label className="text-xs">New path</Label>
                <div className="mt-1.5 space-y-1.5">
                  <Input value={pt} onChange={(e) => setPt(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPathNow()} placeholder="e.g. Vocabulary" className="h-8 text-xs" autoFocus />
                  <Input value={pu} onChange={(e) => setPu(e.target.value)} placeholder="Unit (e.g. words)" className="h-8 text-xs" />
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-8 flex-1" onClick={addPathNow} disabled={addPath.isPending || !pt.trim()}>
                      <Plus className="h-3.5 w-3.5" /> Add path
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Cancel" onClick={() => setNewPathOpen(false)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setNewPathOpen(true)}
                className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-4 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                <Plus className="h-5 w-5" />
                Add path
              </button>
            )}
          </div>
        </div>
      </div>

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[4px]" style={{ background: accent }} /> mastered
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[4px] border border-primary/40 bg-card" /> in progress
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[4px] border border-border bg-muted/40" /> not started
        </span>
        <span className="ml-auto">Click a node to log progress</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compact read-only version (Roadmap tab & goal card)
// ---------------------------------------------------------------------------

export function SkillMapCompact({
  goal,
  onOpen,
  maxNodesPerPath = 4,
}: {
  goal: GoalData
  onOpen?: () => void
  maxNodesPerPath?: number
}) {
  const map = buildSkillMap(goal)
  const accent = goalColor(goal.color).hex

  const clickable = !!onOpen
  const Wrapper = clickable ? 'button' : 'div'

  return (
    <Wrapper
      {...(clickable ? { type: 'button' as const, onClick: onOpen, 'aria-label': `Open skill map for ${goal.title}` } : {})}
      className={cn('w-full text-left', clickable && 'cursor-pointer')}
    >
      <div className="nice-scroll -mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max gap-2">
          {map.paths.map((pv) => (
            <div key={pv.path.id} className="w-[150px] shrink-0 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm leading-none">{pv.path.icon}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{pv.path.title}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{pv.progressPct}%</span>
              </div>
              {pv.nodes.slice(0, maxNodesPerPath).map((nv) => (
                <div
                  key={nv.node.id}
                  className={cn(
                    'rounded-lg border px-2 py-1.5',
                    nv.status === 'mastered'
                      ? 'border-transparent text-white'
                      : nv.status === 'in_progress'
                        ? 'border-primary/30 bg-card'
                        : 'border-border/60 bg-muted/30',
                  )}
                  style={nv.status === 'mastered' ? { background: accent } : undefined}
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span className={cn('truncate text-[11px] font-medium', nv.status === 'mastered' && 'text-white')}>
                      {nv.node.title}
                    </span>
                    <span
                      className={cn('shrink-0 text-[10px] tabular-nums', nv.status === 'mastered' ? 'text-white/80' : 'text-muted-foreground')}
                    >
                      {formatNumber(nv.node.currentValue)}/{formatNumber(nv.node.targetValue)}
                    </span>
                  </div>
                  <div
                    className="mt-1 h-1 w-full overflow-hidden rounded-full"
                    style={{ background: nv.status === 'mastered' ? 'rgba(255,255,255,0.25)' : 'var(--muted)' }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${nv.progressPct}%`,
                        background: nv.status === 'mastered' ? 'rgba(255,255,255,0.9)' : accent,
                      }}
                    />
                  </div>
                </div>
              ))}
              {pv.nodes.length > maxNodesPerPath && (
                <div className="px-1 text-[10px] text-muted-foreground">+{pv.nodes.length - maxNodesPerPath} more…</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Wrapper>
  )
}

export type { SkillPathData }
