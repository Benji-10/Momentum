'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  Bar,
  BarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { CumulativePoint, WeekBucket } from '@/lib/goal-math'
import { formatDateShort, formatNumber } from '@/lib/goal-math'

function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean
  payload?: Array<{ name?: string; value?: number | string; color?: string; dataKey?: string | number }>
  label?: string | number
  unit?: string | null
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-popover-foreground">
        {typeof label === 'number' ? formatDateShort(new Date(label)) : label}
      </div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-popover-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="capitalize">{p.name}</span>
          <span className="ml-auto font-semibold tabular-nums">
            {formatNumber(Number(p.value ?? 0))}
            {unit ? ` ${unit}` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Cumulative progress vs the ideal on-pace line. */
export function CumulativeChart({
  data,
  color,
  unit,
  targetValue,
}: {
  data: CumulativePoint[]
  color: string
  unit?: string | null
  targetValue: number
}) {
  const chartData = data.map((p) => ({
    date: p.date,
    actual: p.actual,
    ideal: p.ideal,
  }))
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(t: number) => formatDateShort(new Date(t))}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            stroke="var(--border)"
            tickMargin={8}
            minTickGap={40}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            stroke="var(--border)"
            domain={[0, Math.ceil(targetValue * 1.05)]}
            width={52}
          />
          <Tooltip content={<ChartTooltip unit={unit} />} />
          <Line
            type="monotone"
            dataKey="ideal"
            name="On pace"
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            strokeDasharray="5 5"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="stepAfter"
            dataKey="actual"
            name="You"
            stroke={color}
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Weekly logged amounts with the weekly requirement as a reference line. */
export function WeeklyBars({
  data,
  color,
  unit,
  requirement,
  height = 160,
}: {
  data: WeekBucket[]
  color: string
  unit?: string | null
  requirement?: number | null
  height?: number
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            stroke="var(--border)"
            tickMargin={8}
          />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={46} />
          <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: 'var(--accent)', opacity: 0.4 }} />
          {requirement != null && requirement > 0 ? (
            <ReferenceLine
              y={requirement}
              stroke="var(--muted-foreground)"
              strokeDasharray="5 5"
              strokeWidth={1.5}
            />
          ) : null}
          <Bar dataKey="amount" name="Logged" fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
