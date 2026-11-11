import type { TrackStatus } from './types'

export interface GoalColorMeta {
  name: string
  hex: string
  soft: string // light translucent background (works on cards in both themes)
}

/** Goal accent colors. Blue/indigo intentionally excluded per design rules. */
export const GOAL_COLORS: Record<string, GoalColorMeta> = {
  emerald: { name: 'Emerald', hex: '#10b981', soft: 'rgba(16,185,129,0.14)' },
  teal: { name: 'Teal', hex: '#14b8a6', soft: 'rgba(20,184,166,0.14)' },
  amber: { name: 'Amber', hex: '#f59e0b', soft: 'rgba(245,158,11,0.16)' },
  orange: { name: 'Orange', hex: '#f97316', soft: 'rgba(249,115,22,0.14)' },
  rose: { name: 'Rose', hex: '#f43f5e', soft: 'rgba(244,63,94,0.14)' },
  pink: { name: 'Pink', hex: '#ec4899', soft: 'rgba(236,72,153,0.14)' },
  violet: { name: 'Violet', hex: '#8b5cf6', soft: 'rgba(139,92,246,0.14)' },
  lime: { name: 'Lime', hex: '#84cc16', soft: 'rgba(132,204,22,0.16)' },
}

export const GOAL_COLOR_KEYS = Object.keys(GOAL_COLORS)

export function goalColor(key: string | null | undefined): GoalColorMeta {
  return GOAL_COLORS[key ?? 'emerald'] ?? GOAL_COLORS.emerald
}

export const TRACK_STATUS_META: Record<
  TrackStatus,
  { label: string; className: string }
> = {
  completed: {
    label: 'Completed',
    className: 'bg-success/12 text-success border border-success/25',
  },
  ahead: {
    label: 'Ahead of pace',
    className: 'bg-primary/12 text-primary border border-primary/25',
  },
  on_track: {
    label: 'On track',
    className: 'bg-success/12 text-success border border-success/25',
  },
  behind: {
    label: 'Behind pace',
    className: 'bg-warning/12 text-warning border border-warning/30',
  },
  ended: {
    label: 'Deadline passed',
    className: 'bg-destructive/12 text-destructive border border-destructive/25',
  },
  not_started: {
    label: 'Not started',
    className: 'bg-muted-foreground/10 text-muted-foreground border border-muted-foreground/25',
  },
}

export const EMOJI_CHOICES = [
  '🎯', '📚', '🎸', '🏃', '🧘', '✍️', '💻', '🎨',
  '🗣️', '💪', '💰', '🌱', '🍳', '📷', '🎹', '🧠',
  '⭐', '🔥', '🚀', '🏔️', '🏊', '⚽', '🥗', '📝',
]
