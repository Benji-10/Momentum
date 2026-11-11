import { isValidTimezone } from './app-time'
import { normalizeAppearance, type AppearanceSettings } from './appearance/types'
import { isPaletteKey, migrateThemeKey } from './appearance/palettes'
import { normalizeBackgroundConfig } from './appearance/backgrounds'

/**
 * Per-account app settings, synced to the signed-in user's row and shared by
 * every device: the look of the app (theme / background / surfaces) and the
 * timezone "today" is based on. Stored as a JSON string in User.settings;
 * `null` fields mean "not set yet" and fall back to the app default.
 *
 * `theme` (legacy) is migrated into `appearance.theme` on read; it is still
 * written through for older clients, but `appearance` wins whenever present.
 */
export interface UserSettings {
  /** legacy palette key — superseded by appearance.theme, kept in sync */
  theme: string | null
  /** IANA timezone, or null = automatic (each device follows its own clock) */
  timezone: string | null
  /** colour theme + background + surface treatment (null = defaults) */
  appearance: AppearanceSettings | null
}

export const DEFAULT_SETTINGS: UserSettings = { theme: null, timezone: null, appearance: null }

/** Loose validation + normalization of a stored/parsed settings JSON blob. */
export function normalizeSettings(raw: unknown): UserSettings {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const o = raw as Record<string, unknown>

  // legacy theme key — migrate old names (paper/meadow/blossom/charcoal)
  let theme: string | null = null
  if (typeof o.theme === 'string' && o.theme.trim() && o.theme.length <= 40) {
    theme = migrateThemeKey(o.theme.trim())
  }

  let timezone: string | null = null
  if (typeof o.timezone === 'string' && o.timezone.trim() && o.timezone.length <= 64) {
    const tz = o.timezone.trim()
    timezone = isValidTimezone(tz) ? tz : null
  }

  // appearance: the source of truth for the look; absent → derive from the
  // legacy theme so pre-appearance accounts keep their palette
  let appearance: AppearanceSettings | null = null
  if (o.appearance != null) {
    appearance = normalizeAppearance(o.appearance, isPaletteKey, normalizeBackgroundConfig)
  } else if (theme && isPaletteKey(theme)) {
    appearance = {
      theme,
      custom: null,
      background: null,
      surface: 'solid',
    }
  }

  return { theme, timezone, appearance }
}

/** Serialize settings for storage in the User.settings column. */
export function serializeSettings(s: UserSettings): string {
  return JSON.stringify(s)
}
