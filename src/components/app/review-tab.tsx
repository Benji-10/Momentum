'use client'

import { CalendarClock, Flame, Gauge } from 'lucide-react'
import type { GoalData } from '@/lib/types'
import { computeGoalStats, formatNumber, weeklyHistory } from '@/lib/goal-math'
import { goalColor } from '@/lib/goal-colors'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/app/goal-visuals'
import { WeeklyBars } from '@/components/app/charts'

export function ReviewTab({ goals, onOpen }: { goals: GoalData[]; onOpen: (g: GoalData) => void }) {
  if (goals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        Nothing to review yet — create a goal and start logging.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A friendly look at your rhythm — what you actually logged each week, with the dashed line showing your goal&apos;s
        pace. Gaps are just information, not verdicts.
      </p>
      {goals.map((goal) => {
        const stats = computeGoalStats(goal)
        const c = goalColor(goal.color)
        const weekly = weeklyHistory(goal.logs, 8)
        const requirement =
          goal.type === 'quantitative' ? (stats.idealWeeklyPace ?? goal.weeklyTarget) : goal.weeklyTarget
        const weeksMet = weekly.filter(
          (w) => (requirement != null ? w.amount >= requirement * 0.99 : w.amount > 0),
        ).length
        const avg = weekly.reduce((s, w) => s + w.amount, 0) / (weekly.length || 1)

        return (
          <Card
            key={goal.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(goal)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen(goal)
              }
            }}
            className="cursor-pointer p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-lg"
                  style={{ background: c.soft }}
                >
                  {goal.emoji}
                </div>
                <div>
                  <h3 className="font-semibold leading-tight">{goal.title}</h3>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {goal.type === 'quantitative'
                      ? `${formatNumber(stats.currentValue)} / ${formatNumber(stats.targetValue ?? 0)} ${goal.unit ?? ''} · ${stats.progressPct}%`
                      : `${stats.stepsDone}/${stats.stepsTotal} steps · ${stats.progressPct}%`}
                  </div>
                </div>
              </div>
              <StatusBadge status={stats.status} />
            </div>

            <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_260px]">
              <WeeklyBars
                data={weekly}
                color={c.hex}
                unit={goal.unit}
                requirement={requirement}
                height={150}
              />
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2">
                  <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="text-xs">
                    <span className="font-semibold tabular-nums">{formatNumber(Math.round(avg * 10) / 10)}</span>{' '}
                    <span className="text-muted-foreground">
                      avg {goal.unit || 'sessions'}/week (8w)
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2">
                  <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="text-xs">
                    <span className="font-semibold tabular-nums">
                      {weeksMet}/{weekly.length}
                    </span>{' '}
                    <span className="text-muted-foreground">weeks kept pace</span>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2">
                  <Flame className="h-4 w-4 shrink-0 text-orange-500" />
                  <div className="text-xs">
                    <span className="font-semibold tabular-nums">{stats.streakWeeks} week</span>{' '}
                    <span className="text-muted-foreground">current streak</span>
                  </div>
                </div>
                {goal.type === 'quantitative' && stats.projectedFinishDate && goal.deadline && (
                  <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2">
                    <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="text-xs">
                      <span className="text-muted-foreground">projected finish </span>{' '}
                      <span
                        className="font-semibold tabular-nums"
                        style={{
                          color:
                            stats.projectedFinishDate.getTime() <= new Date(goal.deadline).getTime()
                              ? '#10b981'
                              : '#f59e0b',
                        }}
                      >
                        {stats.projectedFinishDate.toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
