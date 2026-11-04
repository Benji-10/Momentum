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
  { label: string; hex: string; className: string }
> = {
  completed: {
    label: 'Completed',
    hex: '#10b981',
    className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25',
  },
  ahead: {
    label: 'Ahead of pace',
    hex: '#14b8a6',
    className: 'bg-teal-500/12 text-teal-700 dark:text-teal-400 border border-teal-500/25',
  },
  on_track: {
    label: 'On track',
    hex: '#10b981',
    className: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25',
  },
  behind: {
    label: 'Behind pace',
    hex: '#f59e0b',
    className: 'bg-amber-500/14 text-amber-700 dark:text-amber-400 border border-amber-500/30',
  },
  ended: {
    label: 'Deadline passed',
    hex: '#f43f5e',
    className: 'bg-rose-500/12 text-rose-700 dark:text-rose-400 border border-rose-500/25',
  },
  not_started: {
    label: 'Not started',
    hex: '#78716c',
    className: 'bg-stone-500/10 text-stone-600 dark:text-stone-400 border border-stone-500/25',
  },
}

export const EMOJI_CHOICES = [
  '🎯', '📚', '🎸', '🏃', '🧘', '✍️', '💻', '🎨',
  '🗣️', '💪', '💰', '🌱', '🍳', '📷', '🎹', '🧠',
  '⭐', '🔥', '🚀', '🏔️', '🏊', '⚽', '🥗', '📝',
]
