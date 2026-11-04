import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'

/**
 * GET /api/auth/me — confirm the identity token server-side and get the
 * app user. Called right after sign-in (it also creates the app row and
 * adopts unclaimed goals on a brand-new account) and whenever the app
 * wants to re-check the session.
 */
export async function GET() {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  return NextResponse.json({ user: auth.user })
}
