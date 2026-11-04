'use client'

import { goalColor, TRACK_STATUS_META } from '@/lib/goal-colors'
import type { TrackStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

export function StatusBadge({ status, className }: { status: TrackStatus; className?: string }) {
  const meta = TRACK_STATUS_META[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        meta.className,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.hex }} />
      {meta.label}
    </span>
  )
}

export function ProgressRing({
  pct,
  color,
  size = 56,
  strokeWidth = 5,
  children,
}: {
  pct: number // 0..100
  color: string // goal color key
  size?: number
  strokeWidth?: number
  children?: React.ReactNode
}) {
  const c = goalColor(color)
  const r = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  const offset = circ - (clamped / 100) * circ
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke={c.hex}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center text-xs font-semibold"
        style={{ color: c.hex }}
      >
        {children ?? `${Math.round(clamped)}%`}
      </div>
    </div>
  )
}

export function ProgressBar({
  pct,
  color,
  className,
}: {
  pct: number
  color: string
  className?: string
}) {
  const c = goalColor(color)
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${clamped}%`, background: c.hex }}
      />
    </div>
  )
}

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  accent?: string
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums" style={accent ? { color: accent } : undefined}>
          {value}
        </span>
      </div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  )
}
