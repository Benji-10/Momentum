/**
 * The app's timezone — the one calendar "today" is based on.
 *
 * Every date decision in the app (what's due today, which week is current,
 * "Tomorrow" labels, chart day bucketing) flows through the helpers here and
 * the tz-aware functions in routine-math.ts. Without this module, all of that
 * silently uses the *device's* clock — which is wrong whenever the device's
 * timezone differs from the user's (a laptop still set to London while its
 * owner is in Texas would show "tomorrow's" tasks from mid-afternoon onwards).
 *
 * The app timezone is:
 *  - a specific IANA zone chosen by the user (synced to their account, so
 *    every device agrees), or
 *  - null = "automatic": each device follows its own system clock (default).
 */

/** Module state — set from the user's synced settings after sign-in. */
let appTimezone: string | null = null

/** The device's own IANA zone (best effort; UTC if the runtime refuses). */
export function systemTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz && isValidTimezone(tz) ? tz : 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Is this a usable IANA timezone identifier? */
export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Set the app timezone (null = automatic / follow each device). Invalid zones fall back to automatic. */
export function setAppTimezone(tz: string | null): void {
  const next = tz != null && isValidTimezone(tz) ? tz : null
  if (next !== appTimezone) {
    appTimezone = next
    tzMidnightCache.clear() // canonical days are zone-relative — never reuse another zone's
  }
}

/** The effective app timezone: the chosen zone, or the device's own when automatic. */
export function getAppTimezone(): string {
  return appTimezone ?? systemTimezone()
}

/** What the user's setting actually is (null = automatic). */
export function getConfiguredTimezone(): string | null {
  return appTimezone
}

// ---------------------------------------------------------------------------
// Day keys — calendar days expressed as "YYYY-MM-DD" in a given timezone
// ---------------------------------------------------------------------------

const dayKeyFormatters = new Map<string, Intl.DateTimeFormat>()

function dayKeyFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = dayKeyFormatters.get(tz)
  if (!fmt) {
    // en-CA yields "YYYY-MM-DD" — exactly the wire format
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    dayKeyFormatters.set(tz, fmt)
  }
  return fmt
}

/** Calendar day "YYYY-MM-DD" of an instant, as seen from `tz`. */
export function dayKeyOf(instant: Date, tz: string = getAppTimezone()): string {
  return dayKeyFormatter(tz).format(instant)
}

// ---------------------------------------------------------------------------
// Zoned offsets / wall-clock instants
// ---------------------------------------------------------------------------

const offsetFormatters = new Map<string, Intl.DateTimeFormat>()

function offsetFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = offsetFormatters.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    offsetFormatters.set(tz, fmt)
  }
  return fmt
}

/** The zone's offset (ms east of UTC) in effect at `at`. Second-precision:
 *  the sub-second part of `at` is dropped so offsets are whole seconds and
 *  minute labels render cleanly (never "UTC−0:0.01385"). */
function tzOffsetMs(atMs: number, tz: string): number {
  const at = Math.floor(atMs / 1000) * 1000
  const parts = offsetFormatter(tz).formatToParts(new Date(at))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24, // "24:00" style edge in some runtimes
    get('minute'),
    get('second'),
  )
  return asUtc - at
}

/**
 * The UTC instant of a wall-clock time in `tz` — e.g. 12:00 on 2026-11-05 in
 * America/Chicago. Used when storing a chosen *day* (deadline, back-dated
 * log, routine start) so the stored instant lands on the right calendar day
 * in the user's timezone, not the device's. Iterates twice to absorb DST.
 * Accepts "HH:MM" or "HH:MM:SS".
 */
export function zonedWallTimeToUtc(dayKey: string, hhmmss: string, tz: string = getAppTimezone()): Date {
  const [y, mo, da] = dayKey.split('-').map(Number)
  const parts = hhmmss.split(':').map(Number)
  const hh = parts[0]
  const mi = parts[1] ?? 0
  const ss = parts[2] ?? 0
  if (!y || !mo || !da || hh == null || mi == null) return new Date(NaN)
  const naive = Date.UTC(y, mo - 1, da, hh, mi, ss)
  let ts = naive
  for (let i = 0; i < 3; i++) {
    const cand = naive - tzOffsetMs(ts, tz)
    if (cand === ts) break
    ts = cand
  }
  return new Date(ts)
}

// ---------------------------------------------------------------------------
// Day-key arithmetic (calendar-exact, DST-proof)
// ---------------------------------------------------------------------------

/** Day key n calendar days away from `key` ("2026-11-04" + 3 → "2026-11-07"). */
export function dayKeyAdd(key: string, n: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** Weekday (0 = Sunday) of a day key — the calendar weekday of that date. */
export function dayKeyWeekday(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay()
}

/** Canonical day for a day key: midnight *in the app timezone* (cached). The
 *  cache is cleared whenever the app timezone changes, so canonical days are
 *  always relative to the zone that's actually in effect. */
const tzMidnightCache = new Map<string, Date>()
export function tzMidnight(dayKey: string): Date {
  let d = tzMidnightCache.get(dayKey)
  if (!d) {
    d = zonedWallTimeToUtc(dayKey, '00:00')
    tzMidnightCache.set(dayKey, d)
  }
  return d
}

// ---------------------------------------------------------------------------
// Small shared helpers (day keys + storage instants) used across components
// ---------------------------------------------------------------------------

/** Today's calendar day in the app timezone. */
export function todayDayKey(): string {
  return dayKeyOf(new Date())
}

/** The calendar day N days before today (exact calendar arithmetic, DST-proof). */
export function dayKeyAgo(n: number): string {
  const [y, mo, da] = dayKeyOf(new Date()).split('-').map(Number)
  const anchored = Date.UTC(y, mo - 1, da) // UTC midnight of today's day key
  return new Date(anchored - n * 86_400_000).toISOString().slice(0, 10)
}

/**
 * ISO instant for a picked calendar day at a given wall-clock time in the app
 * timezone — the tz-correct replacement for `new Date(`${day}T12:00:00`)`.
 * Falls back to UTC noon of that day if the zone can't be resolved.
 */
export function isoForDayKey(dayKey: string, hhmm = '12:00'): string {
  const tz = getAppTimezone()
  const d = zonedWallTimeToUtc(dayKey, hhmm, tz)
  return isNaN(d.getTime()) ? new Date(`${dayKey}T${hhmm}:00Z`).toISOString() : d.toISOString()
}

// ---------------------------------------------------------------------------
// Timezone listing + labels (for the settings UI)
// ---------------------------------------------------------------------------

/** Curated fallback for runtimes without Intl.supportedValuesOf (order kept). */
const FALLBACK_TIMEZONES = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver',
  'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Toronto',
  'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Santiago',
  'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'Atlantic/Reykjavik',
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Amsterdam',
  'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Stockholm', 'Europe/Warsaw',
  'Europe/Athens', 'Europe/Helsinki', 'Europe/Istanbul', 'Europe/Moscow', 'Africa/Cairo',
  'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi', 'Asia/Dubai', 'Asia/Tehran',
  'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Shanghai',
  'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Perth',
  'Australia/Adelaide', 'Australia/Sydney', 'Australia/Brisbane', 'Pacific/Auckland',
]

/** All IANA zones the runtime knows (deduped). */
export function listTimezones(): string[] {
  try {
    const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    if (typeof anyIntl.supportedValuesOf === 'function') {
      const zones = anyIntl.supportedValuesOf('timeZone')
      if (Array.isArray(zones) && zones.length > 0) return zones
    }
  } catch {
    /* fall through */
  }
  return FALLBACK_TIMEZONES
}

/** "UTC−6" / "UTC+5:30" — the zone's offset in effect at `at`. */
export function tzOffsetLabel(tz: string, at: Date = new Date()): string {
  const off = tzOffsetMs(at.getTime(), tz)
  const sign = off < 0 ? '\u2212' : '+'
  const abs = Math.abs(off) / 60_000
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}

/** "Wed 5 Nov, 14:32" — wall clock in that zone, for the settings preview. */
export function clockLabel(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at)
}
