'use client'

import { CalendarDays, ChevronRight, ListChecks, Map as MapIcon, Plus, Repeat, Target } from 'lucide-react'
import type { GoalData } from '@/lib/types'
import { computeGoalStats, formatNumber } from '@/lib/goal-math'
import { buildSkillMap } from '@/lib/skill-tree'
import { goalColor } from '@/lib/goal-colors'
import { Card } from '@/components/ui/card'
import { StatusBadge, ProgressRing, Chip } from '@/components/app/goal-visuals'
import { QuickLogPopover } from '@/components/app/quick-log'

export function GoalCard({
  goal,
  onOpen,
}: {
  goal: GoalData
  onOpen: (g: GoalData, tab?: string) => void
}) {
  const stats = computeGoalStats(goal)
  const skillMap = buildSkillMap(goal)
  const color = goalColor(goal.color)
  const unit = goal.unit ?? ''

  const statusBadge = <StatusBadge status={stats.status} />

  const weekRequired = goal.type === 'quantitative' ? stats.idealWeeklyPace : goal.weeklyTarget
  const weekPct =
    weekRequired && weekRequired > 0
      ? Math.min(100, (stats.thisWeekLogged / weekRequired) * 100)
      : stats.thisWeekLogged > 0
        ? 100
        : 0

  const activeRoutines = goal.routines.filter((r) => !r.archived).length

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Open goal ${goal.title}`}
      onClick={() => onOpen(goal)}
      onKeyDown={(e) => {
        // only when the card itself is focused — keydowns from child inputs
        // and portaled popovers bubble here and must not open the goal
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(goal)
        }
      }}
      className="group cursor-pointer p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-ring"
      style={{ borderTop: `3px solid ${color.hex}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
            style={{ background: color.soft }}
          >
            {goal.emoji}
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-semibold leading-tight">{goal.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Chip>
                {goal.type === 'quantitative' ? (
                  <>
                    <Target className="h-3 w-3" /> Target
                  </>
                ) : (
                  <>
                    <ListChecks className="h-3 w-3" /> Plan
                  </>
                )}
              </Chip>
              {goal.category && <Chip>{goal.category}</Chip>}
              {stats.daysLeft != null && (
                <Chip>
                  <CalendarDays className="h-3 w-3" />
                  {stats.status === 'completed' ? 'done' : `${stats.daysLeft}d left`}
                </Chip>
              )}
              {stats.streakWeeks > 1 && <Chip>🔥 {stats.streakWeeks}w streak</Chip>}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1.5">
            {stats.status !== 'completed' && (
              <QuickLogPopover goal={goal}>
                <button
                  type="button"
                  aria-label={`Quick log progress for ${goal.title}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border bg-background text-muted-foreground opacity-0 shadow-sm transition-all hover:border-primary/50 hover:text-primary focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </QuickLogPopover>
            )}
            <ProgressRing pct={stats.progressPct} color={goal.color} size={52} />
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>

      <div className="mt-4">{statusBadge}</div>

      {/* main metric line */}
      {goal.type === 'quantitative' && stats.targetValue != null ? (
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            {formatNumber(stats.currentValue)} / {formatNumber(stats.targetValue)} {unit}
          </span>
          {stats.requiredPerWeek != null && stats.requiredPerWeek > 0 ? (
            <> · need ~{formatNumber(stats.requiredPerWeek)} {unit}/week</>
          ) : null}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">
            {skillMap.stats.totalNodes > 0
              ? `${skillMap.stats.mastered}/${skillMap.stats.totalNodes} skill tiers`
              : `${stats.stepsDone}/${stats.stepsTotal} steps done`}
          </span>
          {skillMap.stats.totalNodes > 0 ? (
            <> · ⚡ {skillMap.stats.xpEarned} XP</>
          ) : stats.nextStep ? (
            <> · next: <span className="italic">{stats.nextStep.title}</span></>
          ) : null}
        </p>
      )}

      {/* skill map mini row */}
      {skillMap.stats.totalNodes > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(goal, 'skills')
          }}
          className="mt-2.5 flex w-full items-center gap-2 rounded-lg border border-border/70 bg-muted/20 p-2 text-left transition-colors hover:border-primary/40"
          aria-label="Open skill map"
        >
          <MapIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {skillMap.paths.slice(0, 5).map((p) => (
              <div key={p.path.id} className="flex min-w-0 flex-1 flex-col gap-1" title={`${p.path.title}: ${p.progressPct}%`}>
                <span className="truncate text-[9px] font-medium text-muted-foreground">{p.path.title}</span>
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${p.progressPct}%`, background: color.hex }} />
                </div>
              </div>
            ))}
          </div>
          <span className="shrink-0 text-[10px] font-bold tabular-nums" style={{ color: color.hex }}>
            {skillMap.stats.progressPct}%
          </span>
        </button>
      )}

      {/* this week */}
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            This week
            {activeRoutines > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-secondary px-1 py-px text-[10px]">
                <Repeat className="h-2.5 w-2.5" /> {activeRoutines}
              </span>
            )}
          </span>
          <span className="tabular-nums">
            {formatNumber(stats.thisWeekLogged)}
            {weekRequired ? ` / ${formatNumber(weekRequired)}` : ''} {unit}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${weekPct}%`, background: color.hex }}
          />
        </div>
      </div>
    </Card>
  )
}
