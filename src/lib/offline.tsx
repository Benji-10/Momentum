/**
 * Offline support — the app keeps working when the network doesn't.
 *
 * Three pieces:
 *
 *  1. Read cache. Every successful /api/goals fetch is snapshotted to
 *     localStorage, and when a fetch fails because the network is down the
 *     cached snapshot is served instead — the to-do list is always visible.
 *
 *  2. Write queue. Mutations that fail with a network error are appended to
 *     a localStorage queue (url + method + body) and reported to the user as
 *     "saved offline". When the connection returns the queue is replayed
 *     strictly in order, then the goals cache is refreshed.
 *
 *  3. Sync state. A tiny subscribe/notify store (safe for
 *     useSyncExternalStore) exposes {online, pending, syncing, fromCache}
 *     so the header can show a cloud badge and a banner can explain what
 *     the user is looking at.
 *
 * Endpoints that must never silently replay later (danger zone, imports,
 * demo seed) are excluded from the queue and fail normally.
 */

import { CloudOff } from 'lucide-react'
import { toast } from 'sonner'
import { identityToken } from './identity-client'
import { dayKeyOf } from './app-time'
import { parseDayKey } from './routine-math'
import type { GoalData, RoutineDoneData } from './types'
import type { UserSettings } from './settings'

// ---------------------------------------------------------------------------
// error types
// ---------------------------------------------------------------------------

/** Thrown when a mutation was queued for later instead of reaching the
 *  server — the UI should treat it as "saved, will sync", not as a failure. */
export class OfflineQueuedError extends Error {
  constructor() {
    super("You're offline — saved on this device. It will sync when you reconnect.")
    this.name = 'OfflineQueuedError'
  }
}

export function isOfflineQueuedError(e: unknown): boolean {
  return e instanceof OfflineQueuedError
}

/** Is this failure a "can't reach the network" problem (as opposed to the
 *  server answering with an error)? Uses the shapes fetch() throws in
 *  Chromium / Firefox / Safari. */
export function isNetworkError(e: unknown): boolean {
  if (isOfflineQueuedError(e)) return true
  if (e instanceof TypeError) return true
  return (
    e instanceof Error &&
    /failed to fetch|fetch failed|load failed|networkerror|network error|internet connection|offline/i.test(e.message)
  )
}

// ---------------------------------------------------------------------------
// sync state store — useSyncExternalStore-compatible
// ---------------------------------------------------------------------------

export interface SyncSnapshot {
  /** browser reports a network connection */
  online: boolean
  /** queued changes waiting to go out */
  pending: number
  /** a replay pass is running right now */
  syncing: boolean
  /** the goals currently on screen came from the local cache, not the server */
  fromCache: boolean
}

let snapshot: SyncSnapshot = { online: true, pending: 0, syncing: false, fromCache: false }
const listeners = new Set<() => void>()

export function subscribeSync(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getSyncSnapshot(): SyncSnapshot {
  return snapshot
}

function patchSnapshot(patch: Partial<SyncSnapshot>) {
  let changed = false
  for (const k of Object.keys(patch) as (keyof SyncSnapshot)[]) {
    if (snapshot[k] !== patch[k]) changed = true
  }
  if (!changed) return
  snapshot = { ...snapshot, ...patch }
  for (const l of listeners) l()
}

/** The goals view just served (or stopped serving) the cached snapshot. */
export function setServingFromCache(v: boolean) {
  patchSnapshot({ fromCache: v })
}

// ---------------------------------------------------------------------------
// local storage helpers (all guarded — this module is imported during SSR)
// ---------------------------------------------------------------------------

function lsGet(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
  } catch {
    /* private mode / quota — offline features degrade gracefully */
  }
}

function lsRemove(key: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function readJson<T>(key: string): T | null {
  const raw = lsGet(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// goals snapshot cache
// ---------------------------------------------------------------------------

const GOALS_CACHE_KEY = 'momentum:goals-cache'

interface GoalsCache {
  userId: string | null
  savedAt: number
  goals: GoalData[]
}

/** Remember the freshest server data so the list survives a lost connection
 *  (and an offline reload). */
export function saveGoalsCache(goals: GoalData[], userId: string | null) {
  const entry: GoalsCache = { userId, savedAt: Date.now(), goals }
  lsSet(GOALS_CACHE_KEY, JSON.stringify(entry))
}

export function loadGoalsCache(): { goals: GoalData[]; savedAt: number } | null {
  const c = readJson<GoalsCache>(GOALS_CACHE_KEY)
  if (!c || !Array.isArray(c.goals)) return null
  return { goals: c.goals, savedAt: c.savedAt }
}

// ---------------------------------------------------------------------------
// settings cache (theme + timezone — applied while offline)
// ---------------------------------------------------------------------------

const SETTINGS_CACHE_KEY = 'momentum:settings-cache'

export function saveSettingsCache(settings: UserSettings, userId: string | null) {
  lsSet(SETTINGS_CACHE_KEY, JSON.stringify({ userId, savedAt: Date.now(), settings }))
}

export function loadSettingsCache(): UserSettings | null {
  const c = readJson<{ settings: UserSettings }>(SETTINGS_CACHE_KEY)
  return c?.settings ?? null
}

// ---------------------------------------------------------------------------
// mutation queue
// ---------------------------------------------------------------------------

const QUEUE_KEY = 'momentum:sync-queue'
const QUEUE_LOCK_KEY = 'momentum:sync-lock'
const QUEUE_OWNER_KEY = 'momentum:queue-owner'
const MAX_QUEUE = 200
const LOCK_TTL_MS = 45_000

export interface QueuedOp {
  id: string
  url: string
  method: string
  body: string | null
  queuedAt: number
}

/** Endpoints that must never replay silently later: destructive (danger
 *  zone), merge-heavy (imports) or demo-only (seed). They fail with a
 *  normal error toast instead. */
function queueable(url: string): boolean {
  const path = url.split('?')[0]
  if (path === '/api/seed' || path === '/api/import' || path === '/api/export') return false
  if (path.startsWith('/api/danger') || path.startsWith('/api/auth')) return false
  if (path.endsWith('/import')) return false
  if (path.startsWith('/.netlify/') || path.startsWith('/api/dev-identity')) return false
  return true
}

function readQueue(): QueuedOp[] {
  return readJson<QueuedOp[]>(QUEUE_KEY) ?? []
}

function writeQueue(q: QueuedOp[]) {
  lsSet(QUEUE_KEY, JSON.stringify(q))
  patchSnapshot({ pending: q.length })
}

/** Queue a failed mutation for replay. Returns false (and does nothing) for
 *  endpoints excluded above — the caller then reports a plain error. */
export function enqueueOfflineOp(url: string, method: string, body: string | null, userId: string | null): boolean {
  if (!queueable(url)) return false
  let q = readQueue()
  if (q.length >= MAX_QUEUE) {
    // drop the oldest — a queue this size means something is looping; newer
    // actions reflect what the user still wants
    q = q.slice(q.length - MAX_QUEUE + 1)
  }
  const op: QueuedOp = {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    url,
    method,
    body,
    queuedAt: Date.now(),
  }
  q.push(op)
  lsSet(QUEUE_OWNER_KEY, userId ?? '')
  writeQueue(q)
  return true
}

export function pendingOps(): number {
  return readQueue().length
}

/** The queued ops themselves (oldest first) — used to overlay the pending
 *  check-offs onto whatever data the UI is showing. */
export function queuedOps(): QueuedOp[] {
  return readQueue()
}

// ---------------------------------------------------------------------------
// pending-overlay: what the queued check-offs will do to the visible data
// ---------------------------------------------------------------------------

const DONE_URL_RE = /^\/api\/goals\/([^/]+)\/routines\/([^/]+)\/done$/

/**
 * Apply the queued routine check-offs (and undos) to a goals array, so the
 * view matches "what will sync" instead of the last server snapshot.
 *
 * Why: a tick made offline lives in the react-query memory — after an
 * offline *reload* only the last synced snapshot (pre-tick) and the queue
 * survive. Without this overlay the tick would vanish from the list until
 * the connection returns, inviting a confused double-tick.
 *
 * The day of a no-date toggle is resolved from the op's queuedAt stamp (the
 * server computes "today" the same way at replay time). Ops the endpoint
 * will reject (4xx drop) can't be predicted here — replay still owns that.
 */
export function applyQueuedDones(goals: GoalData[], ops: QueuedOp[]): GoalData[] {
  const toggles: { goalId: string; routineId: string; dayKey: string; undo: boolean }[] = []
  for (const op of ops) {
    if (op.method !== 'POST') continue
    const m = DONE_URL_RE.exec(op.url.split('?')[0])
    if (!m) continue
    let body: { date?: string; undo?: boolean } = {}
    if (op.body) {
      try {
        body = JSON.parse(op.body) as { date?: string; undo?: boolean }
      } catch {
        continue
      }
    }
    const dayKey =
      typeof body.date === 'string' && body.date
        ? dayKeyOf(parseDayKey(body.date))
        : dayKeyOf(new Date(op.queuedAt))
    toggles.push({ goalId: m[1], routineId: m[2], dayKey, undo: body.undo === true })
  }
  if (toggles.length === 0) return goals

  let out = goals
  for (const t of toggles) {
    out = out.map((g) => {
      if (g.id !== t.goalId) return g
      return {
        ...g,
        routines: g.routines.map((r) => {
          if (r.id !== t.routineId) return r
          const has = r.dones.some((d) => dayKeyOf(parseDayKey(d.date)) === t.dayKey)
          if (t.undo) return { ...r, dones: r.dones.filter((d) => dayKeyOf(parseDayKey(d.date)) !== t.dayKey) }
          if (has) return r
          const done: RoutineDoneData = {
            id: `queued-${r.id}-${t.dayKey}`,
            routineId: r.id,
            date: t.dayKey,
            creditedValue: null,
            logId: null,
            advancedStepId: null,
          }
          return { ...r, dones: [...r.dones, done] }
        }),
      }
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// replay engine
// ---------------------------------------------------------------------------

let replaying = false
let postReplayHook: (() => void) | null = null

/** Registers the "queue drained — refresh server truth" callback (wired to
 *  the QueryClient in providers.tsx). */
export function onReplayComplete(cb: () => void) {
  postReplayHook = cb
}

function claimLock(): boolean {
  const existing = readJson<{ at: number }>(QUEUE_LOCK_KEY)
  if (existing && Date.now() - existing.at < LOCK_TTL_MS) return false // another tab is on it
  lsSet(QUEUE_LOCK_KEY, JSON.stringify({ at: Date.now() }))
  return true
}

function releaseLock() {
  lsRemove(QUEUE_LOCK_KEY)
}

/** A raw authenticated fetch for replay — deliberately NOT apiFetch, which
 *  would re-queue the op on a second network failure. */
async function replayFetch(op: QueuedOp): Promise<Response> {
  const token = await identityToken()
  const headers = new Headers()
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(op.url, { method: op.method, headers, body: op.body })
}

/**
 * Push every queued change to the server, oldest first. Network failure
 * stops the pass (the op stays queued); a 4xx means the server will never
 * accept that op (e.g. its goal was deleted meanwhile) so it's dropped with
 * a warning. Safe to call repeatedly — a lock keeps two tabs from replaying
 * the same ops, and the done endpoint is idempotent anyway.
 */
export async function replaySyncQueue(): Promise<void> {
  if (replaying) return
  if (typeof window === 'undefined') return
  let q = readQueue()
  if (q.length === 0) return
  if (!claimLock()) return
  replaying = true
  patchSnapshot({ syncing: true })

  let applied = 0
  let dropped = 0
  let droppedWhat: string | null = null

  try {
    while (q.length > 0) {
      const op = q[0]
      try {
        const res = await replayFetch(op)
        if (res.ok) {
          q = q.slice(1)
          applied++
          continue
        }
        if (res.status >= 400 && res.status < 500) {
          // the server considered this change invalid — retrying can't help
          q = q.slice(1)
          dropped++
          droppedWhat = `${op.method} ${op.url}`
          continue
        }
        // 5xx — the server is struggling; try again later
        break
      } catch {
        // network still down — keep everything, try again on the next trigger
        break
      }
    }
  } finally {
    writeQueue(q)
    releaseLock()
    replaying = false
    patchSnapshot({ syncing: false, pending: q.length })
  }

  if (applied > 0) {
    postReplayHook?.()
    toast.success(
      applied === 1 ? 'Offline change synced' : `${applied} offline changes synced`,
      { description: 'Your devices are up to date again.' },
    )
  }
  if (dropped > 0) {
    toast.error(
      dropped === 1 ? "One offline change couldn't be synced" : `${dropped} offline changes couldn't be synced`,
      {
        description: droppedWhat
          ? `The server rejected it (${droppedWhat}) — it was removed from the queue.`
          : 'The server rejected them — they were removed from the queue.',
      },
    )
    postReplayHook?.()
  }
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

let inited = false

/** Wires the online/offline listeners and kicks off a replay if the app is
 *  starting (or waking up) with queued changes. Call once from Providers. */
export function initOffline() {
  if (typeof window === 'undefined' || inited) return
  inited = true

  patchSnapshot({ online: window.navigator.onLine, pending: pendingOps() })

  window.addEventListener('online', () => {
    patchSnapshot({ online: true })
    void replaySyncQueue()
  })
  window.addEventListener('offline', () => patchSnapshot({ online: false }))
  window.addEventListener('focus', () => {
    if (window.navigator.onLine) void replaySyncQueue()
  })

  // changes queued in a previous session that never got out
  if (window.navigator.onLine && pendingOps() > 0) void replaySyncQueue()
}

/**
 * The signed-in user changed (sign-in / sign-out). The queue and caches
 * belong to one account: if the id changed, drop them so user A's pending
 * edits can never replay under user B's session.
 */
export function handleUserSwitch(userId: string | null) {
  const owner = lsGet(QUEUE_OWNER_KEY)
  if (owner !== null && owner !== (userId ?? '')) {
    writeQueue([])
    lsRemove(QUEUE_OWNER_KEY)
    lsRemove(GOALS_CACHE_KEY)
    lsRemove(SETTINGS_CACHE_KEY)
    patchSnapshot({ pending: 0, fromCache: false })
  }
  if (userId) lsSet(QUEUE_OWNER_KEY, userId)
}

/** Wipe all local offline data (used by the danger zone). */
export function clearOfflineData() {
  writeQueue([])
  lsRemove(QUEUE_OWNER_KEY)
  lsRemove(GOALS_CACHE_KEY)
  lsRemove(SETTINGS_CACHE_KEY)
  patchSnapshot({ pending: 0, fromCache: false })
}

// ---------------------------------------------------------------------------
// shared toast behaviour for mutations
// ---------------------------------------------------------------------------

/**
 * The one error reporter mutations should use. A queued-offline change is
 * NOT a failure — it gets a calm "saved offline" toast (apiFetch already
 * queued it) — while everything else reports normally.
 */
export function toastMutationError(e: unknown, what: string) {
  if (isOfflineQueuedError(e)) {
    toast('Saved offline', {
      icon: <CloudOff className="h-4 w-4 text-amber-500" />,
      description: 'No connection right now — this change stays on this device and will sync when you reconnect.',
    })
    return
  }
  toast.error(what, { description: e instanceof Error ? e.message : undefined })
}
