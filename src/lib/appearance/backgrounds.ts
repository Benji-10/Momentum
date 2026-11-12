// ---------------------------------------------------------------------------
// Background library — catalog + per-background setting schemas.
//
// Backgrounds are chosen independently of the colour palette and rendered in
// a fixed layer behind the app (components/app/appearance/BackgroundLayer).
//
// Three categories:
//   animated  canvas scenes with continuous (pausable) motion
//   static    procedural SVG / canvas art, generated once per settings change
//   image     image-style scenes — Mineral is a real photograph shipped with
//             the app; the rest are rendered locally. Plus the user's upload.
//
// Each definition declares exactly the settings that make sense for it; the
// settings UI renders only those ("Only expose settings relevant to the
// selected background").
// ---------------------------------------------------------------------------

import type { BackgroundConfig } from './types'
import { clampNumber, pickString } from './types'

export type BackgroundCategory = 'animated' | 'static' | 'image'

export type SettingControl =
  | { kind: 'slider'; key: string; label: string; min: number; max: number; step?: number; suffix?: string; default: number }
  | { kind: 'fit'; key: string; label: string; default: string }
  | { kind: 'position'; key: string; label: string; default: string }
  | { kind: 'tint'; key: string; label: string; default: string }

export interface BackgroundDef {
  id: string
  name: string
  category: BackgroundCategory
  hint: string
  /** which renderer the BackgroundLayer uses */
  renderer:
    | 'bioluminescence'
    | 'nebula'
    | 'particles'
    | 'fluid'
    | 'topography'
    | 'fractals'
    | 'vapourwave'
    | 'mycelium'
    | 'mineral'
    | 'carbon'
    | 'iridescence'
    | 'custom-image'
  settings: SettingControl[]
}

export const BACKGROUND_FITS = ['cover', 'contain'] as const
export const BACKGROUND_POSITIONS = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top left',
  'top right',
  'bottom left',
  'bottom right',
] as const

const opacity = (def = 80) =>
  ({ kind: 'slider', key: 'opacity', label: 'Opacity', min: 5, max: 100, step: 1, suffix: '%', default: def }) as const
const speed = (def = 100) =>
  ({ kind: 'slider', key: 'speed', label: 'Animation speed', min: 0, max: 200, step: 5, suffix: '%', default: def }) as const
const blur = () =>
  ({ kind: 'slider', key: 'blur', label: 'Blur', min: 0, max: 24, step: 1, suffix: 'px', default: 0 }) as const
const scale = (def = 100) =>
  ({ kind: 'slider', key: 'scale', label: 'Pattern scale', min: 40, max: 220, step: 5, suffix: '%', default: def }) as const

export const BACKGROUNDS: BackgroundDef[] = [
  {
    id: 'bioluminescence',
    name: 'Bioluminescence',
    category: 'animated',
    hint: 'Drifting glowing particles',
    renderer: 'bioluminescence',
    settings: [opacity(85), speed(100), { kind: 'slider', key: 'density', label: 'Particle density', min: 0, max: 100, step: 1, default: 50 }, { kind: 'slider', key: 'glow', label: 'Glow intensity', min: 0, max: 100, step: 1, default: 60 }, blur()],
  },
  {
    id: 'nebula',
    name: 'Nebula',
    category: 'animated',
    hint: 'Layered gradients, very slow drift',
    renderer: 'nebula',
    settings: [opacity(75), speed(100), scale(100), blur()],
  },
  {
    id: 'particle-field',
    name: 'Particle Fields',
    category: 'animated',
    hint: 'Crisp constellation — two-depth drift',
    renderer: 'particles',
    settings: [opacity(70), speed(100), { kind: 'slider', key: 'density', label: 'Particle density', min: 0, max: 100, step: 1, default: 45 }, { kind: 'slider', key: 'connections', label: 'Connecting lines', min: 0, max: 100, step: 1, default: 50 }, blur()],
  },
  {
    id: 'fluid-mechanics',
    name: 'Fluid Mechanics',
    category: 'animated',
    hint: 'Live fluid solver — swirling dye',
    renderer: 'fluid',
    settings: [opacity(80), speed(60), { kind: 'slider', key: 'density', label: 'Dye density', min: 0, max: 100, step: 1, default: 50 }, blur()],
  },
  {
    id: 'topography',
    name: 'Topography',
    category: 'static',
    hint: 'Random peaks, contour rings by steepness',
    renderer: 'topography',
    settings: [opacity(65), { kind: 'slider', key: 'intensity', label: 'Pattern intensity', min: 0, max: 100, step: 1, default: 55 }, scale(100), blur()],
  },
  {
    id: 'fractals',
    name: 'Fractals',
    category: 'static',
    hint: 'Julia set — banded escape contours',
    renderer: 'fractals',
    settings: [opacity(85), { kind: 'slider', key: 'intensity', label: 'Pattern intensity', min: 0, max: 100, step: 1, default: 70 }, scale(100), blur()],
  },
  {
    id: 'vapourwave',
    name: 'Vapourwave',
    category: 'static',
    hint: 'Retro gradients + perspective grid',
    renderer: 'vapourwave',
    settings: [opacity(75), speed(70), blur()],
  },
  {
    id: 'bg-mycelium',
    name: 'Mycelium',
    category: 'image',
    hint: 'Living hyphae — fused loops, spore light',
    renderer: 'mycelium',
    settings: [opacity(75), { kind: 'slider', key: 'density', label: 'Network density', min: 0, max: 100, step: 1, default: 50 }, { kind: 'slider', key: 'glow', label: 'Glow intensity', min: 0, max: 100, step: 1, default: 55 }, scale(100), blur()],
  },
  {
    id: 'mineral',
    name: 'Mineral',
    category: 'image',
    hint: 'Real photograph — dark stone, quiet veining',
    renderer: 'mineral',
    settings: [opacity(80), { kind: 'slider', key: 'scale', label: 'Zoom', min: 100, max: 220, step: 5, suffix: '%', default: 100 }, blur()],
  },
  {
    id: 'carbon',
    name: 'Carbon',
    category: 'image',
    hint: 'Near-black weave — whisper subtle',
    renderer: 'carbon',
    settings: [opacity(60), scale(100), blur()],
  },
  {
    id: 'iridescence',
    name: 'Iridescence',
    category: 'image',
    hint: 'Anodized sheen — restrained colour',
    renderer: 'iridescence',
    settings: [opacity(70), { kind: 'slider', key: 'intensity', label: 'Pattern intensity', min: 0, max: 100, step: 1, default: 60 }, blur()],
  },
]

export const BACKGROUND_IDS = BACKGROUNDS.map((b) => b.id)

export function backgroundDef(id: string): BackgroundDef | undefined {
  return BACKGROUNDS.find((b) => b.id === id)
}

export const BACKGROUND_CATEGORY_LABELS: Record<BackgroundCategory, string> = {
  animated: 'Animated',
  static: 'Static',
  image: 'Image-based',
}

/** Default settings map for a background id. */
export function defaultBackgroundSettings(def: BackgroundDef): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  for (const s of def.settings) out[s.key] = s.default
  return out
}

/** A fresh, fully-defaulted config for a library background. */
export function defaultBackgroundConfig(id: string): BackgroundConfig | null {
  const def = backgroundDef(id)
  if (!def) return null
  return { id, settings: defaultBackgroundSettings(def) }
}

/**
 * Validate a stored background config against the catalog: whitelisted id,
 * only known setting keys, numbers clamped to their slider range, enum-ish
 * strings picked from their allowed values. Returns null for anything
 * unrecognised (→ "no background").
 */
export function normalizeBackgroundConfig(raw: unknown): BackgroundConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string') return null

  if (o.id === 'custom-image') {
    const settings: Record<string, number | string> = {
      opacity: clampNumber(o.settings && (o.settings as Record<string, unknown>).opacity, 5, 100, 100),
      darkness: clampNumber(o.settings && (o.settings as Record<string, unknown>).darkness, 0, 90, 25),
      tintStrength: clampNumber(o.settings && (o.settings as Record<string, unknown>).tintStrength, 0, 80, 0),
      tint: pickString(o.settings && (o.settings as Record<string, unknown>).tint, ['#7c6ee0'], '#7c6ee0'),
      fit: pickString(o.settings && (o.settings as Record<string, unknown>).fit, BACKGROUND_FITS, 'cover'),
      position: pickString(o.settings && (o.settings as Record<string, unknown>).position, BACKGROUND_POSITIONS, 'center'),
      scale: clampNumber(o.settings && (o.settings as Record<string, unknown>).scale, 50, 250, 100),
      blur: clampNumber(o.settings && (o.settings as Record<string, unknown>).blur, 0, 24, 0),
    }
    return { id: 'custom-image', settings }
  }

  const def = backgroundDef(o.id)
  if (!def) return null
  const rawSettings = (o.settings && typeof o.settings === 'object' ? o.settings : {}) as Record<string, unknown>
  const settings: Record<string, number | string> = {}
  for (const s of def.settings) {
    const v = rawSettings[s.key]
    if (s.kind === 'slider') settings[s.key] = clampNumber(v, s.min, s.max, s.default)
    else if (s.kind === 'fit') settings[s.key] = pickString(v, BACKGROUND_FITS, s.default)
    else if (s.kind === 'position') settings[s.key] = pickString(v, BACKGROUND_POSITIONS, s.default)
    else if (s.kind === 'tint') settings[s.key] = pickString(v, ['#7c6ee0', '#10b981', '#f59e0b', '#e11d48', '#38bdf8', '#f8fafc', '#0f172a'], s.default)
  }
  return { id: def.id, settings }
}

/** Numeric setting value helper (sliders are always numbers). */
export function bgNum(config: BackgroundConfig | null, key: string, fallback: number): number {
  if (!config) return fallback
  const v = config.settings[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** String setting value helper (fit / position / tint). */
export function bgStr(config: BackgroundConfig | null, key: string, fallback: string): string {
  if (!config) return fallback
  const v = config.settings[key]
  return typeof v === 'string' ? v : fallback
}
