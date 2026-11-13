'use client'

// ---------------------------------------------------------------------------
// Animated background components.
//
// CanvasScene is the shared runner for canvas scenes (factories in scenes.ts):
// one requestAnimationFrame loop on a capped devicePixelRatio, paused when
// the tab is hidden, frozen to a single frame under prefers-reduced-motion.
//
// Nebula and Vapourwave are pure CSS — compositor-friendly transforms only,
// disabled by the reduced-motion rules in globals.css.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react'
import { NOISE_IMAGE_URL } from './generators'
import { cn } from '@/lib/utils'
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
// Vapourwave — the full retro postcard: gradient dusk sky with stars, the
// slatted sun, a city skyline silhouette on the horizon, the scrolling
// perspective grid, a rippled sun reflection on the “floor”, a chrome
// horizon line, atmospheric haze and a CRT scanline veil. Star positions,
// twinkle phases and the skyline shape are seeded per page load — a fresh
// city every visit, like the canvas scenes. All motion is transform/opacity
// only (compositor-friendly), and everything freezes under reduced motion.
// ---------------------------------------------------------------------------

/** deterministic RNG so one load keeps one city (re-renders never reshuffle) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function VapourwaveScene({ settings }: { settings: BgSettings }) {
  const speed = numOf(settings.speed, 70) // 0 = the postcard holds still
  const gridDur = `${(3.2 * 100) / Math.max(speed, 1)}s`
  const sunDur = `${(9 * 100) / Math.max(speed, 1)}s`
  const still = speed < 5
  // one skyline + star field per page load (seeded, stable across re-renders)
  const [sky] = useState(() => {
    const rnd = mulberry32(Math.floor(Math.random() * 2 ** 31))
    // stars: two layers of radial-gradient dot lists (tiled, low opacity)
    const starLayer = (n: number, size: number) => {
      const parts: string[] = []
      for (let i = 0; i < n; i++) {
        const x = (rnd() * 100).toFixed(2)
        const y = (rnd() * 100).toFixed(2)
        const r = (size * (0.5 + rnd())).toFixed(2)
        const a = (0.35 + rnd() * 0.5).toFixed(2)
        parts.push(`radial-gradient(circle ${r}px at ${x}% ${y}%, rgba(255,255,255,${a}) 0 ${r}px, transparent ${r}px)`)
      }
      return parts.join(',')
    }
    // skyline: one closed clip-path polygon tracing blocky towers (and the
    // occasional antenna spike) along the horizon, baseline at the bottom
    const clip: string[] = ['0% 100%']
    let x = 0
    while (x < 100) {
      const w = 2.5 + rnd() * 5
      const x2 = Math.min(100, x + w)
      const h = 40 + rnd() * 50 // tower height, % of the strip
      const top = (100 - h).toFixed(1)
      clip.push(`${x.toFixed(1)}% 100%`, `${x.toFixed(1)}% ${top}%`)
      if (rnd() < 0.35) {
        // thin antenna spike traced up and back down within the tower top
        const ax = x + (x2 - x) * 0.5
        const aTop = (100 - h - 10 - rnd() * 8).toFixed(1)
        clip.push(
          `${(ax - 0.35).toFixed(2)}% ${top}%`,
          `${(ax - 0.35).toFixed(2)}% ${aTop}%`,
          `${(ax + 0.35).toFixed(2)}% ${aTop}%`,
          `${(ax + 0.35).toFixed(2)}% ${top}%`,
        )
      }
      clip.push(`${x2.toFixed(1)}% ${top}%`, `${x2.toFixed(1)}% 100%`)
      x = x2
    }
    clip.push('100% 100%')
    return { starsA: starLayer(26, 1.4), starsB: starLayer(18, 1.0), skyline: clip.join(',') }
  })
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        background:
          'linear-gradient(180deg, #170b2e 0%, #3b1470 30%, #8b2d8f 55%, #d94892 74%, #f59e0b 90%, #fde68a 100%)',
      }}
      aria-hidden
    >
      {/* stars in the upper sky — two tiled layers, deterministic per load */}
      <div
        className="absolute inset-x-0 top-0 h-[46%]"
        style={{ backgroundImage: sky.starsA, backgroundSize: '420px 240px', opacity: 0.5 }}
      />
      <div
        className="absolute inset-x-0 top-0 h-[40%]"
        style={{ backgroundImage: sky.starsB, backgroundSize: '300px 200px', opacity: 0.3 }}
      />
      {/* sun with retro slats */}
      <div
        className={cn('absolute left-1/2 top-[14%] aspect-square w-[46vmin] -translate-x-1/2 rounded-full', !still && 'bg-sun-bob')}
        style={{
          background: 'linear-gradient(180deg, #fef3c7 0%, #fcd34d 35%, #fb923c 70%, #f43f5e 100%)',
          maskImage:
            'linear-gradient(180deg, #000 62%, transparent 62%), repeating-linear-gradient(180deg, #000 0 8.5%, transparent 8.5% 12.5%)',
          WebkitMaskImage:
            'linear-gradient(180deg, #000 62%, transparent 62%), repeating-linear-gradient(180deg, #000 0 8.5%, transparent 8.5% 12.5%)',
          maskComposite: 'intersect',
          WebkitMaskComposite: 'source-in',
          animationDuration: sunDur,
          filter: 'drop-shadow(0 0 40px rgba(251, 146, 60, 0.45))',
        }}
      />
      {/* city skyline silhouette on the horizon (fresh shape each load) */}
      <div
        className="absolute inset-x-0 bottom-[46%] h-[12%] bg-[#14082e]"
        style={{ clipPath: `polygon(${sky.skyline})` }}
      />
      {/* chrome horizon line where the grid begins */}
      <div
        className="absolute inset-x-0 bottom-[46%] h-[2px]"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(244,114,182,0.85) 30%, rgba(253,230,138,0.9) 50%, rgba(244,114,182,0.85) 70%, transparent)',
        }}
      />
      {/* perspective grid floor */}
      <div
        className="absolute inset-x-[-45%] bottom-0 h-[54%]"
        style={{ transform: 'perspective(430px) rotateX(62deg)', transformOrigin: 'bottom' }}
      >
        <div
          className={cn('absolute inset-0', !still && 'bg-grid-scroll')}
          style={{
            backgroundImage:
              'linear-gradient(rgba(244,114,182,0.4) 1.5px, transparent 1.5px), linear-gradient(90deg, rgba(244,114,182,0.3) 1.5px, transparent 1.5px)',
            backgroundSize: '56px 56px',
            animationDuration: gridDur,
          }}
        />
      </div>
      {/* rippled sun reflection on the floor — horizontal stripe mask reads
          as water shimmering under the sun */}
      <div
        className="absolute bottom-[46%] left-1/2 h-[20%] w-[34vmin] -translate-x-1/2"
        style={{
          background: 'linear-gradient(180deg, rgba(251,146,60,0.4), rgba(244,63,94,0.18) 55%, transparent 85%)',
          maskImage: 'repeating-linear-gradient(180deg, #000 0 6px, transparent 6px 16px)',
          WebkitMaskImage: 'repeating-linear-gradient(180deg, #000 0 6px, transparent 6px 16px)',
        }}
      />
      {/* atmospheric haze */}
      <div
        className="absolute inset-x-0 bottom-0 h-[48%]"
        style={{ background: 'linear-gradient(180deg, transparent, rgba(23,11,46,0.72) 55%, rgba(9,5,20,0.94))' }}
      />
      {/* CRT scanlines over the whole postcard — the giveaway retro veil */}
      <div
        className="absolute inset-0"
        style={{
          background: 'repeating-linear-gradient(180deg, rgba(10,4,24,0.22) 0 1px, transparent 1px 4px)',
          opacity: 0.45,
        }}
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
