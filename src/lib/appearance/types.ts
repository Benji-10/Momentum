// ---------------------------------------------------------------------------
// Appearance system — shared types, defaults and normalization.
//
// The look of the app is split into three independent, individually
// resettable choices:
//
//   theme      one of 14 preset palettes (CSS blocks in globals.css, applied
//              as data-theme on <html>) or 'custom' — a user-assembled palette
//              injected as inline CSS variables
//   background one of 11 library backgrounds (animated / static / image-style)
//              or the user's own uploaded picture — rendered in a fixed layer
//              behind the app, independently of the palette
//   surface    how cards and overlays treat what's behind them
//              (solid / translucent / glass)
//
// Everything lives in UserSettings.appearance (synced to the account, cached
// to localStorage by the settings cache) except uploaded images, which are
// blobs and therefore live in IndexedDB on this device only.
// ---------------------------------------------------------------------------

/** A user-assembled palette: the 11 editable colour roles. Hex strings. */
export interface CustomTheme {
  /** page background */
  background: string
  /** card / popover surface */
  surface: string
  /** secondary + muted surfaces */
  surfaceAlt: string
  /** borders + input borders */
  border: string
  /** main text */
  text: string
  /** muted text */
  textMuted: string
  /** main accent (buttons, links, focus) */
  primary: string
  /** secondary accent (hover surfaces, charts) */
  accent2: string
  success: string
  warning: string
  error: string
}

export type SurfaceTreatment = 'solid' | 'translucent' | 'glass'

export interface BackgroundConfig {
  /** library id or 'custom-image' */
  id: string
  /** per-background settings (sliders / fit / tint), validated against the catalog */
  settings: Record<string, number | string>
}

export interface AppearanceSettings {
  /** palette key (see PALETTES) or 'custom' */
  theme: string
  /** present when theme === 'custom' */
  custom: CustomTheme | null
  /** null = no background layer */
  background: BackgroundConfig | null
  surface: SurfaceTreatment
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'light',
  custom: null,
  background: null,
  surface: 'solid',
}

export const CUSTOM_THEME_KEYS: (keyof CustomTheme)[] = [
  'background',
  'surface',
  'surfaceAlt',
  'border',
  'text',
  'textMuted',
  'primary',
  'accent2',
  'success',
  'warning',
  'error',
]

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function isHexColour(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v)
}

/** Clamp + round a numeric setting into [min, max]. */
export function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100))
}

/** Whitelisted enum-ish string setting (e.g. background fit / position). */
export function pickString(v: unknown, allowed: readonly string[], fallback: string): string {
  return typeof v === 'string' && allowed.includes(v) ? v : fallback
}

/**
 * Validate + normalize a raw appearance blob (server settings JSON, offline
 * cache or an API payload) against the palette and background catalogs.
 * Anything unknown falls back to the default rather than rejecting the blob,
 * so a bad value can never lock a user out of their settings.
 */
export function normalizeAppearance(
  raw: unknown,
  validTheme: (k: string) => boolean,
  normalizeBackground: (bg: unknown) => BackgroundConfig | null,
): AppearanceSettings {
  const base = { ...DEFAULT_APPEARANCE }
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>

  let theme = base.theme
  if (typeof o.theme === 'string' && (validTheme(o.theme) || o.theme === 'custom')) {
    theme = o.theme
  }

  let custom: CustomTheme | null = null
  if (theme === 'custom' && o.custom && typeof o.custom === 'object') {
    const c = o.custom as Record<string, unknown>
    const out: Partial<CustomTheme> = {}
    let validCount = 0
    for (const k of CUSTOM_THEME_KEYS) {
      if (isHexColour(c[k])) {
        out[k] = c[k]
        validCount++
      }
    }
    // a usable custom theme needs every role filled — partial blobs are
    // dropped rather than half-applied
    if (validCount === CUSTOM_THEME_KEYS.length) custom = out as CustomTheme
  }
  if (theme === 'custom' && !custom) theme = base.theme

  const background = normalizeBackground(o.background)

  let surface: SurfaceTreatment = base.surface
  if (o.surface === 'translucent' || o.surface === 'glass') surface = o.surface

  return { theme, custom, background, surface }
}
