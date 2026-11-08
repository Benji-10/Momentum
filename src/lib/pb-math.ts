import type { PersonalBestData, PbRecordData } from './types'

/**
 * Personal-best math. The PB itself is never stored — it is always derived
 * from the record history, so "higher is better" vs "lower is better" is a
 * pure display/comparison concern. (e.g. PB WPM goes up, a PB BLD solve
 * time goes down.)
 */

/** Is `a` a better result than `b` for this metric's direction? */
export function isBetter(a: number, b: number, direction: 'up' | 'down'): boolean {
  return direction === 'up' ? a > b : a < b
}

/** Records in chronological order (ties keep their insertion order). */
export function sortedRecords(pb: PersonalBestData): PbRecordData[] {
  return [...pb.records].sort((a, b) => +new Date(a.date) - +new Date(b.date))
}

/** The standing personal best: the best-valued record (latest one on ties). */
export function currentPb(pb: PersonalBestData): PbRecordData | null {
  let best: PbRecordData | null = null
  for (const r of pb.records) {
    if (!best || isBetter(r.value, best.value, pb.direction) || r.value === best.value) best = r
  }
  return best
}

/** The PB before the current one — shows the jump ("+12 since last PB"). */
export function previousPb(pb: PersonalBestData): PbRecordData | null {
  const current = currentPb(pb)
  if (!current) return null
  let best: PbRecordData | null = null
  for (const r of pb.records) {
    if (r.id === current.id) continue
    if (!best || isBetter(r.value, best.value, pb.direction) || r.value === best.value) best = r
  }
  return best
}

/** Would `value` set a new PB right now? */
export function beatsPb(pb: PersonalBestData, value: number): boolean {
  const current = currentPb(pb)
  return !current || isBetter(value, current.value, pb.direction)
}

export interface PbSeriesPoint {
  date: number // timestamp
  attempt: number
  /** running best as of this attempt (the "PB over time" line) */
  best: number
}

/** Chart series: every attempt as a dot, plus the running-best step line. */
export function pbSeries(pb: PersonalBestData): PbSeriesPoint[] {
  const out: PbSeriesPoint[] = []
  let best: number | null = null
  for (const r of sortedRecords(pb)) {
    const v = r.value
    if (best == null || isBetter(v, best, pb.direction)) best = v
    out.push({ date: +new Date(r.date), attempt: v, best })
  }
  return out
}

/** Signed delta from the previous PB to the current one (in the metric's unit). */
export function pbDelta(pb: PersonalBestData): number | null {
  const cur = currentPb(pb)
  const prev = previousPb(pb)
  if (!cur || !prev) return null
  return Math.round((cur.value - prev.value) * 100) / 100
}

/** "128 wpm" / "1:42.5" — values stay plain, unit is appended by the UI. */
export function formatPbValue(pb: PersonalBestData): string {
  const cur = currentPb(pb)
  if (!cur) return '—'
  return Number.isInteger(cur.value) ? String(cur.value) : String(Math.round(cur.value * 100) / 100)
}
