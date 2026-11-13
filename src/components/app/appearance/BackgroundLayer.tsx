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
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react'
import type { BackgroundConfig } from '@/lib/appearance/types'
import { bgNum } from '@/lib/appearance/backgrounds'
import {
  generateCarbon,
  generateFractals,
  generateIridescence,
  generateMycelium,
  generateTopography,
  MINERAL_IMAGE_URL,
} from './generators'
import { CanvasScene, CustomImageScene, NebulaScene, VapourwaveScene } from './animated'
import { makeBioluminescence, makeFluidMechanics, makeParticleField } from './scenes'

/** Read the live --foreground (oklch string) and re-read when the theme changes. */
function useThemeForeground(): string {
  const [fg, setFg] = useState('')
  useEffect(() => {
    const read = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim()
      if (v) setFg(v)
    }
    read()
    // data-theme flips and custom-var injection both land as attribute/style
    // mutations on <html>
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    return () => obs.disconnect()
  }, [])
  return fg
}

/**
 * Static art ("static" + "image" categories) for the current config — one
 * memo over primitive inputs, regenerated only when the relevant settings
 * (or the theme's foreground) actually change. Never per frame.
 */
function useStaticArt(config: BackgroundConfig, fg: string): string | null {
  const intensity = bgNum(config, 'intensity', 55)
  const scale = bgNum(config, 'scale', 100)
  const density = bgNum(config, 'density', 50)
  const glow = bgNum(config, 'glow', 55)
  const variant = bgNum(config, 'variant', 1)
  const id = config.id
  return useMemo(() => {
    switch (id) {
      case 'topography':
        return generateTopography({ fg: fg || 'oklch(0.2 0.01 80)', intensity, scale })
      case 'fractals':
        return generateFractals({ fg: fg || 'oklch(0.2 0.01 80)', intensity, scale, variant })
      case 'bg-mycelium':
        return generateMycelium({ density, glow, scale })
      case 'carbon':
        return generateCarbon({ scale })
      case 'iridescence':
        return generateIridescence({ intensity })
      default:
        return null
    }
  }, [id, fg, intensity, scale, density, glow, variant])
}

export function BackgroundLayer({
  config,
  customImageUrl,
}: {
  config: BackgroundConfig | null
  /** object URL of the uploaded image (this device), when applicable */
  customImageUrl: string | null
}) {
  const fg = useThemeForeground()
  const staticUrl = useStaticArt(config ?? { id: 'none', settings: {} }, fg)
  if (!config) return null

  const opacity = bgNum(config, 'opacity', 80) / 100
  const blur = bgNum(config, 'blur', 0)
  const style: React.CSSProperties = {
    opacity,
    // slight overscan keeps blurred edges from showing the page bg
    ...(blur ? { filter: `blur(${blur}px)`, transform: 'scale(1.04)' } : {}),
  }

  const settingsKey = JSON.stringify(config.settings)

  let scene: React.ReactNode = null
  switch (config.id) {
    case 'bioluminescence':
      scene = <CanvasScene makeScene={makeBioluminescence} settings={config.settings} settingsKey={settingsKey} />
      break
    case 'particle-field':
      scene = <CanvasScene makeScene={makeParticleField} settings={config.settings} settingsKey={settingsKey} />
      break
    case 'fluid-mechanics':
      scene = <CanvasScene makeScene={makeFluidMechanics} settings={config.settings} settingsKey={settingsKey} />
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
