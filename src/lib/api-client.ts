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
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const user = await currentIdentityUser()
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  if (user) {
    let token: string | null = null
    try {
      token = await user.jwt()
    } catch (e) {
      // a token refresh needs the network too — offline that's not a sign-out.
      // (gotrue already cleared its session; the backup in identity-client
      // brings it back.) A genuine auth failure is handled by the 401 below.
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

  let res: Response
  try {
    res = await fetch(url, { ...init, headers })
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
    // a stale/signed-out session: drop it (and its backup) so the app shows
    // the sign-in gate instead of resurrecting a rejected session
    if (res.status === 401) {
      clearIdentityBackup()
      if (user) {
        try {
          user.clearSession()
        } catch {
          /* ignore */
        }
      }
    }
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  }
  return data as T
}

/** Same as apiFetch, but for file downloads — returns the raw Blob. */
export async function apiBlob(url: string): Promise<Blob> {
  const user = await currentIdentityUser()
  const headers = new Headers()
  if (user) {
    let token: string | null = null
    try {
      token = await user.jwt()
    } catch {
      try {
        user.clearSession()
      } catch {
        /* ignore */
      }
    }
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(url, { headers })
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`)
  }
  return res.blob()
}
