'use client'

// ---------------------------------------------------------------------------
// Live previews for the appearance settings UI.
//
// Theme previews need no colour duplication: the palette CSS in globals.css
// matches [data-theme='…'] on ANY element, so each preview card scopes a
// small mock-UI with its own data-theme and the cascade does the rendering.
//
// Background thumbnails reuse the real generators/scenes at thumbnail size —
// animated scenes render a single warm-up frame (no loop).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef } from 'react'
import { Check, ImagePlus } from 'lucide-react'
import type { CustomTheme } from '@/lib/appearance/types'
import { PALETTES, type PaletteMeta } from '@/lib/appearance/palettes'
import { BACKGROUNDS, BACKGROUND_CATEGORY_LABELS, backgroundDef, defaultBackgroundSettings, type BackgroundDef } from '@/lib/appearance/backgrounds'
import { cn } from '@/lib/utils'
import {
  generateCarbon,
  generateFractals,
  generateIridescence,
  generateMineral,
  generateMycelium,
  generateTopography,
} from './generators'
import { NebulaScene, VapourwaveScene } from './animated'
import { makeBioluminescence, makeFluidMechanics, makeParticleField, type SceneFactory, type WarmupSceneFactory } from './scenes'

// ---------------------------------------------------------------------------
// Palette → custom theme (for "start from a preset")
// ---------------------------------------------------------------------------

/** Any CSS colour (hex, rgb, oklch, lab…) → #rrggbb, by rasterizing one
 *  pixel and reading it back — the browser's own colour engine does the
 *  conversion, so every format it supports works. */
export function anyColorToHex(color: string): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#010203'
  ctx.fillStyle = color
  if (String(ctx.fillStyle) === '#010203') return null // unparseable
  ctx.fillRect(0, 0, 1, 1)
  const d = ctx.getImageData(0, 0, 1, 1).data
  return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** Read a preset palette's CSS variables and express them as a CustomTheme. */
export function getPaletteAsCustom(key: string): CustomTheme | null {
  const probe = document.createElement('div')
  probe.setAttribute('data-theme', key)
  probe.style.display = 'none'
  document.body.appendChild(probe)
  try {
    const cs = getComputedStyle(probe)
    const pick = (v: string) => anyColorToHex(cs.getPropertyValue(v).trim())
    const out: CustomTheme = {
      background: pick('--background') ?? '#17171c',
      surface: pick('--card-solid') ?? '#212129',
      surfaceAlt: pick('--secondary') ?? '#2a2a33',
      border: pick('--border') ?? '#34343f',
      text: pick('--foreground') ?? '#ececf1',
      textMuted: pick('--muted-foreground') ?? '#9b9ba6',
      primary: pick('--primary') ?? '#8b7cf6',
      accent2: pick('--chart-2') ?? '#38bdf8',
      success: pick('--success') ?? '#34d399',
      warning: pick('--warning') ?? '#fbbf24',
      error: pick('--destructive') ?? '#f87171',
    }
    // if the browser can't parse oklch via canvas, every pick falls back —
    // treat that as "can't read" rather than silently giving defaults
    if (pick('--background') == null) return null
    return out
  } finally {
    probe.remove()
  }
}

// ---------------------------------------------------------------------------
// Theme preview card — a real mini-UI rendered with the palette's own tokens
// ---------------------------------------------------------------------------

export function ThemePreviewCard({
  meta,
  active,
  onClick,
}: {
  meta: PaletteMeta
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'overflow-hidden rounded-xl border text-left transition-all',
        active ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-muted-foreground/40',
      )}
    >
      {/* scoped palette — globals.css matches [data-theme] on any element */}
      <div data-theme={meta.key} className="relative h-16 w-full bg-background p-2">
        <div className="flex h-full gap-1.5">
          <div className="flex w-1/2 flex-col justify-center gap-1 rounded-md border bg-card p-1.5">
            <div className="h-1.5 w-3/4 rounded-full bg-primary/90" />
            <div className="h-1 w-full rounded-full bg-muted-foreground/30" />
            <div className="h-1 w-2/3 rounded-full bg-muted-foreground/20" />
            <div className="mt-0.5 h-2 w-5 rounded-sm bg-primary" />
          </div>
          <div className="flex w-1/2 flex-col justify-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-primary" />
            <span className="inline-block h-1.5 w-4 rounded-full" style={{ background: 'var(--accent2, var(--primary))' }} />
            <div className="h-1 w-full rounded-full bg-muted-foreground/25" />
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--success)' }} />
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--warning)' }} />
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--destructive)' }} />
            </div>
          </div>
        </div>
        {active && (
          <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="border-t bg-card px-2 py-1.5">
        <div className="truncate text-xs font-semibold">{meta.label}</div>
        <div className="truncate text-[10px] text-muted-foreground">{meta.hint}</div>
      </div>
    </button>
  )
}

/** The Custom card — shows the current custom palette (or a neutral default). */
export function CustomThemeCard({ active, colors, onClick }: { active: boolean; colors: CustomTheme | null; onClick: () => void }) {
  const c = colors
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'overflow-hidden rounded-xl border text-left transition-all',
        active ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-muted-foreground/40',
      )}
    >
      <div className="relative h-16 w-full p-2" style={{ background: c?.background ?? '#17171c' }}>
        <div className="flex h-full gap-1.5">
          <div
            className="flex w-1/2 flex-col justify-center gap-1 rounded-md p-1.5"
            style={{ background: c?.surface ?? '#212129', border: `1px solid ${c?.border ?? '#34343f'}` }}
          >
            <div className="h-1.5 w-3/4 rounded-full" style={{ background: c?.primary ?? '#8b7cf6' }} />
            <div className="h-1 w-full rounded-full" style={{ background: c?.textMuted ?? '#9b9ba6', opacity: 0.5 }} />
            <div className="h-2 w-5 rounded-sm" style={{ background: c?.primary ?? '#8b7cf6' }} />
          </div>
          <div className="flex w-1/2 flex-col justify-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: c?.primary ?? '#8b7cf6' }} />
            <span className="inline-block h-1.5 w-4 rounded-full" style={{ background: c?.accent2 ?? '#38bdf8' }} />
            <div className="h-1 w-full rounded-full" style={{ background: c?.text ?? '#ececf1', opacity: 0.3 }} />
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: c?.success ?? '#34d399' }} />
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: c?.warning ?? '#fbbf24' }} />
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: c?.error ?? '#f87171' }} />
            </div>
          </div>
        </div>
        {active && (
          <span
            className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full"
            style={{ background: c?.primary ?? '#8b7cf6', color: c?.background ?? '#17171c' }}
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="border-t bg-card px-2 py-1.5">
        <div className="truncate text-xs font-semibold">Custom</div>
        <div className="truncate text-[10px] text-muted-foreground">Your own colours</div>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Background thumbnails
// ---------------------------------------------------------------------------

/** One warm-up frame of a canvas scene — no animation loop in thumbnails. */
function CanvasThumb({ make }: { make: SceneFactory }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.clientWidth || 96
    const h = canvas.clientHeight || 56
    canvas.width = w * 2
    canvas.height = h * 2
    ctx.setTransform(2, 0, 0, 2, 0, 0)
    const scene = make(ctx, w, h)
    const warmup = (make as WarmupSceneFactory).warmupFrames ?? 14
    for (let i = 1; i <= Math.min(warmup, 40); i++) scene(i * 0.09)
  }, [make])
  return <canvas ref={ref} className="h-full w-full" aria-hidden />
}

/** Static thumbs always use default settings — generate once per session. */
const thumbUrlCache = new Map<string, string>()
function staticThumbUrl(id: string, make: () => string): string {
  let url = thumbUrlCache.get(id)
  if (!url) {
    url = make()
    thumbUrlCache.set(id, url)
  }
  return url
}

function StaticThumb({ id, make }: { id: string; make: () => string }) {
  const url = staticThumbUrl(id, make)
  return <div className="h-full w-full" style={{ backgroundImage: `url("${url}")`, backgroundSize: 'cover' }} aria-hidden />
}

const THUMB_NEUTRAL_FG = '#9aa0ad'

/** Thumbnail for one library background (defaults settings, static frame). */
export function BackgroundThumb({ def }: { def: BackgroundDef }) {
  const settings = useMemo(() => defaultBackgroundSettings(def), [def])
  let visual: React.ReactNode
  switch (def.renderer) {
    case 'bioluminescence':
      visual = <CanvasThumb make={makeBioluminescence(settings)} />
      break
    case 'particles':
      visual = <CanvasThumb make={makeParticleField(settings)} />
      break
    case 'fluid':
      visual = <CanvasThumb make={makeFluidMechanics(settings)} />
      break
    case 'nebula':
      visual = <NebulaScene settings={settings} />
      break
    case 'vapourwave':
      visual = <VapourwaveScene settings={settings} />
      break
    case 'topography':
      visual = (
        <StaticThumb
          id="topography" make={() => generateTopography({ fg: THUMB_NEUTRAL_FG, intensity: 60, scale: 100 })}
          
        />
      )
      break
    case 'fractals':
      visual = <StaticThumb id="fractals" make={() => generateFractals({ fg: THUMB_NEUTRAL_FG, intensity: 55, scale: 100 })}  />
      break
    case 'mycelium':
      visual = <StaticThumb id="mycelium" make={() => generateMycelium({ density: 50, glow: 55, scale: 100 })}  />
      break
    case 'mineral':
      visual = <StaticThumb id="mineral" make={() => generateMineral({ scale: 100 })}  />
      break
    case 'carbon':
      visual = <StaticThumb id="carbon" make={() => generateCarbon({ scale: 100 })}  />
      break
    case 'iridescence':
      visual = <StaticThumb id="iridescence" make={() => generateIridescence({ intensity: 60 })}  />
      break
    default:
      visual = null
  }
  return <div className="relative h-full w-full overflow-hidden">{visual}</div>
}

/** A selectable background tile. */
export function BackgroundTile({
  def,
  active,
  onClick,
}: {
  def: Pick<BackgroundDef, 'id' | 'name' | 'category' | 'hint'>
  active: boolean
  onClick: () => void
}) {
  const full = backgroundDef(def.id)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={`${def.name} — ${def.hint}`}
      className={cn(
        'group overflow-hidden rounded-xl border text-left transition-all',
        active ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-muted-foreground/40',
      )}
    >
      <div className="relative h-14 w-full bg-muted/30">
        {full ? <BackgroundThumb def={full} /> : null}
        {active && (
          <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="border-t bg-card px-2 py-1.5">
        <div className="truncate text-xs font-semibold">{def.name}</div>
        <div className="truncate text-[10px] text-muted-foreground">{BACKGROUND_CATEGORY_LABELS[def.category]}</div>
      </div>
    </button>
  )
}

/** The upload tile (selects the custom image background). */
export function CustomImageTile({
  active,
  hasImage,
  thumbUrl,
  onClick,
}: {
  active: boolean
  hasImage: boolean
  thumbUrl: string | null
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'overflow-hidden rounded-xl border text-left transition-all',
        active ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-muted-foreground/40',
      )}
    >
      <div className="relative h-14 w-full bg-muted/40">
        {thumbUrl ? (
          <div className="h-full w-full" style={{ backgroundImage: `url("${thumbUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-muted-foreground">
            <ImagePlus className="h-4 w-4" />
            <span className="text-[9px] font-medium">{hasImage ? 'Image ready' : 'Upload'}</span>
          </div>
        )}
        {active && (
          <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="border-t bg-card px-2 py-1.5">
        <div className="truncate text-xs font-semibold">Your image</div>
        <div className="truncate text-[10px] text-muted-foreground">PNG · JPG · WebP</div>
      </div>
    </button>
  )
}

export const ALL_BACKGROUNDS = BACKGROUNDS
export const ALL_PALETTES = PALETTES
