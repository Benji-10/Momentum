import { isValidTimezone } from './app-time'

/**
 * Per-account app settings, synced to the signed-in user's row and shared by
 * every device: the theme to apply on load and the timezone "today" is based
 * on. Stored as a JSON string in User.settings; `null` fields mean "not set
 * yet" and fall back to the app default (device clock / paper theme).
 */
export interface UserSettings {
  /** theme key (THEME_KEYS in providers.tsx) or null = not chosen yet */
  theme: string | null
  /** IANA timezone, or null = automatic (each device follows its own clock) */
  timezone: string | null
}

export const DEFAULT_SETTINGS: UserSettings = { theme: null, timezone: null }

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
  const theme =
    typeof o.theme === 'string' && o.theme.trim() && o.theme.length <= 40 ? o.theme.trim() : null
  let timezone: string | null = null
  if (typeof o.timezone === 'string' && o.timezone.trim() && o.timezone.length <= 64) {
    const tz = o.timezone.trim()
    timezone = isValidTimezone(tz) ? tz : null
  }
  return { theme, timezone }
}

/** Serialize settings for storage in the User.settings column. */
export function serializeSettings(s: UserSettings): string {
  return JSON.stringify(s)
}
