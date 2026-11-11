'use client'

// ---------------------------------------------------------------------------
// Small building blocks for the appearance settings UI.
// ---------------------------------------------------------------------------

import { useId, useState } from 'react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

/** Section heading with optional trailing action (reset link, etc.). */
export function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</div>
      {action}
    </div>
  )
}

/**
 * A colour row: native colour picker swatch + hexadecimal text input.
 * Partial hex is editable in the text field; the value commits when it
 * becomes a valid #rrggbb.
 */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
}) {
  const [text, setText] = useState(value.toUpperCase())
  // keep the text field in sync when the value changes elsewhere
  // (adjust-state-during-render — no effect needed)
  const [seenProp, setSeenProp] = useState(value)
  if (value !== seenProp) {
    setSeenProp(value)
    setText(value.toUpperCase())
  }

  function commit(raw: string) {
    const t = raw.trim().replace(/^#?/, '#')
    if (/^#[0-9a-fA-F]{6}$/.test(t)) onChange(t.toLowerCase())
    else setText(value.toUpperCase())
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card p-1.5">
      <label
        className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-md border"
        style={{ background: value }}
        title={`${label} — open the colour picker`}
      >
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={`${label} colour picker`}
        />
      </label>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] leading-tight text-muted-foreground">{label}</div>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value.toUpperCase())
            const t = e.target.value.trim()
            if (/^#[0-9a-fA-F]{6}$/.test(t)) onChange(t.toLowerCase())
          }}
          onBlur={(e) => commit(e.target.value)}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label} hexadecimal value`}
          className="h-6 w-full bg-transparent font-mono text-xs uppercase outline-none"
        />
      </div>
    </div>
  )
}

/**
 * A labelled slider that stays responsive while dragging: local state for
 * the drag, the caller's value for truth, commit on release only.
 */
export function BgSlider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onCommit: (v: number) => void
}) {
  const [local, setLocal] = useState(value)
  // follow the committed value when it changes elsewhere (e.g. a reset)
  const [seenProp, setSeenProp] = useState(value)
  if (value !== seenProp) {
    setSeenProp(value)
    setLocal(value)
  }
  const labelId = useId()
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span id={labelId} className="text-xs text-muted-foreground">
          {label}
        </span>
        <span className="text-xs font-semibold tabular-nums">
          {Math.round(local)}
          {suffix}
        </span>
      </div>
      <Slider
        value={[local]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => setLocal(v)}
        onValueCommit={([v]) => onCommit(v)}
        aria-labelledby={labelId}
      />
    </div>
  )
}

/** Compact segmented control (surface treatment, fit…). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }> }[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium transition-colors',
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {o.icon && <o.icon className="h-3.5 w-3.5" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
