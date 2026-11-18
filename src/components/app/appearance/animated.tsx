'use client'

// ---------------------------------------------------------------------------
// Animated background components.
//
// CanvasScene is the shared runner for canvas scenes (factories in scenes.ts):
// one requestAnimationFrame loop on a capped devicePixelRatio, paused when
// the tab is hidden, frozen to a single frame under prefers-reduced-motion.
//
// Nebula is pure CSS — compositor-friendly transforms only, disabled by the
// reduced-motion rules in globals.css. (Vapourwave moved to scenes.ts as a
// canvas factory — makeVapourwave — ported from the reference sketch.)
// ---------------------------------------------------------------------------

import { useEffect, useRef } from 'react'
import { NOISE_IMAGE_URL } from './generators'
import { numOf, type SceneFactory, type WarmupSceneFactory } from './scenes'

// matches scenes.ts (the theme's background colour rides along as a tuple)
export type BgSettings = Record<string, number | string | [number, number, number]>

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * A full-viewport canvas running `makeScene`. Re-initializes only when
 * `settingsKey` changes (the caller stringifies the settings), never per
 * frame — pausing/resuming never rebuilds the scene's state.
 */
export function CanvasScene({
  makeScene,
  settings,
  settingsKey,
}: {
  makeScene: (settings: BgSettings) => SceneFactory
  settings: BgSettings
  settingsKey: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let scene: ((t: number) => void) | null = null
    let disposed = false
    let parked = false

    const setup = (): ((t: number) => void) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const w = canvas.clientWidth || window.innerWidth
      const h = canvas.clientHeight || window.innerHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const s = makeScene(settings)(ctx, w, h)
      scene = s
      return s
    }
    const currentScene = setup()

    const start = performance.now()

    if (prefersReducedMotion()) {
      // one frozen frame that still reads as the scene (trail-based scenes
      // get their warm-up so the frame isn't an empty canvas)
      const warmup = (makeScene as unknown as WarmupSceneFactory).warmupFrames ?? 1
      for (let i = 1; i <= warmup; i++) currentScene((i / warmup) * 1.2)
      return () => {}
    }

    const loop = (now: number) => {
      if (disposed) return
      scene?.((now - start) / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const onVisibility = () => {
      if (document.hidden) {
        // park the loop; visibilitychange restarts it
        cancelAnimationFrame(raf)
        raf = 0
        parked = true
      } else if (parked) {
        parked = false
        raf = requestAnimationFrame(loop)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    const onResize = () => {
      if (document.hidden) return
      setup()
      scene?.(0)
    }
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', onResize)
    }
  }, [settingsKey])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
}

// ---------------------------------------------------------------------------
// Nebula — layered CSS gradients with a very slow drift + film grain
// ---------------------------------------------------------------------------

export function NebulaScene({ settings }: { settings: BgSettings }) {
  const speed = numOf(settings.speed, 100) // 0 = genuinely still
  const scale = numOf(settings.scale, 100)
  const s = scale / 100
  const dur = (base: number) => `${(base * 100) / Math.max(speed, 1)}s`
  const anim = speed < 5 ? ({ animation: 'none' } as const) : undefined
  return (
    <div
      className="absolute inset-0"
      style={{ background: 'linear-gradient(160deg, #0a0614 0%, #130a1f 45%, #1b0f26 100%)' }}
      aria-hidden
    >
      <div
        className="bg-drift-a absolute -inset-[18%]"
        style={{
          background: `radial-gradient(${42 * s}% ${38 * s}% at 30% 34%, rgba(168,85,247,0.38), transparent 70%)`,
          animationDuration: dur(90),
          ...anim,
        }}
      />
      <div
        className="bg-drift-b absolute -inset-[18%]"
        style={{
          background: `radial-gradient(${38 * s}% ${44 * s}% at 72% 28%, rgba(236,72,153,0.26), transparent 70%)`,
          animationDuration: dur(120),
          ...anim,
        }}
      />
      <div
        className="bg-drift-c absolute -inset-[18%]"
        style={{
          background: `radial-gradient(${48 * s}% ${40 * s}% at 55% 78%, rgba(59,130,246,0.24), transparent 72%)`,
          animationDuration: dur(150),
          ...anim,
        }}
      />
      <div
        className="absolute inset-0"
        style={{ backgroundImage: `url("${NOISE_IMAGE_URL}")`, opacity: 0.14, mixBlendMode: 'overlay' }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom uploaded image
// ---------------------------------------------------------------------------

export function CustomImageScene({ url, settings }: { url: string; settings: BgSettings }) {
  const darkness = Number(settings.darkness) ?? 25
  const tintStrength = Number(settings.tintStrength) ?? 0
  const tint = String(settings.tint ?? '#7c6ee0')
  const fit = String(settings.fit ?? 'cover')
  const position = String(settings.position ?? 'center')
  const scale = Number(settings.scale) || 100
  const blur = Number(settings.blur) || 0
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("${url}")`,
          backgroundSize: fit,
          backgroundPosition: position,
          backgroundRepeat: 'no-repeat',
          transform: scale !== 100 ? `scale(${scale / 100})` : undefined,
          filter: blur ? `blur(${blur}px)` : undefined,
        }}
      />
      {darkness > 0 && <div className="absolute inset-0" style={{ background: '#000', opacity: darkness / 100 }} />}
      {tintStrength > 0 && <div className="absolute inset-0" style={{ background: tint, opacity: tintStrength / 100 }} />}
    </div>
  )
}
