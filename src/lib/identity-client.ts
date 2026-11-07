'use client'

import GoTrue, { JSONHTTPError, User } from 'gotrue-js'

/**
 * Netlify Identity on the client — with a fully custom UX (no default
 * identity widget anywhere).
 *
 * In production the gotrue-js client talks to Netlify Identity at
 * /.netlify/identity. In this preview (and local dev) Netlify can't run, so
 * it transparently talks to our GoTrue-compatible shim at /api/dev-identity
 * instead — same protocol, same UX, so what you test here is what ships.
 */

export type IdentityMode = 'netlify' | 'preview' | 'unconfigured'

interface Identity {
  mode: IdentityMode
  auth: GoTrue | null
}

// ---------------------------------------------------------------------------
// Session backup (offline survival)
//
// gotrue-js WIPES its stored session when a token refresh fails — including
// when the failure is just "no network". A second copy under our own key
// lets the app resurrect the session (offline boot, or coming back online
// after the wipe) instead of silently signing the user out.
// The backup is cleared on explicit sign-out and on real 401 rejections, so
// its presence always means "last known good session".
// ---------------------------------------------------------------------------

const GOTRUE_SESSION_KEY = 'gotrue.user'
const BACKUP_KEY = 'momentum:identity-backup'

function readRawSession(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(GOTRUE_SESSION_KEY)
  } catch {
    return null
  }
}

/** The API base the saved session was created against ("/.netlify/identity"
 *  or "/api/dev-identity") — from the live session or the backup. */
function readSavedSessionUrl(): string | null {
  for (const raw of [readRawSession(), safeLocalGet(BACKUP_KEY)]) {
    if (!raw) continue
    try {
      const url = (JSON.parse(raw) as { url?: unknown }).url
      if (typeof url === 'string' && url) return url
    } catch {
      /* corrupt entry — try the next source */
    }
  }
  return null
}

function safeLocalGet(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeLocalSet(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

/** Remember the current session (cheap no-op when nothing changed). */
export function saveIdentityBackup() {
  const raw = readRawSession()
  if (!raw) return
  if (safeLocalGet(BACKUP_KEY) === raw) return
  safeLocalSet(BACKUP_KEY, raw)
}

export function clearIdentityBackup() {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(BACKUP_KEY)
  } catch {
    /* ignore */
  }
}

/** Put the backed-up session back into gotrue's storage. Returns true when
 *  a restore actually happened (no live session existed but a backup did). */
export function restoreIdentityBackup(): boolean {
  if (typeof window === 'undefined') return false
  if (readRawSession()) return false
  const backup = safeLocalGet(BACKUP_KEY)
  if (!backup) return false
  safeLocalSet(GOTRUE_SESSION_KEY, backup)
  return true
}

let initPromise: Promise<Identity> | null = null

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

/** Netlify emails links that log you back in via #recovery_token=… — finish
 *  that flow here so the app boots straight into the signed-in state. */
async function consumeRedirectHash(auth: GoTrue) {
  if (typeof window === 'undefined') return
  const raw = window.location.hash
  if (!raw.includes('token=')) return
  const p = new URLSearchParams(raw.startsWith('#') ? raw.slice(1) : raw)
  const recovery = p.get('recovery_token')
  const confirmation = p.get('confirmation_token')
  if (!recovery && !confirmation) return
  try {
    if (recovery) await auth.recover(recovery, true)
    else if (confirmation) await auth.confirm(confirmation, true)
  } catch (e) {
    console.warn('identity: redirect token no longer valid', e)
  }
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}

/** Resolve (once) which identity backend this deployment uses. */
export function initIdentity(): Promise<Identity> {
  if (!initPromise) {
    initPromise = (async () => {
      if (typeof window === 'undefined') return { mode: 'unconfigured', auth: null }
      if (await probe('/.netlify/identity/settings')) {
        const auth = new GoTrue({ APIUrl: '/.netlify/identity' })
        await consumeRedirectHash(auth)
        return { mode: 'netlify', auth }
      }
      if (await probe('/api/dev-identity/settings')) {
        const auth = new GoTrue({ APIUrl: '/api/dev-identity' })
        await consumeRedirectHash(auth)
        return { mode: 'preview', auth }
      }
      // Both probes failed. Either we're offline (or the network is blocking
      // the probes) or sign-in genuinely isn't configured. If this browser
      // holds a saved session, boot against the API it was created with so
      // the app still works offline; the session token verifies later.
      const savedUrl = readSavedSessionUrl()
      if (savedUrl) {
        const auth = new GoTrue({ APIUrl: savedUrl })
        await consumeRedirectHash(auth)
        return { mode: savedUrl.includes('dev-identity') ? 'preview' : 'netlify', auth }
      }
      // deployed without Netlify Identity enabled (or both probes blocked)
      return { mode: 'unconfigured', auth: null }
    })()
  }
  return initPromise
}

/** Turn gotrue-js wire errors into friendly messages. */
function friendly(e: unknown): Error {
  if (e instanceof JSONHTTPError) {
    const desc = e.json?.error_description ?? e.json?.msg
    if (desc) return new Error(String(desc))
  }
  if (e instanceof Error && e.message && !/^\[object/.test(e.message)) return e
  return new Error('Something went wrong — please try again')
}

export function identityApiBase(mode: IdentityMode): string {
  return mode === 'netlify' ? '/.netlify/identity' : '/api/dev-identity'
}

/** The signed-in gotrue user, if a session exists in this browser. If
 *  gotrue wiped its session during an offline token-refresh, the backup
 *  resurrects it first — so "offline" never turns into "signed out". */
export async function currentIdentityUser(): Promise<User | null> {
  const { auth } = await initIdentity()
  let user = auth?.currentUser() ?? null
  if (!user && auth && restoreIdentityBackup()) {
    user = auth.currentUser() ?? null
  }
  if (user) saveIdentityBackup()
  return user
}

/** A fresh access token (auto-refreshes near expiry), or null. */
export async function identityToken(): Promise<string | null> {
  const user = await currentIdentityUser()
  if (!user) return null
  try {
    return await user.jwt()
  } catch (e) {
    // a token refresh needs the network too — offline that's not a
    // sign-out (the backup in this module resurrects the session once
    // we're back). A genuine auth rejection is handled by the 401 path
    // in apiFetch / the replay loop.
    if (!looksLikeNetworkError(e)) {
      try {
        user.clearSession()
      } catch {
        /* ignore */
      }
    }
    return null
  }
}

/** Local twin of offline.ts's isNetworkError — kept here to avoid a
 *  circular import (offline.ts already imports identityToken). */
function looksLikeNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true
  return (
    e instanceof Error &&
    /failed to fetch|fetch failed|load failed|networkerror|network error|internet connection|offline/i.test(e.message)
  )
}

export async function identityLogin(email: string, password: string): Promise<User> {
  const { auth } = await initIdentity()
  if (!auth) throw new Error('Sign-in is not available on this deployment')
  try {
    return await auth.login(email.trim(), password, true)
  } catch (e) {
    throw friendly(e)
  }
}

export async function identitySignup(email: string, password: string, name?: string): Promise<User> {
  const { auth } = await initIdentity()
  if (!auth) throw new Error('Sign-up is not available on this deployment')
  const clean = name?.trim() || undefined
  try {
    await auth.signup(email.trim(), password, clean ? { name: clean, full_name: clean } : undefined)
    // signup itself doesn't start a session — log straight in (autoconfirm)
    return await auth.login(email.trim(), password, true)
  } catch (e) {
    throw friendly(e)
  }
}

export async function identityLogout(): Promise<void> {
  const { auth } = await initIdentity()
  const user = auth?.currentUser()
  // explicit sign-out: the backup must go too, or the next boot would
  // resurrect a session the user deliberately ended
  clearIdentityBackup()
  if (!user) return
  try {
    await user.logout()
  } catch {
    user.clearSession()
  }
}

/** Update profile (name) and/or password of the signed-in user. */
export async function identityUpdate(attributes: { data?: Record<string, unknown>; password?: string }): Promise<void> {
  const user = await currentIdentityUser()
  if (!user) throw new Error('You need to be signed in')
  try {
    await user.update(attributes)
  } catch (e) {
    throw friendly(e)
  }
}

/**
 * Step 1 of password recovery. In production Netlify emails a sign-in link;
 * in this preview the code comes straight back (no email server here).
 */
export async function requestRecovery(
  email: string,
): Promise<{ mode: IdentityMode; devCode: string | null }> {
  const { mode, auth } = await initIdentity()
  if (!auth) throw new Error('Password recovery is not available on this deployment')
  let devCode: string | null = null
  try {
    const res = await fetch(`${identityApiBase(mode)}/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    })
    if (res.ok) {
      const json = await res.json().catch(() => ({}))
      devCode = typeof json.dev_code === 'string' ? json.dev_code : null
    }
  } catch (e) {
    throw friendly(e)
  }
  return { mode, devCode }
}

/** Step 2 (preview flow): exchange the recovery code for a session and set
 *  a new password. */
export async function completeRecovery(code: string, newPassword: string): Promise<void> {
  const { auth } = await initIdentity()
  if (!auth) throw new Error('Password recovery is not available on this deployment')
  try {
    const user = await auth.recover(code.trim(), true)
    await user.update({ password: newPassword })
  } catch (e) {
    throw friendly(e)
  }
}
