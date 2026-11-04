'use client'

import { useState } from 'react'
import { CalendarDays, Compass, Gamepad2, Minus, Plus, TrendingDown, TrendingUp, Zap } from 'lucide-react'
import type { GoalData } from '@/lib/types'
import { buildSkillMap } from '@/lib/skill-tree'
import { formatDateShort } from '@/lib/goal-math'
import { goalColor } from '@/lib/goal-colors'
import { Button } from '@/components/ui/button'
import { QuestMap } from '@/components/app/quest-map'
import { cn } from '@/lib/utils'

function PaceChip({ goal }: { goal: GoalData }) {
  const map = buildSkillMap(goal)
  const s = map.stats
  if (s.pace === 'none' || s.totalNodes === 0) return null
  const meta = {
    ahead: { label: 'Ahead of pace', icon: TrendingUp, cls: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
    on_track: { label: 'On pace', icon: Minus, cls: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-500/10' },
    behind: {
      label: 'Room to grow',
      icon: TrendingDown,
      cls: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500/10',
    },
  }[s.pace]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.bg} ${meta.cls}`}>
      <meta.icon className="h-3 w-3" />
      {meta.label}
    </span>
  )
}

export function RoadmapTab({
  goals,
  onOpenGoal,
  onNewGoal,
}: {
  goals: GoalData[]
  onOpenGoal: (g: GoalData, tab?: string) => void
  onNewGoal?: () => void
}) {
  const withPaths = goals.filter((g) => g.skillPaths.length > 0)
  const withoutPaths = goals.filter((g) => g.skillPaths.length === 0)
  const [selectedId, setSelectedId] = useState<string | null>(withPaths[0]?.id ?? null)

  const goal = withPaths.find((g) => g.id === selectedId) ?? withPaths[0] ?? null

  return (
    <div className="space-y-4">
      {/* goal picker */}
      {withPaths.length > 0 && (
        <div className="nice-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {withPaths.map((g) => {
            const s = buildSkillMap(g).stats
            const c = goalColor(g.color)
            const selected = g.id === goal?.id
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelectedId(g.id)}
                aria-pressed={selected}
                title={g.title}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all',
                  selected ? 'border-transparent shadow-md' : 'border-border bg-card hover:border-muted-foreground/30',
                )}
                style={selected ? { background: c.soft, borderColor: c.hex } : undefined}
              >
                <span className="text-lg leading-none">{g.emoji}</span>
                <span className="min-w-0">
                  <span className="block max-w-44 truncate text-sm font-semibold leading-tight">{g.title}</span>
                  <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground">
                    {s.mastered}/{s.totalNodes} cleared · {s.progressPct}%
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* the quest map */}
      {goal ? (
        <>
          <div className="rounded-xl border bg-card p-3">
            <div className="flex items-center gap-2.5">
              <span className="shrink-0 text-xl leading-none">{goal.emoji}</span>
              <h3 className="min-w-0 flex-1 truncate text-sm font-bold leading-tight">{goal.title}</h3>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => onOpenGoal(goal, 'skills')}>
                Details
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
              {goal.deadline && (
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3 shrink-0" />
                  {formatDateShort(new Date(goal.deadline))}
                </span>
              )}
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Zap className="h-3 w-3 shrink-0 text-amber-500" />
                {buildSkillMap(goal).stats.xpEarned} XP earned
              </span>
              <PaceChip goal={goal} />
            </div>
          </div>

          <QuestMap goal={goal} />

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Gamepad2 className="mt-px h-3.5 w-3.5 shrink-0" />
            Tap a checkpoint to log progress — clearing it sprouts the path to the next one, and sub-checkpoints (★)
            pop out along the way. Curious what&rsquo;s ahead? Use the eye toggle on the map.
          </p>
        </>
      ) : (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <Gamepad2 className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-2 text-sm font-medium">No skill maps yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Create a goal with skill paths — or import a roadmap JSON with checkpoints and sub-checkpoints — and it
            becomes a playable quest map here.
          </p>
          {onNewGoal && (
            <Button size="sm" className="mt-3" onClick={onNewGoal}>
              Create a goal
            </Button>
          )}
        </div>
      )}

      {/* goals without a skill map */}
      {withoutPaths.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Goals without a skill map</h3>
          {withoutPaths.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onOpenGoal(g, 'skills')}
              className="flex w-full items-center gap-3 rounded-xl border border-dashed p-3 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
            >
              <span className="text-lg">{g.emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{g.title}</div>
                <div className="text-xs text-muted-foreground">
                  {g.type === 'quantitative' ? 'Target goal' : 'Plan goal'} · add paths to grow a quest map
                </div>
              </div>
              <Compass className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
