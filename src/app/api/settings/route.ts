import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { isValidTimezone } from '@/lib/app-time'
import { normalizeSettings, serializeSettings } from '@/lib/settings'
import { isPaletteKey, migrateThemeKey } from '@/lib/appearance/palettes'
import { normalizeBackgroundConfig } from '@/lib/appearance/backgrounds'
import { normalizeAppearance } from '@/lib/appearance/types'

/**
 * GET /api/settings — the signed-in user's app settings.
 * PUT /api/settings — merge a partial update and save it to the account, so
 * every device agrees. Setting a field to null clears it ("automatic").
 */

const HEX = /^#[0-9a-fA-F]{6}$/

const customThemeSchema = z.object({
  background: z.string().regex(HEX),
  surface: z.string().regex(HEX),
  surfaceAlt: z.string().regex(HEX),
  border: z.string().regex(HEX),
  text: z.string().regex(HEX),
  textMuted: z.string().regex(HEX),
  primary: z.string().regex(HEX),
  accent2: z.string().regex(HEX),
  success: z.string().regex(HEX),
  warning: z.string().regex(HEX),
  error: z.string().regex(HEX),
})

const appearanceSchema = z.object({
  theme: z.string().min(1).max(40),
  custom: customThemeSchema.nullable().optional(),
  background: z
    .object({
      id: z.string().min(1).max(40),
      settings: z.record(z.string().max(40), z.union([z.number().finite(), z.string().max(40)])),
    })
    .nullable()
    .optional(),
  surface: z.enum(['solid', 'translucent', 'glass']).optional(),
})

const patchSchema = z.object({
  /** legacy palette key (migrated), or null = not chosen */
  theme: z.string().min(1).max(40).nullable().optional(),
  /** IANA timezone, or null = follow each device's own clock */
  timezone: z
    .string()
    .min(1)
    .max(64)
    .nullable()
    .optional()
    .refine((v) => v == null || isValidTimezone(v), { message: 'Unknown timezone' }),
  /** full appearance block (theme / background / surface) */
  appearance: appearanceSchema.nullable().optional(),
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

    // appearance: the payload shape is validated by zod, then re-normalized
    // against the catalogs (clamps, whitelists) exactly like on read
    let appearance = current.appearance
    if ('appearance' in patch) {
      appearance = patch.appearance
        ? normalizeAppearance(patch.appearance, isPaletteKey, normalizeBackgroundConfig)
        : null
    }

    // the legacy theme key follows the appearance choice (older clients)
    let theme = current.theme
    if ('theme' in patch && patch.theme != null) theme = migrateThemeKey(patch.theme)
    else if (appearance) theme = appearance.theme === 'custom' ? 'custom' : appearance.theme
    else if ('theme' in patch) theme = patch.theme ?? null

    const next = {
      theme,
      timezone: 'timezone' in patch ? (patch.timezone ?? null) : current.timezone,
      appearance,
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
