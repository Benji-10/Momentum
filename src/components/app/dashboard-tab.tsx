'use client'

import { useMemo, useState } from 'react'
import {
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Flame,
  ListFilter,
  Plus,
  Repeat,
  Search,
  Target,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react'
import type { GoalData, RoutineData } from '@/lib/types'
import { computeGoalStats, formatNumber } from '@/lib/goal-math'
import { buildSkillMap, computeXp, xpToReachLevel } from '@/lib/skill-tree'
import { occurrencesInRange, routineStats, sameDay, startOfWeek, toDayKey, weekFlexProgress, isRoutineDone } from '@/lib/routine-math'
import { goalColor } from '@/lib/goal-colors'
import { useToggleRoutineDone } from '@/hooks/use-goals'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GoalCard } from '@/components/app/goal-card'
import { EditLogDialog, type EditLogTarget } from '@/components/app/edit-log-dialog'
import { NodeQuickAddPopover, QuickLogPopover } from '@/components/app/quick-log'
import { cn } from '@/lib/utils'

type StatusFilter = 'all' | 'on_track' | 'behind' | 'completed'
type TypeFilter = 'all' | 'quantitative' | 'plan'
type SortKey = 'recent' | 'deadline' | 'progress' | 'name'

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Newest first',
  deadline: 'Deadline soonest',
  progress: 'Most progress',
  name: 'Name A–Z',
}

function XpBadge({ goals }: { goals: GoalData[] }) {
  const xp = useMemo(() => computeXp(goals), [goals])
  return (
    <Card className="relative overflow-hidden p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Level</span>
        <Zap className="h-4 w-4 text-amber-500" />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums">{xp.level}</span>
        <span className="text-xs text-muted-foreground">{xp.xp.toLocaleString()} XP total</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-700"
          style={{ width: `${Math.round(xp.levelProgress * 100)}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {xp.xpForNext} XP to level {xp.level + 1}
      </div>
    </Card>
  )
}

/** Today's checkable list: every routine scheduled for today, any goal.
 *  Flexible (any-day-this-week) routines follow below — they aren't pinned
 *  to today, so they get their own quota rows instead. */
function TodayChecklist({ goals, onOpenGoal }: { goals: GoalData[]; onOpenGoal: (g: GoalData, tab?: string) => void }) {
  const toggleDone = useToggleRoutineDone()
  const today = new Date()
  const [editLog, setEditLog] = useState<EditLogTarget | null>(null)

  // computed inline (React Compiler memoizes); `today` changes every render,
  // so a manual useMemo over it could never be preserved anyway
  const occs = goals
    .flatMap((g) =>
      g.routines
        .filter((r) => !r.archived)
        .map((r) => ({ routine: r, goal: g, occ: occurrencesInRange([r], g.deadline, today, today)[0] })),
    )
    .filter((x) => x.occ)
    .map((x) => ({ ...x.occ!, goal: x.goal, routine: x.routine }))

  // flexible routines: "N times a week, any day" — shown while this week
  // still has sessions left (or one was logged today, so it can be undone)
  const flex = goals
    .flatMap((g) =>
      g.routines
        .filter((r) => !r.archived && r.cadence === 'flexible')
        .map((r) => ({ routine: r, goal: g, prog: weekFlexProgress(r, startOfWeek(today)) })),
    )
    .filter((x) => x.prog.left > 0 || isRoutineDone(x.routine, today))

  if (occs.length === 0 && flex.length === 0) return null

  const doneCount = occs.filter((o) => o.done).length

  const checkOff = (o: { goal: GoalData; routine: RoutineData; done: boolean; date: Date }) =>
    toggleDone.mutate(
      {
        goalId: o.goal.id,
        routineId: o.routine.id,
        date: toDayKey(o.date), // the day in the user's calendar — TZ-proof
        undo: o.done,
      },
      {
        onSuccess: (res) => {
          const autoLog = res.autoLog
          if (!autoLog || o.done) return
          const unit = o.goal.unit ?? (o.goal.type === 'plan' ? 'session' : 'progress')
          const shown =
            unit === 'session' || unit === 'sessions'
              ? `${formatNumber(autoLog.amount)} ${autoLog.amount === 1 ? 'session' : 'sessions'}${o.routine.durationMin ? ` · ${o.routine.durationMin}m` : ''}`
              : `${formatNumber(autoLog.amount)} ${unit || 'progress'}`
          toast.success(`${o.routine.title} done`, {
            description: `Logged ${shown} — not quite right?`,
            action: {
              label: 'Edit',
              onClick: () =>
                setEditLog({
                  goalId: o.goal.id,
                  logId: autoLog.id,
                  amount: autoLog.amount,
                  unit: unit === 'progress' ? 'unit' : unit,
                  title: o.routine.title,
                  note: autoLog.note,
                  day: toDayKey(o.date),
                }),
            },
          })
        },
      },
    )

  return (
    <section aria-label="Today's checklist">
      {occs.length > 0 && (
        <>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              ✅ Check off when done — today&apos;s routines
            </h3>
            <span className="text-xs tabular-nums text-muted-foreground">
              {doneCount}/{occs.length}
            </span>
          </div>
          <div className="divide-y divide-border/60">
            {occs.map((o) => {
              const g = o.goal
              const c = goalColor(g.color)
              return (
                <div key={o.routine.id + o.date.toISOString()} className="flex items-center gap-3 py-2.5">
                  <button
                    type="button"
                    aria-label={o.done ? `Undo "${o.routine.title}"` : `Mark "${o.routine.title}" as done`}
                    onClick={() => checkOff(o)}
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all hover:scale-110',
                      o.done
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/40 hover:border-primary',
                    )}
                  >
                    {o.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className={cn('text-sm font-medium leading-snug', o.done && 'text-muted-foreground line-through')}>
                      {o.routine.title}
                      {o.routine.optional && (
                        <span
                          className="ml-1.5 rounded-full bg-violet-500/15 px-1.5 py-px align-middle text-[9px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400"
                          title="Extra credit — skipping this never counts against you"
                        >
                          extra
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{g.emoji}</span>
                      <button
                        type="button"
                        className="max-w-40 truncate hover:underline"
                        onClick={() => onOpenGoal(g, 'routine')}
                      >
                        {g.title}
                      </button>
                      {o.routine.durationMin != null && <span>· {o.routine.durationMin}m</span>}
                    </div>
                  </div>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.hex }} aria-hidden />
                </div>
              )
            })}
          </div>
        </>
      )}

  {flex.length > 0 && (
    <>
      <div className="mb-1.5 mt-4 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          🗓 Any day this week — do them whenever it suits you
        </h3>
      </div>
      <div className="divide-y divide-border/60">
        {flex.map(({ routine, goal: g, prog }) => {
          const c = goalColor(g.color)
          const doneToday = isRoutineDone(routine, today)
          return (
            <div key={routine.id} className="flex items-center gap-3 py-2.5">
              <button
                type="button"
                aria-label={doneToday ? `Undo "${routine.title}"` : `Log "${routine.title}" for today`}
                onClick={() => checkOff({ goal: g, routine, done: doneToday, date: today })}
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all hover:scale-110',
                  doneToday
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/40 hover:border-primary',
                )}
              >
                {doneToday && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className={cn('text-sm font-medium leading-snug', doneToday && 'text-muted-foreground line-through')}>
                  {routine.title}
                  {routine.optional && (
                    <span
                      className="ml-1.5 rounded-full bg-violet-500/15 px-1.5 py-px align-middle text-[9px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400"
                      title="Extra credit — skipping this never counts against you"
                    >
                      extra
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{g.emoji}</span>
                  <button
                    type="button"
                    className="max-w-40 truncate hover:underline"
                    onClick={() => onOpenGoal(g, 'routine')}
                  >
                    {g.title}
                  </button>
                  {routine.durationMin != null && <span>· {routine.durationMin}m</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1" aria-label={`${prog.done} of ${prog.target} sessions this week`}>
                {Array.from({ length: Math.min(prog.target, 7) }, (_, i) => (
                  <span
                    key={i}
                    className={cn('h-2 w-2 rounded-full', i < prog.done ? 'bg-primary' : 'bg-muted-foreground/25')}
                  />
                ))}
                <span className="ml-1 text-xs tabular-nums text-muted-foreground">
                  {prog.done}/{prog.target}
                </span>
                <span className="ml-1 h-2 w-2 rounded-full" style={{ background: c.hex }} aria-hidden />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )}

      {/* log entry editor — opened from the check-off toast's "Edit" action */}
      <EditLogDialog key={editLog?.logId ?? 'none'} target={editLog} onClose={() => setEditLog(null)} />
    </section>
  )
}

function FocusItem({ goal, onOpen }: { goal: GoalData; onOpen: (g: GoalData, tab?: string) => void }) {
  const stats = computeGoalStats(goal)
  const skillMap = buildSkillMap(goal)
  const c = goalColor(goal.color)
  const unit = goal.unit ?? ''

  let title: string
  let detail: string
  let done = false
  let tab: string | undefined = undefined
  // quick-log affordance, depends on what "working toward" means for this goal
  let quickLog: React.ReactNode = null

  if (stats.status === 'completed') {
    title = 'Goal completed'
    detail = 'Celebrate, then set the next one 🎉'
    done = true
  } else if (skillMap.stats.totalNodes > 0 && skillMap.stats.pace !== 'none') {
    // skill-map goals: point at the next tier
    const nextPath = skillMap.paths.find((p) => p.nextNode)
    const nn = nextPath?.nextNode
    title = nn ? `${nextPath!.path.icon} ${nextPath!.path.title}: ${nn.node.title}` : 'Skill map complete'
    detail = nn
      ? `${formatNumber(nn.node.currentValue)}/${formatNumber(nn.node.targetValue)}${nn.unit ? ` ${nn.unit}` : ''} — advances as you log progress`
      : 'All tiers mastered 🏆'
    tab = 'skills'
    if (nn) {
      quickLog = (
        <NodeQuickAddPopover
          goalId={goal.id}
          nodeId={nn.node.id}
          nodeTitle={nn.node.title}
          unit={nn.unit}
        >
          <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
            <Plus className="h-3.5 w-3.5" /> Log
          </span>
        </NodeQuickAddPopover>
      )
    }
  } else if (goal.type === 'quantitative') {
    if (stats.perDayForWeek && stats.perDayForWeek > 0) {
      title = `Do ~${formatNumber(stats.perDayForWeek)} ${unit} today`
      detail = `${formatNumber(stats.thisWeekRemaining ?? 0)} ${unit} left this week to stay on pace`
    } else if (stats.thisWeekRemaining === 0) {
      title = 'This week is done ✓'
      detail = `Logged ${formatNumber(stats.thisWeekLogged)} ${unit} — you're on pace`
      done = true
    } else {
      title = 'Log your first entry'
      detail = `Aim for ~${formatNumber(stats.requiredPerDay ?? 0)} ${unit}/day`
    }
    quickLog = (
      <QuickLogPopover goal={goal}>
        <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
          <Plus className="h-3.5 w-3.5" /> Log
        </span>
      </QuickLogPopover>
    )
  } else {
    // plan goal
    const parts: string[] = []
    if (stats.nextStep) parts.push(`Next step: ${stats.nextStep.title}`)
    else if (stats.stepsTotal === 0) parts.push('Break this goal into steps')
    else parts.push('All steps done')
    if (goal.weeklyTarget && stats.thisWeekRemaining && stats.thisWeekRemaining > 0) {
      parts.push(`${formatNumber(stats.thisWeekRemaining)} ${unit || 'sessions'} to log this week`)
    }
    title = parts[0]
    detail = parts.slice(1).join(' · ') || 'Open to log a practice session'
    tab = stats.stepsTotal === 0 ? 'steps' : undefined
    if (goal.weeklyTarget) {
      quickLog = (
        <QuickLogPopover goal={goal}>
          <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
            <Plus className="h-3.5 w-3.5" /> Log
          </span>
        </QuickLogPopover>
      )
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(goal, tab)}
      onKeyDown={(e) => {
        // only when the row itself is focused — keydowns from the quick-log
        // popover's inputs bubble here and must not open the goal
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(goal, tab)
        }
      }}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring"
    >
      {done ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
      ) : (
        <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{goal.emoji}</span>
          <span className={cn('text-sm', done ? 'text-muted-foreground' : 'font-medium')}>{title}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      {quickLog}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    </div>
  )
}

/**
 * Everything about today in ONE place, split into the two kinds of work the
 * app tracks — so it's always obvious what to do:
 *
 *   ✅ check off  → concrete things scheduled today (routines)
 *   📈 work toward → ongoing targets that advance as you log progress
 *                   (skill checkpoints / weekly amounts — no checkbox,
 *                    because "done" is reached in steps, not in one tap)
 */
function TodayCard({
  goals,
  onOpen,
  onNewGoal,
}: {
  goals: GoalData[]
  onOpen: (g: GoalData, tab?: string) => void
  onNewGoal: () => void
}) {
  const active = useMemo(
    () => goals.filter((g) => computeGoalStats(g).status !== 'completed'),
    [goals],
  )

  const hasChecklist = goals.some((g) =>
    g.routines.some((r) => {
      if (r.archived) return false
      return occurrencesInRange([r], g.deadline, new Date(), new Date()).length > 0
    }),
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarCheck className="h-4 w-4 text-primary" /> Today
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pb-4">
        <TodayChecklist goals={goals} onOpenGoal={onOpen} />

        {active.length > 0 ? (
          <section aria-label="Ongoing targets">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              📈 Work toward — log progress to advance (no checkbox)
            </h3>
            <div className="divide-y divide-border/60">
              {active.map((goal) => (
                <FocusItem key={goal.id} goal={goal} onOpen={onOpen} />
              ))}
            </div>
          </section>
        ) : (
          !hasChecklist && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {goals.length === 0
                  ? 'Create your first goal to see your daily plan here.'
                  : 'All goals completed — time for a new challenge!'}
              </p>
              <Button onClick={onNewGoal} variant="secondary" size="sm">
                <Target className="h-4 w-4" /> New goal
              </Button>
            </div>
          )
        )}
      </CardContent>
    </Card>
  )
}

export function DashboardTab({
  goals,
  onOpen,
  onNewGoal,
}: {
  goals: GoalData[]
  onOpen: (g: GoalData, tab?: string) => void
  onNewGoal: () => void
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [type, setType] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [showFilters, setShowFilters] = useState(false)

  const statsAll = useMemo(() => goals.map((g) => ({ goal: g, stats: computeGoalStats(g) })), [goals])
  const categories = useMemo(
    () => [...new Set(goals.map((g) => g.category).filter((x): x is string => !!x))].sort(),
    [goals],
  )

  const active = statsAll.filter((s) => s.stats.status !== 'completed')
  const completed = statsAll.filter((s) => s.stats.status === 'completed')
  const onTrack = statsAll.filter((s) => ['ahead', 'on_track'].includes(s.stats.status)).length
  const behind = statsAll.filter((s) => s.stats.status === 'behind').length
  const totalStreak = Math.max(0, ...statsAll.map((s) => s.stats.streakWeeks))

  // routine stats for header summary
  const routineSummary = useMemo(() => {
    let sched = 0
    let done = 0
    for (const g of goals) {
      for (const r of g.routines.filter((x) => !x.archived)) {
        const rs = routineStats(r, g.deadline, 1)
        sched += rs.totalCount
        done += rs.doneCount
      }
    }
    return { sched, done }
  }, [goals])

  const filtered = useMemo(() => {
    let list = [...statsAll]
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (s) =>
          s.goal.title.toLowerCase().includes(q) ||
          (s.goal.category ?? '').toLowerCase().includes(q) ||
          s.goal.description?.toLowerCase().includes(q),
      )
    }
    if (category !== 'all') list = list.filter((s) => s.goal.category === category)
    if (status === 'on_track') list = list.filter((s) => ['ahead', 'on_track'].includes(s.stats.status))
    if (status === 'behind') list = list.filter((s) => s.stats.status === 'behind')
    if (status === 'completed') list = list.filter((s) => s.stats.status === 'completed')
    if (type !== 'all') list = list.filter((s) => s.goal.type === type)

    switch (sort) {
      case 'deadline':
        list.sort((a, b) => {
          const da = a.goal.deadline ? +new Date(a.goal.deadline) : Infinity
          const db = b.goal.deadline ? +new Date(b.goal.deadline) : Infinity
          return da - db
        })
        break
      case 'progress':
        list.sort((a, b) => b.stats.progressPct - a.stats.progressPct)
        break
      case 'name':
        list.sort((a, b) => a.goal.title.localeCompare(b.goal.title))
        break
      default:
        list.sort((a, b) => +new Date(b.goal.createdAt) - +new Date(a.goal.createdAt))
    }
    return list
  }, [statsAll, search, category, status, type, sort])

  const filtersActive = category !== 'all' || status !== 'all' || type !== 'all' || search.trim() !== ''

  const summaryCards = [
    { label: 'Active goals', value: active.length, icon: Target, color: undefined as string | undefined },
    { label: 'On track', value: onTrack, icon: TrendingUp, color: '#10b981' },
    { label: 'Behind pace', value: behind, icon: TrendingDown, color: behind > 0 ? '#f59e0b' : undefined },
    {
      label: 'Routines today',
      value: `${routineSummary.done}/${routineSummary.sched}`,
      icon: Repeat,
      color: routineSummary.sched > 0 && routineSummary.done < routineSummary.sched ? '#14b8a6' : undefined,
    },
    { label: 'Best streak', value: `${totalStreak}w`, icon: Flame, color: totalStreak > 0 ? '#f97316' : undefined },
  ]

  return (
    <div className="space-y-6">
      {/* summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {summaryCards.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}</span>
              <s.icon className="h-4 w-4" style={s.color ? { color: s.color } : undefined} />
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums" style={s.color ? { color: s.color } : undefined}>
              {s.value}
            </div>
          </Card>
        ))}
        <div className="contents sm:hidden" />
        <XpBadge goals={goals} />
      </div>

      {/* Today — one card, two clear kinds of work */}
      <TodayCard goals={goals} onOpen={onOpen} onNewGoal={onNewGoal} />

      {/* search & filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search goals…"
              className="h-9 pl-8"
              aria-label="Search goals"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            variant={showFilters || filtersActive ? 'secondary' : 'outline'}
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => setShowFilters(!showFilters)}
            aria-expanded={showFilters}
          >
            <ListFilter className="h-4 w-4" />
            Filters
            {filtersActive && <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">•</span>}
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showFilters && 'rotate-180')} />
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="sort-goals" className="hidden text-xs text-muted-foreground sm:block">
              Sort
            </label>
            <select
              id="sort-goals"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-9 cursor-pointer rounded-lg border bg-card px-2 text-xs"
              aria-label="Sort goals"
            >
              {Object.entries(SORT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        {showFilters && (
          <div className="space-y-3 rounded-xl border bg-card p-3">
            {/* categories */}
            {categories.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium text-muted-foreground">Category</span>
                <button
                  type="button"
                  onClick={() => setCategory('all')}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    category === 'all' ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary/50',
                  )}
                >
                  All
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(category === cat ? 'all' : cat)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      category === cat ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary/50',
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
            {/* status */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-muted-foreground">Status</span>
              {(['all', 'on_track', 'behind', 'completed'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                    status === s ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary/50',
                  )}
                >
                  {s === 'on_track' ? 'On track' : s}
                </button>
              ))}
            </div>
            {/* type */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-muted-foreground">Type</span>
              {(['all', 'quantitative', 'plan'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    type === t ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary/50',
                  )}
                >
                  {t === 'quantitative' ? 'Target' : t === 'plan' ? 'Plan / skill' : 'All'}
                </button>
              ))}
            </div>
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setCategory('all')
                  setStatus('all')
                  setType('all')
                  setSearch('')
                }}
                className="text-xs font-medium text-primary hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* goal cards */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            Your goals{' '}
            <span className="text-sm font-normal text-muted-foreground">
              ({filtered.length}{filtered.length !== statsAll.length ? ` of ${statsAll.length}` : ''})
            </span>
          </h2>
        </div>
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No goals match these filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map(({ goal }) => (
              <GoalCard key={goal.id} goal={goal} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
