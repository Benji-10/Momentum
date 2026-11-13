'use client'

// ---------------------------------------------------------------------------
// The background layer — a single fixed, non-interactive div behind the app
// (above the canvas background, below all content: negative z-index paints
// after the root background but before any content).
//
// The chosen background renders inside it; the layer itself carries the
// opacity and blur settings so the scene blends with the palette underneath.
// Animated scenes pause when hidden / under prefers-reduced-motion; static
// art is generated once per settings change (memoized over primitives).
//
// Two inputs flow from the live theme into the art:
//   --foreground  stroke/ink colour for line art (topography, fractals)
//   --background  the canvas/substrate base for animated scenes + mycelium,
//                 so a background you pick MATCHES the palette you picked
// A per-load SEED feeds the static generators — every refresh grows a new
// terrain / network / Julia rule (stable within the visit, so sliders
// never flicker the art).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import type { BackgroundConfig } from '@/lib/appearance/types'
import { bgNum } from '@/lib/appearance/backgrounds'
import {
  colorToRgb,
  generateCarbon,
  generateFractals,
  generateIridescence,
  generateMycelium,
  generateTopography,
  MINERAL_IMAGE_URL,
} from './generators'
import { CanvasScene, CustomImageScene, NebulaScene, VapourwaveScene } from './animated'
import { makeBioluminescence, makeFluidMechanics, makeParticleField } from './scenes'

/** Read a CSS variable from the document root and re-read when the theme
 *  changes. Watches <html> attribute mutations (data-theme flips from
 *  next-themes) AND the custom-palette <style> block (custom colour edits
 *  mutate that element's text, not any attribute), so both preset switches
 *  and live custom-colour tweaks refresh the derived art. */
function useThemeVar(name: string): string {
  const [v, setV] = useState('')
  useEffect(() => {
    const root = document.documentElement
    const read = () => {
      const val = getComputedStyle(root).getPropertyValue(name).trim()
      if (val) setV(val)
    }
    read()
    const obs = new MutationObserver(read)
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    // the custom-theme stylesheet appears lazily (first time a custom palette
    // is applied) — poll briefly for it, then watch its text
    let styleObs: MutationObserver | null = null
    let timer = 0
    let tries = 0
    const watchStyle = (): boolean => {
      const el = document.getElementById('momentum-custom-theme')
      if (!el) return false
      styleObs = new MutationObserver(read)
      styleObs.observe(el, { childList: true, characterData: true, subtree: true })
      return true
    }
    if (!watchStyle()) {
      timer = window.setInterval(() => {
        tries++
        if (watchStyle() || tries > 60) window.clearInterval(timer)
      }, 250)
    }
    return () => {
      obs.disconnect()
      styleObs?.disconnect()
      window.clearInterval(timer)
    }
  }, [name])
  return v
}

/**
 * Static art ("static" + "image" categories) for the current config — one
 * memo over primitive inputs, regenerated only when the relevant settings,
 * the theme's colours, or the per-load seed actually change. Never per frame.
 */
function useStaticArt(config: BackgroundConfig, fg: string, themeBg: [number, number, number] | null, seed: number): string | null {
  const intensity = bgNum(config, 'intensity', 55)
  const scale = bgNum(config, 'scale', 100)
  const density = bgNum(config, 'density', 50)
  const glow = bgNum(config, 'glow', 55)
  // variant 0 = Auto (a seeded random rule, fresh every load); 1..24 pin one
  const variant = bgNum(config, 'variant', 0)
  const id = config.id
  return useMemo(() => {
    switch (id) {
      case 'topography':
        return generateTopography({ fg: fg || 'oklch(0.2 0.01 80)', intensity, scale, seed })
      case 'fractals':
        return generateFractals({ fg: fg || 'oklch(0.2 0.01 80)', intensity, scale, variant, seed })
      case 'bg-mycelium':
        return generateMycelium({ density, glow, scale, seed, themeBg })
      case 'carbon':
        return generateCarbon({ scale })
      case 'iridescence':
        return generateIridescence({ intensity, seed })
      default:
        return null
    }
  }, [id, fg, intensity, scale, density, glow, variant, themeBg, seed])
}

export function BackgroundLayer({
  config,
  customImageUrl,
}: {
  config: BackgroundConfig | null
  /** object URL of the uploaded image (this device), when applicable */
  customImageUrl: string | null
}) {
  const fg = useThemeVar('--foreground')
  const bgVar = useThemeVar('--background')
  const themeBg = useMemo(() => (bgVar ? colorToRgb(bgVar) : null), [bgVar])
  // one seed per page load: every refresh grows a new terrain / network /
  // Julia rule; within the visit it is stable, so slider tweaks never
  // flicker the art (the seed is a memo input, not a roll per render)
  const [loadSeed] = useState(() => Math.floor(Math.random() * 2 ** 31))
  const staticUrl = useStaticArt(config ?? { id: 'none', settings: {} }, fg, themeBg, loadSeed)
  if (!config) return null

  const opacity = bgNum(config, 'opacity', 80) / 100
  const blur = bgNum(config, 'blur', 0)
  const style: React.CSSProperties = {
    opacity,
    // slight overscan keeps blurred edges from showing the page bg
    ...(blur ? { filter: `blur(${blur}px)`, transform: 'scale(1.04)' } : {}),
  }

  // the theme base rides along with the user's slider settings — a theme
  // flip rebuilds the scene with the new base (settingsKey includes it)
  const sceneSettings = { ...config.settings, ...(themeBg ? { themeBg } : {}) }
  const settingsKey = JSON.stringify({ s: config.settings, themeBg })

  let scene: React.ReactNode = null
  switch (config.id) {
    case 'bioluminescence':
      scene = <CanvasScene makeScene={makeBioluminescence} settings={sceneSettings} settingsKey={settingsKey} />
      break
    case 'particle-field':
      scene = <CanvasScene makeScene={makeParticleField} settings={sceneSettings} settingsKey={settingsKey} />
      break
    case 'fluid-mechanics':
      scene = <CanvasScene makeScene={makeFluidMechanics} settings={sceneSettings} settingsKey={settingsKey} />
      break
    case 'nebula':
      scene = <NebulaScene settings={config.settings} />
      break
    case 'vapourwave':
      scene = <VapourwaveScene settings={config.settings} />
      break
    case 'custom-image':
      scene = customImageUrl ? (
        <CustomImageScene url={customImageUrl} settings={config.settings} />
      ) : (
        // chosen on another device — the image lives in this browser's IDB
        <div className="absolute inset-0 bg-muted/40" aria-hidden />
      )
      break
    case 'mineral': {
      // a real photograph — cover, with the scale slider acting as zoom
      const zoom = bgNum(config, 'scale', 100)
      scene = (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("${MINERAL_IMAGE_URL}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            ...(zoom !== 100 ? { transform: `scale(${zoom / 100})` } : {}),
          }}
          aria-hidden
        />
      )
      break
    }
    default: {
      // static procedural / image-style art (useStaticArt returned null for
      // unknown ids — render nothing rather than an empty layer)
      if (!staticUrl) return null
      scene = (
        <div
          className="absolute inset-0"
          style={{ backgroundImage: `url("${staticUrl}")`, backgroundSize: 'cover' }}
          aria-hidden
        />
      )
      break
    }
  }

  return (
    <div className="bg-layer" style={style} aria-hidden>
      {scene}
    </div>
  )
}
