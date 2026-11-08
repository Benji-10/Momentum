'use client'

import { currentIdentityUser, clearIdentityBackup } from './identity-client'
import { enqueueOfflineOp, isNetworkError, OfflineQueuedError } from './offline'

/**
 * The one fetch wrapper every API call goes through: it attaches the Netlify
 * Identity access token (refreshing it first if it's near expiry) and turns
 * API errors into readable messages.
 *
 * Offline behaviour: when the network is down, a write that can safely be
 * retried later is queued on this device (see lib/offline.ts) and surfaces
 * as an OfflineQueuedError — the UI shows "saved offline", and the queue
 * drains automatically once the connection returns. Reads just fail; the
 * goals query serves its cached snapshot instead.
 */

/** An API error that carries its HTTP status, so callers can tell a real
 * auth rejection (401) from a server hiccup (5xx / a proxy 404). */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Drop the current session everywhere (gotrue storage + our backup) so the
 * app shows the sign-in gate instead of resurrecting a rejected session. */
function forgetSession(user: Awaited<ReturnType<typeof currentIdentityUser>>): void {
  clearIdentityBackup()
  if (user) {
    try {
      user.clearSession()
    } catch {
      /* ignore */
    }
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const user = await currentIdentityUser()
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  if (user) {
    let token: string | null = null
    try {
      token = await user.jwt()
    } catch {
      // a token refresh needs the network too — offline that's not a sign-out.
      // (gotrue already cleared its session; the backup in identity-client
      // brings it back.) A genuine auth failure is handled by the 401 below.
    }
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  const run = async (h: Headers): Promise<T> => {
    let res: Response
    try {
      res = await fetch(url, { ...init, headers: h })
    } catch (e) {
      // the request never left the device — no connection
      if (isNetworkError(e)) {
        const method = (init?.method ?? 'GET').toUpperCase()
        if (method !== 'GET' && enqueueOfflineOp(url, method, typeof init?.body === 'string' ? init.body : null, user?.id ?? null)) {
          throw new OfflineQueuedError()
        }
        throw new Error("You're offline — this needs a connection. Your saved list is still visible.")
      }
      throw e
    }

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`, res.status)
    }
    return data as T
  }

  try {
    return await run(headers)
  } catch (e) {
    // A 401 can be a stale access token that gotrue still considers valid
    // (e.g. its stored expiry drifted from the server's). Before dropping
    // the session — which signs the user out everywhere — force one token
    // refresh and retry the request a single time. Only a second rejection
    // is a real "this session is gone".
    if (e instanceof ApiError && e.status === 401 && user) {
      let refreshed: string | null = null
      try {
        refreshed = await user.jwt(true) // forceRefresh
      } catch {
        refreshed = null // refresh token rejected too — session is truly gone
      }
      if (refreshed) {
        const retry = new Headers(headers)
        retry.set('Authorization', `Bearer ${refreshed}`)
        try {
          return await run(retry)
        } catch (e2) {
          if (e2 instanceof ApiError && e2.status === 401) {
            forgetSession(user)
          }
          throw e2
        }
      }
      forgetSession(user)
      throw e
    }
    // a 401 with no local session (e.g. the auth check itself) — nothing to
    // refresh, and nothing to forget either
    throw e
  }
}

/** Same as apiFetch, but for file downloads — returns the raw Blob. */
export async function apiBlob(url: string): Promise<Blob> {
  const user = await currentIdentityUser()
  const headers = new Headers()
  if (user) {
    let token: string | null = null
    try {
      token = await user.jwt()
    } catch (e) {
      // offline refresh failure is not a sign-out (same rule as apiFetch)
      if (!isNetworkError(e)) {
        try {
          user.clearSession()
        } catch {
          /* ignore */
        }
      }
    }
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(url, { headers })
  if (!res.ok) {
    throw new ApiError(`Download failed (${res.status})`, res.status)
  }
  return res.blob()
}
