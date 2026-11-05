'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Crosshair, Eye, EyeOff, Lock, Maximize2, Minus, Plus, Sparkles, Trophy, Wand2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import type { GoalData } from '@/lib/types'
import { buildSkillMap } from '@/lib/skill-tree'
import { cubicAt, toContent, type Pt, type QuestDepEdge, type QuestLayout, type QuestNode, type QuestSegment } from '@/lib/quest-layout'
import { buildQuestLayout } from '@/lib/quest-layout'
import { goalColor } from '@/lib/goal-colors'
import { formatNumber } from '@/lib/goal-math'
import { useUpdateNode } from '@/hooks/use-goals'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// pan & zoom
// ---------------------------------------------------------------------------

interface View {
  x: number
  y: number
  scale: number
}

const MIN_SCALE = 0.4
const MAX_SCALE = 1.8
const EDGE_PAD = 90
/** The map opens zoomed in on your current step so it's readable at a
 *  glance — the whole-tree overview is one tap away (frame button). */
const DEFAULT_ZOOM = 1.1

function usePanZoom(width: number, height: number) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const [dragging, setDragging] = useState(false)
  /** when true the world div animates its transform (used by focusPoint smooth) */
  const [smooth, setSmooth] = useState(false)
  const smoothTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragRef = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ dist: number; scale: number; cx: number; cy: number } | null>(null)

  const clampView = useCallback(
    (v: View): View => {
      const el = containerRef.current
      const vw = el?.clientWidth ?? 900
      const vh = el?.clientHeight ?? 600
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale))
      const cw = width * scale
      const ch = height * scale
      let x = v.x
      let y = v.y
      if (cw <= vw) x = (vw - cw) / 2
      else x = Math.min(EDGE_PAD, Math.max(vw - cw - EDGE_PAD, x))
      if (ch <= vh) y = (vh - ch) / 2
      else y = Math.min(EDGE_PAD, Math.max(vh - ch - EDGE_PAD, y))
      return { x, y, scale }
    },
    [width, height],
  )

  const focusPoint = useCallback(
    (p: Pt, scale?: number, behavior: 'instant' | 'smooth' = 'instant') => {
      const el = containerRef.current
      if (!el) return
      const vw = el.clientWidth
      const vh = el.clientHeight
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale ?? 0.9))
      const next = clampView({ x: vw / 2 - p.x * s, y: vh / 2 - p.y * s, scale: s })
      if (behavior === 'smooth') {
        if (smoothTimer.current) clearTimeout(smoothTimer.current)
        setSmooth(true)
        smoothTimer.current = setTimeout(() => setSmooth(false), 520)
      }
      setView(next)
    },
    [clampView],
  )

  /** Zoom out until the entire tree is visible (the "see what's ahead" view). */
  const fitWholeTree = useCallback(
    (padding = 48, behavior: 'instant' | 'smooth' = 'smooth') => {
      const el = containerRef.current
      if (!el) return
      const vw = el.clientWidth
      const vh = el.clientHeight
      const fit = Math.min((vw - padding) / width, (vh - padding) / height)
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fit))
      focusPoint({ x: width / 2, y: height / 2 }, s, behavior)
    },
    [focusPoint, width, height],
  )

  // drag to pan
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()]
        pinchRef.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          scale: view.scale,
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
        }
        dragRef.current = null
        return
      }
      dragRef.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }
      setSmooth(false)
      setDragging(true)
    },
    [view],
  )

  useEffect(() => {
    if (!dragging && !pinchRef.current) return
    const move = (e: PointerEvent) => {
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      }
      // pinch
      if (pointersRef.current.size === 2 && pinchRef.current) {
        const [a, b] = [...pointersRef.current.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const el = containerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const cx = pinchRef.current.cx - rect.left
        const cy = pinchRef.current.cy - rect.top
        const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (pinchRef.current.scale * dist) / (pinchRef.current.dist || 1)))
        setView((v) => {
          const contentX = (cx - v.x) / v.scale
          const contentY = (cy - v.y) / v.scale
          return clampView({ x: cx - contentX * s, y: cy - contentY * s, scale: s })
        })
        return
      }
      // pan
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.sx
      const dy = e.clientY - d.sy
      if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true
      setView((v) => clampView({ ...v, x: d.vx + dx, y: d.vy + dy }))
    }
    const up = (e: PointerEvent) => {
      pointersRef.current.delete(e.pointerId)
      if (pointersRef.current.size < 2) pinchRef.current = null
      if (pointersRef.current.size === 0) {
        setDragging(false)
        // keep `moved` around briefly so the click handler can inspect it
        setTimeout(() => {
          if (dragRef.current) dragRef.current.moved = false
        }, 120)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragging, clampView])

  // wheel zoom (non-passive so we can preventDefault)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setSmooth(false)
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      setView((v) => {
        const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * Math.exp(-e.deltaY * 0.0012)))
        const contentX = (cx - v.x) / v.scale
        const contentY = (cy - v.y) / v.scale
        return clampView({ x: cx - contentX * s, y: cy - contentY * s, scale: s })
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [clampView])

  const zoomBy = useCallback(
    (factor: number) => {
      const el = containerRef.current
      if (!el) return
      setSmooth(false)
      const vw = el.clientWidth
      const vh = el.clientHeight
      setView((v) => {
        const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor))
        const cx = vw / 2
        const cy = vh / 2
        const contentX = (cx - v.x) / v.scale
        const contentY = (cy - v.y) / v.scale
        return clampView({ x: cx - contentX * s, y: cy - contentY * s, scale: s })
      })
    },
    [clampView],
  )

  const justDragged = useCallback(() => dragRef.current?.moved === true, [])

  return { containerRef, view, dragging, smooth, onPointerDown, focusPoint, fitWholeTree, zoomBy, justDragged }
}

// ---------------------------------------------------------------------------
// celebration burst
// ---------------------------------------------------------------------------

interface Burst {
  id: number
  x: number
  y: number
  color: string
  big: boolean
}

function BurstFx({ x, y, color, big }: { x: number; y: number; color: string; big: boolean }) {
  const particles = useMemo(
    () =>
      Array.from({ length: big ? 22 : 12 }, (_, i) => ({
        angle: (i / (big ? 22 : 12)) * Math.PI * 2 + Math.random() * 0.5,
        dist: (big ? 70 : 46) + Math.random() * (big ? 60 : 34),
        size: 3 + Math.random() * 4,
        color: i % 3 === 0 ? '#fbbf24' : i % 3 === 1 ? color : '#94a3b8',
        delay: Math.random() * 0.08,
      })),
    [big, color],
  )
  return (
    <div className="pointer-events-none absolute z-30" style={{ left: x, top: y }} aria-hidden>
      {particles.map((p, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{ width: p.size, height: p.size, background: p.color, left: -p.size / 2, top: -p.size / 2 }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: Math.cos(p.angle) * p.dist, y: Math.sin(p.angle) * p.dist - 24, opacity: 0, scale: 0.3 }}
          transition={{ duration: big ? 1.1 : 0.8, ease: 'easeOut', delay: p.delay }}
        />
      ))}
      {big && (
        <motion.span
          className="absolute -left-8 -top-8 flex h-16 w-16 items-center justify-center rounded-full text-2xl"
          initial={{ scale: 0, opacity: 1 }}
          animate={{ scale: [0, 1.25, 1], opacity: [1, 1, 0] }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        >
          🏆
        </motion.span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// node popover (log progress)
// ---------------------------------------------------------------------------

function quickAddSteps(target: number): number[] {
  if (target >= 1000) return [25, 50, 100]
  if (target >= 300) return [10, 25, 50]
  if (target >= 60) return [5, 10, 25]
  if (target >= 12) return [1, 2, 5]
  return [1]
}

function NodeLogPopover({
  goal,
  qn,
  open,
  onOpenChange,
  children,
}: {
  goal: GoalData
  qn: QuestNode
  open: boolean
  onOpenChange: (o: boolean) => void
  children: React.ReactNode
}) {
  const [amount, setAmount] = useState('')
  const updateNode = useUpdateNode(goal.id)
  const n = qn.node
  const c = goalColor(goal.color)
  const unit = qn.unit ?? ''
  const remaining = Math.max(0, n.targetValue - n.currentValue)

  function add(v: number) {
    updateNode.mutate(
      { nodeId: n.id, patch: { add: v } },
      {
        onError: (e) => toast.error('Could not update', { description: e.message }),
      },
    )
  }

  const canLog = (qn.view === 'active' || qn.view === 'mastered') && remaining > 0 && !updateNode.isPending

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        align="center"
        sideOffset={12}
        collisionPadding={12}
        className="w-72 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{n.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{n.title}</div>
            <div className="text-[11px] text-muted-foreground">
              {qn.path.title}
              {n.description ? ` · ${n.description}` : ''}
            </div>
          </div>
          {qn.view === 'mastered' && <Trophy className="h-4 w-4 shrink-0 text-amber-500" />}
        </div>

        <div className="mt-2.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold tabular-nums">
              {formatNumber(n.currentValue)} / {formatNumber(n.targetValue)} {unit}
            </span>
            <span className="tabular-nums text-muted-foreground">{Math.round(qn.progressPct)}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${qn.progressPct}%`, background: qn.view === 'mastered' ? '#f59e0b' : c.hex }}
            />
          </div>
        </div>

        {qn.milestones.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {qn.milestones.map((m) => (
              <span
                key={m.data.id}
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                  m.reached ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground',
                )}
              >
                {m.reached ? '⭐' : '·'} {formatNumber(m.data.value)}
                {m.data.label ? ` · ${m.data.label}` : ''}
              </span>
            ))}
          </div>
        )}

        {/* derived checkpoint: a passive meter fed by its source */}
        {n.deriveFromId && n.deriveFactor != null && (
          <div className="mt-2.5 rounded-lg border border-violet-500/25 bg-violet-500/8 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 dark:text-violet-400">
              <Wand2 className="h-3 w-3 shrink-0" />
              Auto-advances from {((): string => {
                const src = goal.skillPaths.flatMap((p) => p.nodes).find((x) => x.id === n.deriveFromId)
                return src ? src.title : 'its source'
              })()}
            </div>
            <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
              Every {formatNumber(n.deriveFactor)} of the source = 1 {unit || 'unit'} here — no per-session math.
            </div>
          </div>
        )}

        {qn.view === 'mastered' ? (
          <div className="mt-3 rounded-lg bg-amber-500/10 px-2.5 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            🎉 Cleared — worth {n.xpValue} XP
            {n.completedAt && ` · ${new Date(n.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
          </div>
        ) : qn.view === 'active' ? (
          <>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {quickAddSteps(n.targetValue).map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={!canLog}
                  onClick={() => add(q)}
                  className="rounded-lg border bg-muted/40 px-2 py-1 text-xs font-semibold tabular-nums transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                >
                  +{formatNumber(q)}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              <Input
                type="number"
                min={0}
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = parseFloat(amount)
                    if (!isNaN(v) && v > 0) add(v)
                  }
                }}
                placeholder={`+${unit || 'amount'}`}
                className="h-8 min-w-0 flex-1 text-xs"
                autoFocus
                inputMode="decimal"
              />
              <Button
                size="sm"
                className="h-8 px-3"
                disabled={!canLog || !amount || (parseFloat(amount) <= 0)}
                onClick={() => {
                  const v = parseFloat(amount)
                  if (!isNaN(v) && v > 0) {
                    add(v)
                    setAmount('')
                  }
                }}
              >
                Add
              </Button>
            </div>
            {remaining > 0 && (
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                {formatNumber(remaining)} {unit} to clear this checkpoint
              </div>
            )}
          </>
        ) : qn.view === 'locked' ? (
          <div className="mt-3 space-y-1.5 rounded-lg bg-muted/60 px-2.5 py-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              Unlocks after
            </div>
            <div className="flex flex-wrap gap-1">
              {qn.deps.map((d) => (
                <span
                  key={d.id}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    d.mastered
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                      : 'bg-muted text-muted-foreground',
                  )}
                  title={d.pathTitle ? `${d.pathTitle} · ${d.title}` : d.title}
                >
                  {d.mastered ? '✓' : <Lock className="h-2.5 w-2.5" />}
                  {d.pathTitle && d.pathTitle !== qn.path.title ? `${d.pathIcon} ` : ''}
                  {d.title}
                </span>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Clear {qn.deps.filter((d) => !d.mastered).length === 1 ? 'it' : 'them'} and this checkpoint opens up.
            </p>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            Unlocks when the checkpoint before it is cleared — one step at a time.
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// the quest map
// ---------------------------------------------------------------------------

export function QuestMap({ goal, className }: { goal: GoalData; className?: string }) {
  const layout = useMemo(() => buildQuestLayout(goal), [goal])
  const stats = useMemo(() => buildSkillMap(goal).stats, [goal])
  const c = goalColor(goal.color)
  const [revealAll, setRevealAll] = useState(false)
  const [openNodeId, setOpenNodeId] = useState<string | null>(null)
  const [bursts, setBursts] = useState<Burst[]>([])
  const burstSeq = useRef(0)
  const [mounted, setMounted] = useState(false)
  /** goal.id we last auto-framed — re-framing on every data refresh would yank the view around */
  const framedFor = useRef<string | null>(null)

  const { containerRef, view, dragging, smooth, onPointerDown, focusPoint, fitWholeTree, zoomBy, justDragged } =
    usePanZoom(layout.width, layout.height)

  // entrance choreography flag (one-shot)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 1400)
    return () => clearTimeout(t)
  }, [])

  // initial view: zoomed in on your current step — the whole tree stays one
  // tap away with the frame button. Only when switching goals, never on
  // plain data refreshes (that would yank the view around).
  useEffect(() => {
    if (framedFor.current === goal.id) return
    framedFor.current = goal.id
    const target =
      layout.paths.find((p) => p.activePoint)?.activePoint ?? layout.paths[0]?.nodes[0] ?? null
    const frontier = target ? toContent(layout, target) : toContent(layout, layout.root)
    focusPoint(frontier, DEFAULT_ZOOM, 'instant')
  }, [goal.id, layout, focusPoint])

  // detect live transitions (mastered / milestone reached) → celebrate
  const prevRef = useRef<Map<string, { mastered: boolean; reached: Set<number> }> | null>(null)
  useEffect(() => {
    const now = new Map<string, { mastered: boolean; reached: Set<number> }>()
    for (const p of layout.paths) {
      for (const qn of p.nodes) {
        now.set(qn.node.id, {
          mastered: qn.status === 'mastered',
          reached: new Set(qn.milestones.filter((m) => m.reached).map((m) => m.data.value)),
        })
      }
    }
    const prev = prevRef.current
    prevRef.current = now
    if (!prev) return

    const newBursts: Burst[] = []
    for (const p of layout.paths) {
      for (const qn of p.nodes) {
        const before = prev.get(qn.node.id)
        if (!before) continue
        const at = toContent(layout, { x: qn.x, y: qn.y })
        if (!before.mastered && qn.status === 'mastered') {
          newBursts.push({ id: burstSeq.current++, x: at.x, y: at.y, color: c.hex, big: true })
          toast.success(`Checkpoint cleared — ${qn.node.title}!`, {
            description: `+${qn.node.xpValue} XP · the path sprouts onward 🌱`,
          })
        }
        for (const m of qn.milestones) {
          if (m.reached && !before.reached.has(m.data.value)) {
            const mp = toContent(layout, { x: m.x, y: m.y })
            newBursts.push({ id: burstSeq.current++, x: mp.x, y: mp.y, color: '#fbbf24', big: false })
            toast(`⭐ ${m.data.label ?? `${formatNumber(m.data.value)} ${qn.unit ?? ''}`} — sub-checkpoint! +5 XP`)
          }
        }
      }
    }
    if (newBursts.length) {
      const ids = new Set(newBursts.map((b) => b.id))
      // celebrate on the next tick so the new state paints first
      setTimeout(() => {
        setBursts((b) => [...b, ...newBursts])
        setTimeout(() => setBursts((b) => b.filter((x) => !ids.has(x.id))), 1400)
      }, 0)
    }
  }, [layout, c.hex])

  const total = stats.totalNodes
  const masteredPct = total > 0 ? Math.round((stats.mastered / total) * 100) : 0
  const nodeViewById = useMemo(() => {
    const m = new Map<string, QuestNode['view']>()
    for (const p of layout.paths) for (const qn of p.nodes) m.set(qn.node.id, qn.view)
    return m
  }, [layout])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-[68dvh] max-h-[720px] min-h-[440px] touch-none select-none overflow-hidden rounded-2xl border bg-card sm:h-[600px] lg:h-[640px]',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
        className,
      )}
      onPointerDown={onPointerDown}
      role="application"
      aria-label={`Skill tree for ${goal.title} — drag to pan, scroll to zoom`}
    >
      {/* ambient background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(600px 380px at 50% 108%, color-mix(in oklab, var(--primary) 14%, transparent), transparent 70%), radial-gradient(500px 300px at 12% -10%, color-mix(in oklab, var(--primary) 8%, transparent), transparent 70%), radial-gradient(500px 320px at 96% 12%, rgba(251,191,36,0.07), transparent 70%)',
        }}
      />

      {/* the pannable / zoomable world */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transition: smooth ? 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
        }}
      >
        <svg width={layout.width} height={layout.height} className="absolute inset-0 overflow-visible">
          {/* segment geometry lives in raw tree coordinates (root at 0,0) — shift it
              into content space so the roads meet the checkpoint circles exactly */}
          <g transform={`translate(${-layout.offset.x} ${-layout.offset.y})`}>
            {layout.paths.map((p, pi) => {
              const activeIdx = p.nodes.findIndex((x) => x.view === 'active')
              return p.segments.map((seg) => {
                const node = p.nodes[seg.toIndex]
                return (
                  <SegmentSvg
                    key={`${pi}-${seg.toIndex}`}
                    seg={seg}
                    color={c.hex}
                    revealAll={revealAll}
                    mounted={mounted}
                    pathIndex={pi}
                    isNextUp={!seg.unlocked && (node.view === 'locked' || seg.toIndex === activeIdx + 1)}
                  />
                )
              })
            })}
            {/* explicit dependency edges: "unlocks after …" threads between branches */}
            {layout.depEdges.map((e) => {
              const targetView = nodeViewById.get(e.id.split('->')[1])
              const visible = revealAll || (targetView && targetView !== 'ghost')
              if (!visible) return null
              return <DepEdgeSvg key={e.id} edge={e} mounted={mounted} />
            })}
          </g>
        </svg>

        {/* root */}
        <RootNode layout={layout} goal={goal} />

        {/* path labels */}
        {layout.paths.map((p, pi) => {
          const at = toContent(layout, p.labelPoint)
          return (
            <motion.div
              key={`label-${pi}`}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: at.x, top: at.y }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: mounted ? 0 : 0.15 + pi * 0.08, type: 'spring', stiffness: 260, damping: 20 }}
            >
              <span className="flex items-center gap-1 rounded-full border bg-background/90 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground shadow-sm backdrop-blur">
                <span>{p.path.icon}</span>
                <span className="max-w-24 truncate">{p.path.title}</span>
              </span>
            </motion.div>
          )
        })}

        {/* milestone stars */}
        {layout.paths.map((p, pi) =>
          p.nodes.flatMap((qn) =>
            qn.milestones.map((m) => {
              const at = toContent(layout, { x: m.x, y: m.y })
              const seg = p.segments[qn.tier]
              const segUnlocked = seg?.unlocked ?? false
              const visible = segUnlocked || revealAll
              const isNextUp =
                qn.view === 'active' && !m.reached && !qn.milestones.some((x) => !x.reached && x.data.value < m.data.value)
              return (
                <motion.div
                  key={m.data.id}
                  className="absolute z-10"
                  style={{ left: at.x, top: at.y }}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{
                    scale: visible ? 1 : 0,
                    opacity: visible ? 1 : 0,
                  }}
                  transition={
                    m.reached
                      ? { type: 'spring', stiffness: 380, damping: 15, delay: mounted ? 0 : 0.25 + pi * 0.06 + qn.tier * 0.14 + m.t * 0.2 }
                      : { duration: 0.3 }
                  }
                >
                  <div className="relative -translate-x-1/2 -translate-y-1/2">
                    <div
                      className={cn(
                        'flex items-center justify-center rounded-full border-2 text-[10px] font-bold',
                        m.reached
                          ? 'h-7 w-7 border-background bg-amber-400 text-amber-950 shadow-[0_0_12px_rgba(251,191,36,0.65)]'
                          : isNextUp
                            ? 'h-5 w-5 border-dashed border-muted-foreground/60 bg-background/90 text-muted-foreground'
                            : 'h-4 w-4 border-background bg-muted/70 text-muted-foreground/70',
                      )}
                      title={`${formatNumber(m.data.value)} ${qn.unit ?? ''}${m.data.label ? ` — ${m.data.label}` : ''}${m.reached ? ' ✓' : ''}`}
                    >
                      {m.reached ? '★' : ''}
                    </div>
                    {isNextUp && (
                      <span
                        aria-hidden
                        className="quest-ping absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400/60"
                      />
                    )}
                  </div>
                </motion.div>
              )
            }),
          ),
        )}

        {/* travelers on active segments */}
        {layout.paths.map((p, pi) => {
          const qn = p.nodes.find((x) => x.view === 'active')
          if (!qn) return null
          const seg = p.segments[qn.tier]
          if (!seg) return null
          const t = Math.min(0.92, qn.progressPct / 100)
          const pt = toContent(layout, cubicAt(seg.from, seg.c1, seg.c2, seg.to, Math.max(0.06, t)))
          return (
            <motion.div
              key={`traveler-${pi}`}
              className="absolute z-10"
              style={{ left: pt.x, top: pt.y }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: mounted ? 0 : 0.8 }}
            >
              <div className="relative -translate-x-1/2 -translate-y-1/2">
                <span
                  aria-hidden
                  className="quest-glow absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ background: `color-mix(in srgb, ${c.hex} 30%, transparent)` }}
                />
                <span
                  className="relative block h-3.5 w-3.5 rounded-full border-2 border-background shadow"
                  style={{ background: c.hex }}
                />
              </div>
            </motion.div>
          )
        })}

        {/* checkpoint nodes */}
        {layout.paths.map((p, pi) =>
          p.nodes.map((qn) => {
            const at = toContent(layout, { x: qn.x, y: qn.y })
            const hiddenGhost = qn.view === 'ghost' && !revealAll
            if (hiddenGhost) return null
            return (
              <CheckpointNode
                key={qn.node.id}
                goal={goal}
                qn={qn}
                at={at}
                delay={mounted ? 0 : 0.1 + pi * 0.05 + qn.tier * 0.13}
                mounted={mounted}
                pathIndex={pi}
                open={openNodeId === qn.node.id}
                onOpen={(o) => setOpenNodeId(o ? qn.node.id : null)}
                justDragged={justDragged}
              />
            )
          }),
        )}

        {/* celebration bursts */}
        <AnimatePresence>
          {bursts.map((b) => (
            <BurstFx key={b.id} x={b.x} y={b.y} color={b.color} big={b.big} />
          ))}
        </AnimatePresence>
      </div>

      {/* ---- overlays (fixed to the map frame) ---- */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 rounded-full border bg-background/90 px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur">
            <Zap className="h-3 w-3 text-amber-500" /> {stats.xpEarned} XP
          </span>
          <span className="flex items-center gap-1 rounded-full border bg-background/90 px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur">
            <Trophy className="h-3 w-3 text-amber-500" /> {stats.mastered}/{total}
          </span>
          {stats.milestonesTotal > 0 && (
            <span className="flex items-center gap-1 rounded-full border bg-background/90 px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur">
              <Sparkles className="h-3 w-3 text-amber-500" /> {stats.milestonesReached}/{stats.milestonesTotal}
            </span>
          )}
          <span className="rounded-full border bg-background/90 px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur">
            {masteredPct}% cleared
          </span>
          {stats.locked > 0 && (
            <span className="flex items-center gap-1 rounded-full border bg-background/90 px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur">
              <Lock className="h-3 w-3 text-muted-foreground" /> {stats.locked} locked
            </span>
          )}
        </div>

        <div className="pointer-events-auto flex items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8 bg-background/90 backdrop-blur"
            aria-label={revealAll ? 'Adventure mode — hide locked checkpoints' : 'Reveal the full roadmap'}
            title={revealAll ? 'Adventure mode' : 'Reveal all'}
            onClick={() => setRevealAll(!revealAll)}
          >
            {revealAll ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <div className="flex overflow-hidden rounded-lg border bg-background/90 backdrop-blur">
            <button
              type="button"
              className="px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Zoom out"
              onClick={() => zoomBy(1 / 1.25)}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="border-l px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Zoom in"
              onClick={() => zoomBy(1.25)}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="border-l px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Zoom out to see the whole tree"
              title="Whole tree"
              onClick={() => fitWholeTree(48, 'smooth')}
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="border-l px-2 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Recentre on your current checkpoint"
              title="Recentre"
              onClick={() => {
                const target =
                  layout.paths.find((p) => p.activePoint)?.activePoint ?? layout.paths[0]?.nodes[0] ?? layout.root
                const pt = toContent(layout, target)
                focusPoint(pt, DEFAULT_ZOOM, 'smooth')
              }}
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* legend + hint */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-end justify-between gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2 rounded-full border bg-background/85 px-3 py-1.5 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> cleared
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: c.hex }} /> in progress
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full border border-muted-foreground/50 bg-background" /> locked
          </span>
          <span className="flex items-center gap-1">
            <span className="text-amber-500">★</span> sub-checkpoint
          </span>
        </div>
        <span className="rounded-full bg-background/60 px-2.5 py-1 text-[10px] text-muted-foreground backdrop-blur">
          drag to wander · scroll / pinch to zoom · tap a checkpoint
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function SegmentSvg({
  seg,
  color,
  revealAll,
  mounted,
  pathIndex,
  isNextUp,
}: {
  seg: QuestSegment
  color: string
  revealAll: boolean
  mounted: boolean
  pathIndex: number
  isNextUp: boolean
}) {
  const delay = mounted ? 0 : 0.08 + pathIndex * 0.06 + seg.toIndex * 0.13
  const drawIn = seg.lit
  const toMastered = seg.lit >= 1

  if (seg.unlocked) {
    return (
      <g>
        {/* the road */}
        <motion.path
          d={seg.d}
          fill="none"
          className="stroke-muted-foreground/30"
          strokeWidth={14}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.7, ease: 'easeOut', delay }}
        />
        {/* dotted centre line */}
        <motion.path
          d={seg.d}
          fill="none"
          className="stroke-muted-foreground/25"
          strokeWidth={1.5}
          strokeDasharray="2 8"
          strokeLinecap="round"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: delay + 0.3 }}
        />
        {/* lit progress — wide glow */}
        <motion.path
          d={seg.d}
          fill="none"
          stroke={color}
          strokeWidth={14}
          strokeLinecap="round"
          style={{ opacity: 0.22 }}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: drawIn }}
          transition={{ duration: 0.7, ease: 'easeOut', delay: delay + 0.15 }}
        />
        {/* lit progress — core */}
        <motion.path
          d={seg.d}
          fill="none"
          stroke={toMastered ? '#f59e0b' : color}
          strokeWidth={6}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: drawIn }}
          transition={{ duration: 0.7, ease: 'easeOut', delay: delay + 0.15 }}
        />
      </g>
    )
  }

  // locked: faint dashed preview (only the immediate next one, or all in reveal mode)
  if (isNextUp || revealAll) {
    return (
      <motion.path
        d={seg.d}
        fill="none"
        className="stroke-muted-foreground/35"
        strokeWidth={3}
        strokeDasharray="2 10"
        strokeLinecap="round"
        initial={{ opacity: 0 }}
        animate={{ opacity: revealAll ? 0.55 : 0.8 }}
        transition={{ duration: 0.5, delay: delay + 0.2 }}
      />
    )
  }
  return null
}

/** A dashed "unlocks after" thread between two checkpoints. */
function DepEdgeSvg({ edge, mounted }: { edge: QuestDepEdge; mounted: boolean }) {
  const { from, to, met, toTier } = edge
  const f = (n: number) => Math.round(n * 10) / 10
  const dx = to.x - from.x
  const c1 = { x: from.x + dx * 0.25, y: from.y - 48 }
  const c2 = { x: to.x - dx * 0.25, y: to.y + 48 }
  const d = `M ${f(from.x)} ${f(from.y)} C ${f(c1.x)} ${f(c1.y)}, ${f(c2.x)} ${f(c2.y)}, ${f(to.x)} ${f(to.y)}`
  const pt = cubicAt(from, c1, c2, to, 0.55)
  const delay = mounted ? 0 : 0.35 + toTier * 0.09
  return (
    <g>
      <motion.path
        d={d}
        fill="none"
        stroke={met ? '#10b981' : '#94a3b8'}
        strokeWidth={met ? 2.5 : 2}
        strokeDasharray="3 9"
        strokeLinecap="round"
        style={{ opacity: met ? 0.4 : 0.55 }}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: met ? 0.4 : 0.55 }}
        transition={{ duration: 0.8, ease: 'easeOut', delay }}
      />
      {!met && (
        <motion.g
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: delay + 0.35, type: 'spring', stiffness: 320, damping: 16 }}
          style={{ transformOrigin: `${pt.x}px ${pt.y}px` }}
        >
          <circle cx={pt.x} cy={pt.y} r={11} className="fill-background" stroke="#94a3b8" strokeWidth={1.5} />
          <text
            x={pt.x}
            y={pt.y + 4}
            textAnchor="middle"
            style={{ fontSize: 10 }}
            aria-hidden
          >
            🔒
          </text>
        </motion.g>
      )}
    </g>
  )
}

function RootNode({ layout, goal }: { layout: QuestLayout; goal: GoalData }) {
  const c = goalColor(goal.color)
  const at = toContent(layout, layout.root)
  return (
    <motion.div
      className="absolute z-10"
      style={{ left: at.x, top: at.y }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
    >
      <div className="-translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ display: 'flex' }}>
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 text-2xl shadow-lg"
          style={{ background: c.soft, borderColor: c.hex }}
        >
          {goal.emoji}
        </div>
        <span className="mt-1 rounded-full bg-background/85 px-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          start
        </span>
      </div>
    </motion.div>
  )
}

function CheckpointNode({
  goal,
  qn,
  at,
  delay,
  mounted,
  pathIndex,
  open,
  onOpen,
  justDragged,
}: {
  goal: GoalData
  qn: QuestNode
  at: Pt
  delay: number
  mounted: boolean
  pathIndex: number
  open: boolean
  onOpen: (o: boolean) => void
  justDragged: () => boolean
}) {
  const c = goalColor(goal.color)
  const isGhost = qn.view === 'ghost'
  const isNext = qn.view === 'next'
  const isLocked = qn.view === 'locked'
  const mastered = qn.view === 'mastered'
  const active = qn.view === 'active'

  return (
    <NodeLogPopover goal={goal} qn={qn} open={open} onOpenChange={onOpen}>
      <motion.button
        type="button"
        className="absolute z-20 flex flex-col items-center"
        style={{ left: at.x, top: at.y }}
        initial={{ scale: 0, opacity: 0, x: '-50%' }}
        animate={{
          scale: 1,
          opacity: isGhost ? 0.45 : 1,
          x: '-50%',
        }}
        whileHover={isGhost ? undefined : { scale: 1.08 }}
        whileTap={isGhost ? undefined : { scale: 0.94 }}
        transition={{
          type: 'spring',
          stiffness: 300,
          damping: 17,
          delay: mounted ? 0 : delay + pathIndex * 0.02,
        }}
        onClick={() => {
          if (justDragged()) return
          onOpen(!open)
        }}
        aria-label={`${qn.node.title} — ${formatNumber(qn.node.currentValue)} of ${formatNumber(qn.node.targetValue)} ${qn.unit ?? ''}${mastered ? ', cleared' : active ? ', in progress' : isLocked ? `, locked until ${qn.deps.filter((d) => !d.mastered).map((d) => d.title).join(' + ')} cleared` : ', locked'}`}
      >
        <div className="relative -translate-y-1/2">
          {/* pulse ring for the frontier — pure CSS, compositor-driven */}
          {active && qn.progressPct < 100 && (
            <span
              aria-hidden
              className="quest-ping absolute left-1/2 top-1/2 h-[76px] w-[76px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border-2"
              style={{ borderColor: `color-mix(in srgb, ${c.hex} 55%, transparent)` }}
            />
          )}

          <div
            className={cn(
              'relative flex h-14 w-14 items-center justify-center rounded-2xl border-2 text-xl shadow-md sm:h-16 sm:w-16',
              isGhost && 'grayscale',
            )}
            style={
              mastered
                ? { background: 'linear-gradient(135deg,#fbbf24,#f59e0b)', borderColor: '#fcd34d', color: '#78350f' }
                : active
                  ? { background: c.soft, borderColor: c.hex }
                  : isLocked
                    ? {
                        background: 'color-mix(in oklab, var(--muted) 30%, var(--background))',
                        borderColor: 'color-mix(in oklab, var(--muted-foreground) 40%, transparent)',
                        borderStyle: 'dashed',
                      }
                    : isNext
                      ? { background: 'color-mix(in oklab, var(--muted) 55%, var(--background))', borderColor: 'var(--border)' }
                      : { background: 'var(--muted)', borderColor: 'var(--border)' }
            }
          >
            {isGhost ? (
              <Lock className="h-5 w-5 text-muted-foreground" />
            ) : (
              <span style={{ opacity: isLocked ? 0.55 : 1 }}>{qn.node.icon}</span>
            )}
            {mastered && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-amber-300 bg-amber-400 text-[9px] font-black text-amber-950 shadow">
                ✓
              </span>
            )}
            {isNext && !mastered && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow">
                <Lock className="h-2.5 w-2.5" />
              </span>
            )}
            {isLocked && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-muted-foreground/40 bg-background text-muted-foreground shadow">
                <Lock className="h-2.5 w-2.5" />
              </span>
            )}
            {/* progress ring for active */}
            {active && qn.progressPct > 0 && (
              <svg
                className="absolute inset-[-5px] h-[calc(100%+10px)] w-[calc(100%+10px)] -rotate-90"
                viewBox="0 0 100 100"
                aria-hidden
              >
                <circle
                  cx="50"
                  cy="50"
                  r="47"
                  fill="none"
                  stroke={c.hex}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={`${(qn.progressPct / 100) * 295.3} 295.3`}
                  style={{ transition: 'stroke-dasharray 0.5s ease' }}
                />
              </svg>
            )}
          </div>
        </div>

        {/* captions hang below the circle */}
        <span
          className={cn(
            'mt-1 max-w-28 truncate rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm backdrop-blur',
            isGhost ? 'bg-muted/70 text-muted-foreground' : 'bg-background/90 text-foreground',
          )}
        >
          {isGhost ? '???' : qn.node.title}
        </span>
        {!isGhost && (
          <span className="mt-0.5 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
            {mastered
              ? `${formatNumber(qn.node.targetValue)} ✓`
              : `${formatNumber(qn.node.currentValue)}/${formatNumber(qn.node.targetValue)}${qn.unit ? ` ${qn.unit}` : ''}`}
          </span>
        )}
      </motion.button>
    </NodeLogPopover>
  )
}
