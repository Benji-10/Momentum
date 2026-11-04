import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isPostgresMode } from '@/lib/db'
import {
  consumeRecoveryCode,
  createUserAccount,
  findUserByEmail,
  findUserById,
  gotrueUser,
  issueRecoveryCode,
  refreshResponse,
  tokenResponse,
  verifyAccessToken,
  verifyPassword,
  hashPassword,
} from '@/lib/dev-identity'

/**
 * A tiny GoTrue-compatible identity server, so the preview can use the exact
 * same Netlify-Identity client (gotrue-js) and custom UX as production.
 *
 * Production note: when DATABASE_URL is a Neon connection string this route
 * returns 404 — sign-in then goes through real Netlify Identity at
 * /.netlify/identity.
 */

type Params = { params: Promise<{ path?: string[] }> }

const disabled = () =>
  NextResponse.json({ error: 'not_found', error_description: 'Dev identity is disabled in production' }, { status: 404 })

const bad = (error: string, error_description: string, status = 400) =>
  NextResponse.json({ error, error_description }, { status })

const SETTINGS = {
  autoconfirm: true,
  disable_signup: false,
  external: { bitbucket: false, email: true, facebook: false, github: false, gitlab: false, google: false },
}

function bearerUser(req: Request) {
  const authz = req.headers.get('authorization')
  if (!authz?.startsWith('Bearer ')) return null
  return verifyAccessToken(authz.slice(7).trim())
}

export async function GET(req: Request, { params }: Params) {
  if (isPostgresMode) return disabled()
  const { path } = await params
  const route = (path ?? []).join('/')

  if (route === '' || route === 'settings') {
    return NextResponse.json(SETTINGS)
  }

  if (route === 'user') {
    const claims = bearerUser(req)
    if (!claims) return bad('unauthorized', 'Invalid bearer token', 401)
    const user = await findUserById(claims.sub)
    if (!user) return bad('unauthorized', 'User no longer exists', 401)
    return NextResponse.json(gotrueUser(user))
  }

  return disabled()
}

export async function POST(req: Request, { params }: Params) {
  if (isPostgresMode) return disabled()
  const { path } = await params
  const route = (path ?? []).join('/')

  try {
    if (route === 'signup') {
      const body = await req.json().catch(() => ({}))
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const name =
        (
          body.data &&
          (body.data.name ?? body.data.full_name) != null &&
          String(body.data.name ?? body.data.full_name)
        ).trim() || null
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('invalid_email', 'Enter a valid email address')
      if (password.length < 8) return bad('weak_password', 'Password needs at least 8 characters')
      if (password.length > 200) return bad('weak_password', 'That password is too long')
      const existing = await findUserByEmail(email)
      if (existing) return bad('user_exists', 'That email already has an account — sign in instead')
      const user = await createUserAccount(email, password, name)
      return NextResponse.json(gotrueUser(user))
    }

    if (route === 'token') {
      // gotrue-js posts form-urlencoded bodies (both grants)
      const form = new URLSearchParams(await req.text())
      const grant = form.get('grant_type')
      if (grant === 'password') {
        const email = (form.get('username') ?? '').trim().toLowerCase()
        const password = form.get('password') ?? ''
        const user = await findUserByEmail(email)
        if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
          return bad('invalid_grant', 'Invalid email or password')
        }
        return NextResponse.json(tokenResponse(user))
      }
      if (grant === 'refresh_token') {
        const refreshed = refreshResponse(form.get('refresh_token') ?? '')
        if (!refreshed) return bad('invalid_grant', 'Invalid or expired refresh token')
        return NextResponse.json(refreshed)
      }
      return bad('unsupported_grant_type', 'Only password and refresh_token grants are supported')
    }

    if (route === 'logout') {
      return NextResponse.json({})
    }

    if (route === 'recover') {
      const body = await req.json().catch(() => ({}))
      const email = String(body.email ?? '').trim().toLowerCase()
      const user = await findUserByEmail(email)
      // preview stand-in for the recovery email: hand the code straight back
      // (production emails a link instead — that flow runs on Netlify)
      if (user) {
        const dev_code = issueRecoveryCode(user.id)
        return NextResponse.json({ dev_code })
      }
      return NextResponse.json({ ok: true }) // don't reveal which emails exist
    }

    if (route === 'verify') {
      const body = await req.json().catch(() => ({}))
      const token = String(body.token ?? '')
      const type = String(body.type ?? '')
      if (type !== 'recovery') return bad('invalid_type', 'Only recovery tokens are used here')
      const userId = consumeRecoveryCode(token)
      if (!userId) return bad('invalid_token', 'That recovery code is wrong or has expired')
      const user = await findUserById(userId)
      if (!user) return bad('invalid_token', 'That account no longer exists')
      return NextResponse.json(tokenResponse(user))
    }

    return disabled()
  } catch (e) {
    console.error('POST /api/dev-identity failed', e)
    return bad('server_error', 'Something went wrong, please try again', 500)
  }
}

export async function PUT(req: Request, { params }: Params) {
  if (isPostgresMode) return disabled()
  const { path } = await params
  const route = (path ?? []).join('/')

  if (route !== 'user') return disabled()

  const claims = bearerUser(req)
  if (!claims) return bad('unauthorized', 'Invalid bearer token', 401)

  try {
    const body = await req.json().catch(() => ({}))
    const data: { name?: string | null; email?: string; passwordHash?: string } = {}

    if (body.data && typeof body.data === 'object') {
      const name = String((body.data.name ?? body.data.full_name) ?? '').trim()
      data.name = name || null
    }
    if (typeof body.email === 'string' && body.email.trim()) {
      data.email = body.email.trim().toLowerCase()
    }
    if (typeof body.password === 'string' && body.password) {
      if (body.password.length < 8) return bad('weak_password', 'Password needs at least 8 characters')
      data.passwordHash = await hashPassword(body.password)
    }

    const user = await db.user.update({ where: { id: claims.sub }, data, select: { id: true, email: true, name: true } })
    return NextResponse.json(gotrueUser(user))
  } catch (e) {
    console.error('PUT /api/dev-identity/user failed', e)
    return bad('server_error', 'Could not update your profile', 500)
  }
}
