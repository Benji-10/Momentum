'use client'

import { currentIdentityUser } from './identity-client'

/**
 * The one fetch wrapper every API call goes through: it attaches the Netlify
 * Identity access token (refreshing it first if it's near expiry) and turns
 * API errors into readable messages.
 */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const user = await currentIdentityUser()
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

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

  const res = await fetch(url, { ...init, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // a stale/signed-out session: drop it so the app shows the sign-in gate
    if (res.status === 401 && user) {
      try {
        user.clearSession()
      } catch {
        /* ignore */
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
