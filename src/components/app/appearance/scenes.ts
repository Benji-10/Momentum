// ---------------------------------------------------------------------------
// Canvas scene factories — pure setup + frame functions, no React.
//
// Each factory reads its background settings once and returns a SceneFactory:
// given a 2D context and size it owns its particles/state and draws one frame
// per call. The shared runner (CanvasScene in animated.tsx) drives the loop,
// pauses it when the tab is hidden, and freezes to a single frame under
// prefers-reduced-motion.
// ---------------------------------------------------------------------------

type BgSettings = Record<string, number | string>
export type Scene = (tSec: number) => void
export type SceneFactory = (ctx: CanvasRenderingContext2D, w: number, h: number) => Scene

/** A scene that builds trails needs warm-up frames to look right frozen. */
export type WarmupSceneFactory = SceneFactory & { warmupFrames?: number }

// ---------------------------------------------------------------------------
// Bioluminescence — dark water with glowing drifting particles
// ---------------------------------------------------------------------------

export function makeBioluminescence(settings: BgSettings): SceneFactory {
  const speed = (Number(settings.speed) || 100) / 100
  const density = Number(settings.density) ?? 50
  const glow = Number(settings.glow) ?? 60
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const count = Math.round(24 + (density / 100) * 110)
    const hues = ['186,240,255', '147,197,253', '196,181,253'] // cyan, blue, violet
    const particles = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.5) * 14,
      r: 0.9 + Math.random() * 2.2,
      hue: hues[Math.floor(Math.random() * hues.length)],
      phase: Math.random() * Math.PI * 2,
      twinkle: 0.5 + Math.random() * 1.6,
    }))
    return (t: number) => {
      ctx.fillStyle = '#050a12'
      ctx.fillRect(0, 0, w, h)
      const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.7)
      g.addColorStop(0, 'rgba(12,22,40,0.55)')
      g.addColorStop(1, 'rgba(3,6,12,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)

      ctx.globalCompositeOperation = 'lighter'
      for (const p of particles) {
        p.x += (p.vx * speed) / 60
        p.y += (p.vy * speed) / 60
        p.y += Math.sin(t * 0.4 + p.phase) * 0.12 * speed
        if (p.x < -20) p.x = w + 20
        if (p.x > w + 20) p.x = -20
        if (p.y < -20) p.y = h + 20
        if (p.y > h + 20) p.y = -20
        const tw = 0.5 + 0.5 * Math.sin(t * p.twinkle + p.phase)
        const alpha = (0.25 + 0.75 * tw) * (0.35 + (glow / 100) * 0.65)
        const halo = p.r * (2.6 + (glow / 100) * 5)
        const rg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, halo)
        rg.addColorStop(0, `rgba(${p.hue},${alpha.toFixed(3)})`)
        rg.addColorStop(0.35, `rgba(${p.hue},${(alpha * 0.35).toFixed(3)})`)
        rg.addColorStop(1, `rgba(${p.hue},0)`)
        ctx.fillStyle = rg
        ctx.beginPath()
        ctx.arc(p.x, p.y, halo, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}

// ---------------------------------------------------------------------------
// Particle Fields — drifting particles in a vector field, optional links
// ---------------------------------------------------------------------------

export function makeParticleField(settings: BgSettings): SceneFactory {
  const speed = (Number(settings.speed) || 100) / 100
  const density = Number(settings.density) ?? 45
  const connections = Number(settings.connections) ?? 50
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const count = Math.round(28 + (density / 100) * 95)
    const field = (x: number, y: number, t: number) =>
      Math.sin(x * 0.0016 + t * 0.18) * 1.5 +
      Math.cos(y * 0.0021 - t * 0.14) * 1.5 +
      Math.sin((x + y) * 0.0009 + t * 0.1)
    const parts = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
    }))
    const linkDist = 60 + connections * 0.65
    return (t: number) => {
      ctx.fillStyle = '#070b12'
      ctx.fillRect(0, 0, w, h)
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, 'rgba(15,23,42,0.5)')
      g.addColorStop(1, 'rgba(2,6,12,0.2)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)

      for (const p of parts) {
        const a = field(p.x, p.y, t)
        p.x += Math.cos(a) * 0.55 * speed
        p.y += Math.sin(a) * 0.55 * speed
        if (p.x < -10) p.x = w + 10
        if (p.x > w + 10) p.x = -10
        if (p.y < -10) p.y = h + 10
        if (p.y > h + 10) p.y = -10
      }
      if (connections > 3) {
        ctx.lineWidth = 0.7
        for (let i = 0; i < parts.length; i++) {
          for (let j = i + 1; j < parts.length; j++) {
            const dx = parts[i].x - parts[j].x
            const dy = parts[i].y - parts[j].y
            const d2 = dx * dx + dy * dy
            if (d2 < linkDist * linkDist) {
              const d = Math.sqrt(d2)
              const a = (1 - d / linkDist) * 0.22 * (connections / 100)
              ctx.strokeStyle = `rgba(148,163,184,${a.toFixed(3)})`
              ctx.beginPath()
              ctx.moveTo(parts[i].x, parts[i].y)
              ctx.lineTo(parts[j].x, parts[j].y)
              ctx.stroke()
            }
          }
        }
      }
      ctx.fillStyle = 'rgba(203,213,225,0.85)'
      for (const p of parts) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Fluid Mechanics — flowing ink: drifting colour blobs with motion trails.
// A lightweight approximation of fluid advection (no real simulation): a
// low-alpha wash each frame leaves trails, additive gradients read as ink.
// ---------------------------------------------------------------------------

export function makeFluidMechanics(settings: BgSettings): WarmupSceneFactory {
  const speed = (Number(settings.speed) || 60) / 100
  const density = Number(settings.density) ?? 50
  const factory = ((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const inks = ['rgba(14,116,144,', 'rgba(124,58,237,', 'rgba(180,83,9,', 'rgba(13,148,136,', 'rgba(192,38,211,']
    const count = Math.round(4 + (density / 100) * 6)
    const blobs = Array.from({ length: count }, (_, i) => ({
      colour: inks[i % inks.length],
      sp1: 0.05 + Math.random() * 0.08,
      sp2: 0.03 + Math.random() * 0.07,
      ph1: Math.random() * Math.PI * 2,
      ph2: Math.random() * Math.PI * 2,
      fx: 0.18 + Math.random() * 0.3,
      fy: 0.16 + Math.random() * 0.28,
      size: 0.22 + Math.random() * 0.16,
    }))
    let primed = false
    const frame = (t: number) => {
      if (!primed) {
        ctx.fillStyle = '#0a0a10'
        ctx.fillRect(0, 0, w, h)
        primed = true
      }
      ctx.fillStyle = 'rgba(10,10,16,0.045)'
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      const base = Math.min(w, h)
      for (const b of blobs) {
        const cx = w * (0.5 + b.fx * Math.sin(t * b.sp1 * Math.PI * speed + b.ph1) + 0.1 * Math.sin(t * b.sp2 + b.ph2))
        const cy = h * (0.5 + b.fy * Math.cos(t * b.sp2 * Math.PI * speed + b.ph2) + 0.08 * Math.cos(t * b.sp1 + b.ph1))
        const r = base * b.size * (1 + 0.18 * Math.sin(t * 0.3 + b.ph1))
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
        g.addColorStop(0, `${b.colour}0.16)`)
        g.addColorStop(0.55, `${b.colour}0.07)`)
        g.addColorStop(1, `${b.colour}0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    return frame
  }) as WarmupSceneFactory
  factory.warmupFrames = 60 // build up trails so a frozen frame still reads as ink
  return factory
}
