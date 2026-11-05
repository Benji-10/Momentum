import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { resetAllProgress, wipeAllData } from '@/lib/danger'

/**
 * POST /api/danger — the destructive actions behind the settings' danger zone.
 * Body: { action: "reset-progress" | "wipe-all", confirm: "RESET" | "WIPE" }.
 * The typed confirmation word is checked server-side too, so a stray click
 * (or a buggy client) can never wipe an account.
 */
export async function POST(req: Request) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: unknown; confirm?: unknown }
    const action = typeof body.action === 'string' ? body.action : ''
    const confirm = typeof body.confirm === 'string' ? body.confirm.trim().toUpperCase() : ''

    if (action === 'reset-progress') {
      if (confirm !== 'RESET') {
        return NextResponse.json({ error: 'Type RESET to confirm' }, { status: 400 })
      }
      const stats = await resetAllProgress(auth.user.id)
      return NextResponse.json({ ok: true, action, stats })
    }

    if (action === 'wipe-all') {
      if (confirm !== 'WIPE') {
        return NextResponse.json({ error: 'Type WIPE to confirm' }, { status: 400 })
      }
      const stats = await wipeAllData(auth.user.id)
      return NextResponse.json({ ok: true, action, stats })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    console.error('POST /api/danger failed', e)
    return NextResponse.json({ error: 'Action failed' }, { status: 500 })
  }
}
