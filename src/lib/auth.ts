import { headers } from 'next/headers'
import { db, ensureDbReady, isPostgresMode } from './db'
import { verifyAccessToken } from './dev-identity'

/**
 * Authentication = Netlify Identity (GoTrue).
 *
 * The browser signs in with gotrue-js (custom UX, no default identity
 * widget) and attaches the identity JWT to every API call as
 * `Authorization: Bearer …`. This module verifies that token:
 *
 *  - preview / local dev: the token was issued by our GoTrue-compatible
 *    shim (/api/dev-identity) — verified locally with its signing key.
 *  - production on Netlify: the token was issued by real Netlify Identity —
 *    we verify it by asking the identity service's /user endpoint, which
 *    validates the signature and expiry for us.
 */

export interface SessionUser {
  id: string
  email: string
  name: string | null
}

/** Validate a Netlify Identity JWT; returns the identity user or null. */
async function verifyIdentityToken(token: string): Promise<SessionUser | null> {
  if (!isPostgresMode) {
    // preview: shim-issued token
    const claims = verifyAccessToken(token)
    if (claims) {
      const row = await db.user.findUnique({ where: { id: claims.sub }, select: { id: true, email: true, name: true } })
      if (row) return row
    }
    // fall through: maybe the preview is pointed at production data and a
    // real Netlify Identity token was pasted — let the /user check try
  }

  // production: ask Netlify Identity to validate the JWT
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
    if (!host) return null
    const proto = h.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https')
    const res = await fetch(`${proto}://${host}/.netlify/identity/user`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const u = (await res.json()) as {
      id: string
      email: string
      user_metadata?: { full_name?: string; name?: string }
    }
    if (!u?.id || !u?.email) return null
    const name = u.user_metadata?.full_name ?? u.user_metadata?.name ?? null
    return { id: u.id, email: u.email, name: typeof name === 'string' && name.trim() ? name.trim() : null }
  } catch {
    return null
  }
}

/**
 * Make sure the identity user has an app row (and, on a brand-new account,
 * adopt any unclaimed goals so nothing built before signing in is lost).
 */
async function syncUser(user: SessionUser): Promise<SessionUser> {
  let existing = await db.user.findUnique({ where: { id: user.id }, select: { id: true, email: true, name: true } })
  if (!existing) {
    try {
      await db.user.create({ data: { id: user.id, email: user.email, name: user.name } })
      existing = { id: user.id, email: user.email, name: user.name }
    } catch {
      // extremely unlikely (email collision across identity systems) —
      // still let them in as a verified identity user
      console.error('syncUser: could not create the app row for', user.id)
      existing = { id: user.id, email: user.email, name: user.name }
    }
  }

  // Adoption: an account that owns nothing yet claims any unclaimed active
  // goals. The row may have existed for a while already (the preview shim
  // creates it at *signup*, Netlify Identity at first API call), so the
  // trigger is "owns no goals", not "row just created" — that way the
  // behaviour is identical in the preview and in production, and a second
  // account finds nothing left to claim.
  const owned = await db.goal.count({ where: { userId: user.id } })
  if (owned === 0) {
    await db.goal.updateMany({ where: { userId: null, status: 'active' }, data: { userId: user.id } })
  }

  if (existing.email !== user.email || (user.name && existing.name !== user.name)) {
    await db.user
      .update({
        where: { id: user.id },
        data: { email: user.email, ...(user.name ? { name: user.name } : {}) },
      })
      .catch(() => undefined)
  }
  return { id: existing.id, email: user.email, name: user.name ?? existing.name }
}

/** Guard for API routes: returns the signed-in user or a 401 Response. */
export async function requireUser(): Promise<{ user: SessionUser } | { error: Response }> {
  await ensureDbReady()
  const authz = (await headers()).get('authorization')
  const token = authz?.startsWith('Bearer ') ? authz.slice(7).trim() : ''
  if (!token) {
    return {
      error: Response.json(
        { error: 'Please sign in to access your goals' },
        { status: 401 },
      ),
    }
  }
  const identity = await verifyIdentityToken(token)
  if (!identity) {
    return {
      error: Response.json({ error: 'Your sign-in has expired — please sign in again' }, { status: 401 }),
    }
  }
  return { user: await syncUser(identity) }
}
