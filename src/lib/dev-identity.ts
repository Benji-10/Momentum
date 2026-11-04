import { createHmac, randomBytes, randomUUID, scrypt as _scrypt, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { db } from './db'

/**
 * A miniature, GoTrue-compatible identity server for local dev and this
 * preview. Netlify Identity can't run outside Netlify, so in the preview the
 * same gotrue-js client talks to /api/dev-identity instead — signup, login,
 * token refresh, password recovery all work end-to-end, and switching to the
 * real thing in production is automatic (the client probes
 * /.netlify/identity/settings first).
 *
 * In production (DATABASE_URL = Neon connection string) the shim is disabled
 * and real Netlify Identity takes over.
 */

const scrypt = promisify(_scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>

const ACCESS_TTL = 3600 // 1h, like GoTrue
const REFRESH_TTL = 60 * 60 * 24 * 30 // 30d, like GoTrue

/** Preview-only signing key. Never used in production: on Netlify the token
 *  check goes through Netlify Identity's own /user endpoint. */
const SECRET = process.env.DEV_IDENTITY_SECRET ?? 'momentum-preview-identity-key'

// ---------------------------------------------------------------------------
// passwords (same scheme the old accounts used — existing preview accounts
// can still sign in)
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64)
  return `${salt}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(':')
  if (!salt || !hex) return false
  const derived = await scrypt(password, salt, 64)
  const expected = Buffer.from(hex, 'hex')
  if (expected.length !== derived.length) return false
  return timingSafeEqual(derived, expected)
}

// ---------------------------------------------------------------------------
// JWT-shaped access / refresh tokens (HS256)
// ---------------------------------------------------------------------------

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlJson(obj: unknown): string {
  return b64url(Buffer.from(JSON.stringify(obj)))
}

function fromB64url(s: string): Buffer {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return Buffer.from(s, 'base64')
}

interface Claims {
  sub: string
  email: string
  typ: 'access' | 'refresh'
  iat: number
  exp: number
}

function sign(claims: Claims): string {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' })
  const payload = b64urlJson(claims)
  const sig = b64url(createHmac('sha256', SECRET).update(`${header}.${payload}`).digest())
  return `${header}.${payload}.${sig}`
}

function verify(token: string, typ: 'access' | 'refresh'): Claims | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, payload, sig] = parts
  const expected = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest()
  const got = fromB64url(sig)
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null
  try {
    const claims = JSON.parse(fromB64url(payload).toString()) as Claims
    if (claims.typ !== typ) return null
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null
    return claims
  } catch {
    return null
  }
}

export function verifyAccessToken(token: string): Claims | null {
  return verify(token, 'access')
}

function verifyRefreshToken(token: string): Claims | null {
  return verify(token, 'refresh')
}

// ---------------------------------------------------------------------------
// user rows + GoTrue response shapes
// ---------------------------------------------------------------------------

type DbUser = { id: string; email: string; name: string | null }

export async function findUserByEmail(
  email: string,
): Promise<(DbUser & { passwordHash: string | null }) | null> {
  const normalized = email.trim().toLowerCase()
  return db.user.findUnique({ where: { email: normalized } }) as Promise<
    (DbUser & { passwordHash: string | null }) | null
  >
}

/** The user JSON GoTrue returns from /signup, /user and inside /token. */
export function gotrueUser(u: DbUser & { passwordHash?: string | null }) {
  return {
    id: u.id,
    aud: '',
    role: '',
    email: u.email,
    confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'email' },
    user_metadata: { name: u.name, full_name: u.name },
    created_at: u.id ? new Date().toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function createUserAccount(email: string, password: string, name: string | null) {
  const normalized = email.trim().toLowerCase()
  const passwordHash = await hashPassword(password)
  return db.user.create({
    data: { id: randomUUID(), email: normalized, passwordHash, name },
    select: { id: true, email: true, name: true },
  })
}

/** Issue a GoTrue-style token response for a user. */
export function tokenResponse(user: DbUser) {
  const now = Math.floor(Date.now() / 1000)
  const access = sign({ sub: user.id, email: user.email, typ: 'access', iat: now, exp: now + ACCESS_TTL })
  const refresh = sign({ sub: user.id, email: user.email, typ: 'refresh', iat: now, exp: now + REFRESH_TTL })
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: ACCESS_TTL,
    refresh_token: refresh,
    user: gotrueUser(user),
  }
}

export function refreshResponse(refreshToken: string): ReturnType<typeof tokenResponse> | null {
  const claims = verifyRefreshToken(refreshToken)
  if (!claims) return null
  return tokenResponse({ id: claims.sub, email: claims.email, name: null })
}

// ---------------------------------------------------------------------------
// password recovery codes (preview only — in production Netlify emails these)
// ---------------------------------------------------------------------------

const recoveryCodes = new Map<string, { userId: string; expires: number }>()

export function issueRecoveryCode(userId: string): string {
  const code = randomBytes(5).toString('hex') // 10 chars
  recoveryCodes.set(code, { userId, expires: Date.now() + 15 * 60_000 })
  // tidy expired codes now and then
  if (recoveryCodes.size > 50) {
    for (const [k, v] of recoveryCodes) if (v.expires < Date.now()) recoveryCodes.delete(k)
  }
  return code
}

export function consumeRecoveryCode(code: string): string | null {
  const entry = recoveryCodes.get(code)
  if (!entry) return null
  recoveryCodes.delete(code)
  if (entry.expires < Date.now()) return null
  return entry.userId
}

export async function findUserById(id: string): Promise<DbUser | null> {
  return db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true } })
}
