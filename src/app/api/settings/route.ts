import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { isValidTimezone } from '@/lib/app-time'
import { normalizeSettings, serializeSettings } from '@/lib/settings'

/**
 * GET /api/settings — the signed-in user's app settings (theme + timezone).
 * PUT /api/settings — merge a partial update and save it to the account, so
 * every device agrees. Setting a field to null clears it ("automatic").
 */

const patchSchema = z.object({
  /** theme key, or null = not chosen (app default) */
  theme: z.string().min(1).max(40).nullable().optional(),
  /** IANA timezone, or null = follow each device's own clock */
  timezone: z
    .string()
    .min(1)
    .max(64)
    .nullable()
    .optional()
    .refine((v) => v == null || isValidTimezone(v), { message: 'Unknown timezone' }),
})

export async function GET() {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  const settings = normalizeSettings(auth.user.settings)
  return NextResponse.json({ settings })
}

export async function PUT(req: Request) {
  const auth = await requireUser()
  if ('error' in auth) return auth.error
  try {
    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid settings payload', details: parsed.error.issues }, { status: 400 })
    }
    const patch = parsed.data
    const current = normalizeSettings(auth.user.settings)
    const next = {
      theme: 'theme' in patch ? (patch.theme ?? null) : current.theme,
      timezone: 'timezone' in patch ? (patch.timezone ?? null) : current.timezone,
    }
    await db.user.update({
      where: { id: auth.user.id },
      data: { settings: serializeSettings(next) },
    })
    return NextResponse.json({ settings: next })
  } catch (e) {
    console.error('PUT /api/settings failed', e)
    return NextResponse.json({ error: 'Could not save your settings' }, { status: 500 })
  }
}
