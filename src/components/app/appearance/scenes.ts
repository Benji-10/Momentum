// ---------------------------------------------------------------------------
// Canvas scene factories — pure setup + frame functions, no React.
//
// Each factory reads its background settings once and returns a SceneFactory:
// given a 2D context and size it owns its particles/state and draws one frame
// per call. The shared runner (CanvasScene in animated.tsx) drives the loop,
// pauses it when the tab is hidden, and freezes to a single frame under
// prefers-reduced-motion.
// ---------------------------------------------------------------------------

type BgSettings = Record<string, number | string | [number, number, number]>
export type Scene = (tSec: number) => void
export type SceneFactory = (ctx: CanvasRenderingContext2D, w: number, h: number) => Scene

/** A scene that builds trails needs warm-up frames to look right frozen. */
export type WarmupSceneFactory = SceneFactory & { warmupFrames?: number }

/** The theme's background colour, injected by BackgroundLayer (undefined in
 *  the offline preview harness → scenes fall back to their curated darks). */
function themeBgOf(settings: BgSettings): [number, number, number] | null {
  const v = settings.themeBg
  return Array.isArray(v) ? [v[0], v[1], v[2]] : null
}

function lumOf(rgb: [number, number, number]): number {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
}

/** Numeric background setting with a proper default. `Number(x) || d` eats
 * a legitimate 0 (speed 0% must freeze a scene, not fall back to 100) and
 * `Number(x) ?? d` lets NaN through — this handles both. */
export function numOf(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

// ---------------------------------------------------------------------------
// Bioluminescence — dark water with glowing drifting particles
// ---------------------------------------------------------------------------

export function makeBioluminescence(settings: BgSettings): SceneFactory {
  const speed = numOf(settings.speed, 100) / 100 // 0 = truly still
  const density = numOf(settings.density, 50)
  const glow = numOf(settings.glow, 60)
  const tb = themeBgOf(settings)
  const light = tb != null && lumOf(tb) > 0.5
  // the water itself adopts the theme's background colour — dark themes get
  // their own shade of deep water, light themes a bright one with deeper-
  // toned plankton (additive glow is invisible on light, so the particles
  // switch to normal compositing ink dots)
  const baseCss = tb ? `rgb(${tb[0]},${tb[1]},${tb[2]})` : '#050a12'
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const count = Math.round(24 + (density / 100) * 110)
    const hues = light
      ? ['8,145,178', '79,70,229', '124,58,237'] // teal / indigo / violet ink
      : ['186,240,255', '147,197,253', '196,181,253'] // cyan, blue, violet glow
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
      ctx.fillStyle = baseCss
      ctx.fillRect(0, 0, w, h)
      if (!light) {
        // deep-water depth wash — pure glow dressing, meaningless on paper
        const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.7)
        g.addColorStop(0, 'rgba(12,22,40,0.55)')
        g.addColorStop(1, 'rgba(3,6,12,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }

      ctx.globalCompositeOperation = light ? 'source-over' : 'lighter'
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
// Particle Fields — a deep starfield terrain. A wide point grid laid out on
// a plane is displaced by three octaves of animated 3D value noise, each
// octave with its OWN motion — one rolls toward the viewer, one slides
// diagonally across, one only morphs in place — over a slow swirl of the
// whole domain, so the undulations cross each other instead of marching in
// a single direction. The plane is sized against the projected horizon so
// its side edges sit off-screen at EVERY depth: the field reads as
// infinite, never "narrower than the screen". There are no mesh lines.
// Each point is drawn from a small atlas of pre-rendered sprites whose
// softness encodes DEPTH OF FIELD: a focal band mid-field stays crisp
// while the near rows dissolve into big bokeh rings and the far field
// into haze. Points carry electric-blue tints and a heavy-tailed
// magnitude — a few big bright beacons that twinkle, a mass of
// almost-invisible grains. The whole scene runs at a fraction of its old
// pace, and speed 0% is genuinely frozen (`numOf` keeps 0 from falling
// back to the slider default). A fresh noise lattice rolls on every
// build: each reload grows a different field. The canvas base adopts the
// theme's background colour; light themes flip to deep electric-blue ink
// dots on paper.
// ---------------------------------------------------------------------------

export function makeParticleField(settings: BgSettings): SceneFactory {
  const speed = numOf(settings.speed, 100) / 100 // 0 = genuinely frozen
  const density = numOf(settings.density, 45)
  const tb = themeBgOf(settings)
  const light = tb != null && lumOf(tb) > 0.5
  const baseCss = tb ? `rgb(${tb[0]},${tb[1]},${tb[2]})` : '#05070c'
  // the whole scene runs at a fraction of its old pace — the user asked for
  // way more subtle motion; the speed slider then modulates around that
  const SLOW = 0.22 * speed
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    // --- camera: pitched down, raised and pulled back ---------------------
    const pitch = 1.08 // ~62°
    const cp = Math.cos(pitch)
    const sp = Math.sin(pitch)
    const camH = 1.35
    const camD = 2.2
    const PD = 4.4 // plane depth — the far edge reads as the horizon
    /** perspective-project (x, y, z); out = [sx, sy, depth] in focal units */
    const project = (x: number, y: number, z: number, out: Float32Array, k: number) => {
      const ey = y - camH
      const ez = z + camD
      const zc = ez * cp - ey * sp
      const yc = ey * cp + ez * sp
      const inv = 1 / zc
      out[k] = x * inv
      out[k + 1] = -yc * inv
      out[k + 2] = zc
    }
    const fitBuf = new Float32Array(3)
    project(0, 0, 0, fitBuf, 0)
    const nearY = fitBuf[1]!
    const nearD = fitBuf[2]!
    project(0, 0, PD, fitBuf, 0)
    const farY = fitBuf[1]!
    const farD = fitBuf[2]!

    // --- framing: the vertical fit pins the horizon at 16% height and
    //     pushes the near edge past the bottom of the frame. The plane
    //     WIDTH is then sized so the FAR edge alone spans ~1.8 screens —
    //     the side edges of the field are off-screen at every depth and
    //     the mesh reads as infinite (the build this replaces sized the
    //     plane for the near rows only, so the compressed far field fell
    //     short of the sides and its edges were visible) ------------------
    const fitScale = (0.92 * h) / Math.max(1e-4, nearY - farY)
    const PW = (1.8 * w * farD) / fitScale
    const cxf = w / 2
    const cyf = 0.16 * h - farY * fitScale

    // depth of the plane where it crosses the bottom edge of the frame
    // (binary search on the flat projection — screen y is monotonic in z)
    let zLo = 0
    let zHi = PD
    for (let i = 0; i < 22; i++) {
      const zMid = (zLo + zHi) / 2
      project(0, 0, zMid, fitBuf, 0)
      if (cyf + fitBuf[1]! * fitScale > h) zLo = zMid
      else zHi = zMid
    }
    project(0, 0, zHi, fitBuf, 0)
    const dBottom = fitBuf[2]!

    // --- the grid: cell size tuned at the bottom-edge depth, so the near
    //     band carries sparse bokeh while perspective crowds the far field
    const spacingPx = 46 - (density / 100) * 24 // 46..22 px at the bottom edge
    const spacing = (spacingPx * dBottom) / fitScale // world units per cell
    const cols = Math.max(26, Math.min(104, Math.ceil(PW / spacing) + 1))
    const rows = Math.max(16, Math.min(64, Math.ceil(PD / spacing) + 1))

    // --- 3D value noise: a random lattice, trilinear + smoothstep ---------
    // rolled per build → a fresh field every page load
    const L = 16
    const lat = new Float32Array(L * L * L)
    for (let i = 0; i < lat.length; i++) lat[i] = Math.random()
    const fadeT = (t: number) => t * t * (3 - 2 * t)
    const latAt = (x: number, y: number, z: number) => lat[((z & 15) * L + (y & 15)) * L + (x & 15)]!
    const noise3 = (x: number, y: number, z: number) => {
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      const zi = Math.floor(z)
      const fx = fadeT(x - xi)
      const fy = fadeT(y - yi)
      const fz = fadeT(z - zi)
      const x0 = xi & 15
      const y0 = yi & 15
      const z0 = zi & 15
      const x1 = (xi + 1) & 15
      const y1 = (yi + 1) & 15
      const z1 = (zi + 1) & 15
      const a = latAt(x0, y0, z0) + (latAt(x1, y0, z0) - latAt(x0, y0, z0)) * fx
      const b = latAt(x0, y1, z0) + (latAt(x1, y1, z0) - latAt(x0, y1, z0)) * fx
      const c = latAt(x0, y0, z1) + (latAt(x1, y0, z1) - latAt(x0, y0, z1)) * fx
      const d = latAt(x0, y1, z1) + (latAt(x1, y1, z1) - latAt(x0, y1, z1)) * fx
      const e = a + (b - a) * fy
      const f = c + (d - c) * fy
      return e + (f - e) * fz
    }

    // --- the surface: three octaves, each with its own motion -------------
    const F1 = 1.05
    const F2 = 2.15
    const F3 = 3.6
    const AMP = 0.2 // gentler peaks than the wire-terrain build
    const driftAz = 0.24 * SLOW // octave A: rolls toward the viewer
    const driftBx = 0.2 * SLOW // octave B: slides diagonally across
    const driftBz = -0.1 * SLOW
    const swirlRate = 0.05 * SLOW // slow rotation of the whole domain
    const morphRate = 0.3 * SLOW // the shapes themselves evolve
    /** normalized height at a plane point, roughly -1..1 */
    const heightAt = (x: number, z: number, t: number) => {
      const ang = t * swirlRate
      const ca = Math.cos(ang)
      const sa = Math.sin(ang)
      const rx = x * ca - z * sa
      const rz = x * sa + z * ca
      let n = 0.4 * noise3(rx * F1 + 41.7, (rz + t * driftAz) * F1 + 3.1, t * morphRate)
      n += 0.34 * noise3((rx + t * driftBx) * F2 + 7.3, (rz + t * driftBz) * F2 + 19.9, t * morphRate * 1.7 + 33.3)
      n += 0.26 * noise3(rx * F3 + 91.1, rz * F3 + 55.5, t * morphRate * 2.4 + 77.7)
      let v = (n - 0.5) * 2.35
      if (v > 1) v = 1
      else if (v < -1) v = -1
      return v
    }

    // --- sprite atlas: depth-of-field, pre-rendered ------------------------
    // 3 electric-blue tints × 6 softness levels. Level 0 is a crisp dot;
    // the softest levels are bokeh RINGS (bright rim, hollow centre) like
    // an out-of-focus lens. A point's level follows its distance from the
    // focal band, so near bokeh and far haze both dissolve while the
    // mid-field stays sharp — the focal-length illusion.
    const TINTS: [number, number, number][] = light
      ? [
          [4, 104, 214], // deep electric-blue ink
          [8, 134, 238], // electric blue
          [66, 174, 255], // bright sky-blue spark
        ]
      : [
          [34, 108, 238], // deep electric blue
          [72, 168, 255], // electric blue glow
          [198, 236, 255], // hot core, white-blue
        ]
    const LEVELS = 6
    const SPR = 64
    const sprites: HTMLCanvasElement[][] = TINTS.map((rgb, tix) =>
      Array.from({ length: LEVELS }, (_, lv) => {
        const f = lv / (LEVELS - 1) // 0 crisp → 1 soft
        const c = document.createElement('canvas')
        c.width = c.height = SPR
        const g = c.getContext('2d')!
        const grad = g.createRadialGradient(SPR / 2, SPR / 2, 0, SPR / 2, SPR / 2, SPR / 2)
        const peak = 1 - 0.35 * f
        const [r, gg, b] = rgb
        const col = (a: number) => `rgba(${r},${gg},${b},${a.toFixed(3)})`
        // the hot tint carries a white core on dark water
        const core = !light && tix === 2 ? `rgba(240,250,255,${peak.toFixed(3)})` : col(peak)
        if (f > 0.55) {
          // bokeh ring: hollow centre, bright rim, soft skirt
          grad.addColorStop(0, col(0.16 * peak))
          grad.addColorStop(0.34, col(0.42 * peak))
          grad.addColorStop(0.5, core)
          grad.addColorStop(0.62, col(0.5 * peak))
          grad.addColorStop(0.82, col(0.16 * peak))
          grad.addColorStop(1, col(0))
        } else {
          // crisp dot: solid core, quick falloff; softens with f
          const coreEnd = 0.34 - 0.24 * f
          const mid = 0.6 - 0.08 * f
          grad.addColorStop(0, core)
          grad.addColorStop(coreEnd, core)
          grad.addColorStop(mid, col(0.32 * peak))
          grad.addColorStop(1, col(0))
        }
        g.fillStyle = grad
        g.fillRect(0, 0, SPR, SPR)
        return c
      }),
    )

    // --- focal band + per-point character ---------------------------------
    const dSpan = Math.max(1e-4, farD - nearD)
    const dFocus = nearD + 0.42 * dSpan // the crisp band, a touch nearer than mid
    const blurOf = (d: number) => {
      const b = Math.abs(d - dFocus) / (0.62 * dSpan)
      return b > 1 ? 1 : b
    }
    const S2 = cols * rows
    const pmag = new Float32Array(S2) // heavy-tailed magnitude
    const ptint = new Uint8Array(S2)
    const pph = new Float32Array(S2) // twinkle phase (bright points only)
    for (let k = 0; k < S2; k++) {
      // a few big bright beacons, a mass of near-invisible grains
      let mag = Math.pow(Math.random(), 2.6)
      if (Math.random() < 0.035) mag = 0.82 + Math.random() * 0.18
      pmag[k] = mag
      ptint[k] = mag > 0.72 ? 2 : mag > 0.34 ? 1 : 0
      pph[k] = Math.random() * Math.PI * 2
    }

    const px = new Float32Array(3)
    // the far edge's on-screen y (constant — computed from the flat plane):
    // the horizon line the sky glow below is anchored to
    const horizonY = cyf + farY * fitScale
    const twinkleRate = 0.5 + 1.6 * SLOW // bright points breathe; frozen at speed 0

    return (t: number) => {
      // themed base with a quiet top-corners falloff + horizon haze (depth
      // cues, kept away from the bottom where the brightest bokeh lives)
      ctx.fillStyle = baseCss
      ctx.fillRect(0, 0, w, h)
      const vg = ctx.createRadialGradient(w / 2, h * 0.3, Math.min(w, h) * 0.45, w / 2, h * 0.3, Math.hypot(w, h) * 0.62)
      vg.addColorStop(0, 'rgba(0,0,0,0)')
      vg.addColorStop(1, light ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.16)')
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, w, h)
      const hg = ctx.createLinearGradient(0, horizonY - h * 0.1, 0, horizonY + h * 0.06)
      hg.addColorStop(0, 'rgba(0,0,0,0)')
      hg.addColorStop(0.55, light ? 'rgba(51,65,85,0.05)' : 'rgba(56,130,184,0.07)')
      hg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = hg
      ctx.fillRect(0, horizonY - h * 0.1, w, h * 0.16)

      // --- project + draw, far row → near row ------------------------------
      // additive on dark (overlaps glow), plain ink on light paper
      ctx.globalCompositeOperation = light ? 'source-over' : 'lighter'
      for (let j = 0; j < rows; j++) {
        const z = (j / (rows - 1)) * PD
        const rowOff = j * cols
        for (let i = 0; i < cols; i++) {
          const x = (i / (cols - 1) - 0.5) * PW
          const k = rowOff + i
          const hgt = heightAt(x, z, t)
          project(x, hgt * AMP, z, px, 0)
          const scrX = cxf + px[0]! * fitScale
          const scrY = cyf + px[1]! * fitScale
          if (scrX < -34 || scrX > w + 34 || scrY < -34 || scrY > h + 34) continue
          const d = px[2]!
          const fog = 1 - (d - nearD) / dSpan // 1 near → 0 far
          if (fog < 0.1 && (i + j) % 2 === 1) continue // thin out only the deepest haze
          const blur = blurOf(d)
          const mag = pmag[k]!
          // size: near points larger, blur inflates the bokeh, magnitude
          // spans almost-invisible grains to big bright beacons
          const rBase = 1.3 + 1.75 * fog
          const r = rBase * (0.6 + 1.9 * mag) * (1 + 1.15 * blur)
          let alpha = (0.1 + 0.6 * mag) * (0.42 + 0.58 * fog) * (1 - 0.4 * blur)
          if (mag > 0.72) alpha *= 0.8 + 0.2 * Math.sin(t * twinkleRate + pph[k]!)
          if (alpha <= 0.012) continue
          const lv = Math.min(LEVELS - 1, Math.round(blur * (LEVELS - 1)))
          ctx.globalAlpha = Math.min(1, alpha)
          ctx.drawImage(sprites[ptint[k]]![lv]!, scrX - r, scrY - r, r * 2, r * 2)
        }
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}

// ---------------------------------------------------------------------------
// Ripple — rain falling on a still puddle, seen from directly above. Drops
// land at random points; each rings out 2–4 decelerating circles that fade
// as they widen, with a bright splash dot marking the impact for a beat.
// Most drops are micro-patters (one small quick ring); a few are heavy
// drops with wider, slower ring systems. Rain accumulates on sim time —
// which the speed dial scales, so 0% is a frozen puddle between showers —
// and the factory pre-rolls a few seconds of weather so the first visible
// frame is already developed. The water adopts the theme's background
// colour: dark themes get additive neon-cyan rings over deep water, light
// themes an ink wash on pale paper.
// ---------------------------------------------------------------------------

export function makeRipple(settings: BgSettings): WarmupSceneFactory {
  const speed = numOf(settings.speed, 100) / 100 // 0 = the shower pauses
  const density = numOf(settings.density, 50)
  const tb = themeBgOf(settings)
  const light = tb != null && lumOf(tb) > 0.5
  const BASE: [number, number, number] = tb ?? [7, 12, 20]
  const factory = ((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const SM = Math.min(w, h)
    interface Ring {
      x: number
      y: number
      born: number
      delay: number
      life: number
      maxR: number
      hue: number // 0..1 — cyan ↔ blue
      weight: number // heavy drops draw a touch wider
    }
    const rings: Ring[] = []
    let simT = 0
    let acc = 0
    // real rain is BUSY — dozens of impacts alive at once is what makes a
    // still frame read as a shower (each ring system lives ~2-3s)
    const rate = 2.6 + (density / 100) * 9.4 // drops per sim-second
    const spawn = () => {
      if (rings.length > 220) return // soft cap for dense settings on slow devices
      const x = Math.random() * w
      const y = Math.random() * h
      const hue = Math.random()
      const kind = Math.random()
      if (kind < 0.42) {
        // micro patter: one small quick ring
        rings.push({
          x,
          y,
          born: simT,
          delay: 0,
          life: 1.1 + Math.random() * 0.5,
          maxR: (0.045 + Math.random() * 0.045) * SM,
          hue,
          weight: 0.85,
        })
        return
      }
      const heavy = kind > 0.82
      const n = heavy ? 4 : 2 + (Math.random() < 0.6 ? 1 : 0)
      const life = (heavy ? 3.4 : 2.3) + Math.random() * 0.8
      const maxR = ((heavy ? 0.15 : 0.085) + Math.random() * 0.07) * SM
      for (let i = 0; i < n; i++) {
        rings.push({
          x,
          y,
          born: simT,
          delay: i * (heavy ? 0.34 : 0.27),
          life: life * (1 - i * 0.08),
          maxR: maxR * (1 - i * 0.14),
          hue,
          weight: heavy ? 1.25 : 1,
        })
      }
    }
    const advance = (dt: number) => {
      simT += dt
      acc += dt * rate
      while (acc >= 1) {
        acc -= 1
        spawn()
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]!
        if (simT - r.born > r.delay + r.life) rings.splice(i, 1)
      }
    }
    // pre-roll ~4.5 s of weather on a wall-clock budget, so the first frame
    // a user sees is a puddle already mid-shower, not a dry canvas
    const prerollStart = performance.now()
    while (simT < 4.5 && performance.now() - prerollStart < 350) advance(1 / 30)

    let lastT = -1
    const frame = (t: number) => {
      const dt = lastT < 0 ? 0 : Math.min(0.1, t - lastT)
      lastT = t
      if (dt > 0) advance(dt * speed)
      // the puddle itself
      ctx.fillStyle = `rgb(${BASE[0]},${BASE[1]},${BASE[2]})`
      ctx.fillRect(0, 0, w, h)
      // a soft light pool — ambient sheen on the water
      const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, Math.max(w, h) * 0.75)
      if (light) {
        g.addColorStop(0, 'rgba(255,255,255,0.5)')
        g.addColorStop(1, 'rgba(255,255,255,0)')
      } else {
        g.addColorStop(0, 'rgba(56,110,150,0.2)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
      }
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = light ? 'source-over' : 'lighter'
      for (const r of rings) {
        const age = simT - r.born - r.delay
        if (age < 0) continue // not born yet
        const p = age / r.life
        if (p >= 1) continue
        const ease = 1 - Math.pow(1 - p, 2.3) // decelerating expansion
        const rad = Math.max(1, r.maxR * ease)
        const fade = Math.pow(1 - p, 1.3)
        // per-drop hue: cyan ↔ blue
        const cr = light ? 30 + r.hue * 10 : 120 + r.hue * 60
        const cg = light ? 110 + r.hue * 30 : 200 + r.hue * 30
        const cb = light ? 210 + r.hue * 30 : 250
        const a = fade * (light ? 0.62 : 0.95)
        // halo + core double stroke reads as a wet neon ring on dark water
        ctx.lineWidth = 4.2 * r.weight
        ctx.strokeStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${(a * 0.3).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(r.x, r.y, rad, 0, Math.PI * 2)
        ctx.stroke()
        ctx.lineWidth = 1.5 * r.weight
        ctx.strokeStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(r.x, r.y, rad, 0, Math.PI * 2)
        ctx.stroke()
        // impact splash — a bright dot for the first beat of the first ring
        if (age < 0.5 && r.delay === 0) {
          const sp = 1 - age / 0.5
          const rr = (3 + (1 - sp) * 16) * r.weight
          const sg = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, rr)
          const hot = light ? '255,255,255' : '225,245,255'
          sg.addColorStop(0, `rgba(${hot},${(0.95 * sp).toFixed(3)})`)
          sg.addColorStop(1, `rgba(${hot},0)`)
          ctx.fillStyle = sg
          ctx.beginPath()
          ctx.arc(r.x, r.y, rr, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    return frame
  }) as WarmupSceneFactory
  factory.warmupFrames = 1
  return factory
}

// ---------------------------------------------------------------------------
// Parametric Forms — a spherical-harmonics shell breathing at the exact
// centre of the frame. One deformed sphere (r = R·(1 + Σ aₖ·Yₖ), nine
// low-order terms, coefficients rolled fresh on every build — a cousin of
// the same ball each refresh, per the user's ask) is drawn as a glowing
// lat/long wireframe; 3–4 dimmer nested shells at shrinking scales drift
// on their own slow rotations behind it, giving the layered-jelly contour
// look of the reference. Colour walks the depth axis — deep violet far,
// magenta-pink near — with a wide low-alpha bloom pass so the wires read
// as neon, a glassy membrane gradient behind everything, and sparse
// bright node dots on the near side. ALWAYS centred (phones included).
// Motion (spin, wobble, coefficient breathing) rides the speed dial;
// 0% holds the form still.
// ---------------------------------------------------------------------------

export function makeParametric(settings: BgSettings): SceneFactory {
  const speed = numOf(settings.speed, 100) / 100 // 0 = the form holds still
  const density = numOf(settings.density, 50)
  const tb = themeBgOf(settings)
  const light = tb != null && lumOf(tb) > 0.5
  const baseCss = tb ? `rgb(${tb[0]},${tb[1]},${tb[2]})` : '#0d0d1f'
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    // ---- per-refresh parameters -------------------------------------------
    // nine low-order spherical-harmonic terms with rolled coefficients,
    // bounded so the form stays lobed and smooth — 4–6 rounded bulges and
    // dimples, never spikes — each with its own slow breathing phase
    const A_BASE = [
      0.14 + Math.random() * 0.12, // Y20 — polar stretch
      (Math.random() * 2 - 1) * 0.26, // Y22 — big equatorial squash
      (Math.random() * 2 - 1) * 0.18, // Y2-2
      0.08 + Math.random() * 0.1, // Y30
      (Math.random() * 2 - 1) * 0.16, // Y32
      (Math.random() * 2 - 1) * 0.14, // Y3-2
      (Math.random() * 2 - 1) * 0.2, // Y33 — tri-lobed twist
      0.05 + Math.random() * 0.07, // Y40
      (Math.random() * 2 - 1) * 0.12, // Y44 — fine quadrilobe ripple
    ]
    const N_H = A_BASE.length
    const breathPh = Array.from({ length: N_H }, () => Math.random() * Math.PI * 2)
    const breathRt = Array.from({ length: N_H }, () => 0.22 + Math.random() * 0.3)
    const harm = (key: number, ct: number, st: number, phi: number): number => {
      switch (key) {
        case 0:
          return 0.5 * (3 * ct * ct - 1)
        case 1:
          return st * st * Math.cos(2 * phi)
        case 2:
          return st * st * Math.sin(2 * phi)
        case 3:
          return 0.5 * (5 * ct * ct * ct - 3 * ct)
        case 4:
          return st * st * ct * Math.cos(2 * phi)
        case 5:
          return st * st * ct * Math.sin(2 * phi)
        case 6:
          return st * st * st * Math.cos(3 * phi)
        case 7:
          return 0.125 * (35 * ct * ct * ct * ct - 30 * ct * ct + 3)
        default:
          return st * st * st * st * Math.cos(4 * phi)
      }
    }

    // ---- nested shells: the layered contours of the reference ------------
    const nestCount = 3 + Math.floor(Math.random() * 2)
    const nests = Array.from({ length: nestCount }, (_, i) => ({
      scale: (0.93 - i * 0.08) * (0.97 + Math.random() * 0.05),
      rotY: Math.random() * Math.PI * 2,
      tiltX: (Math.random() - 0.5) * 0.5,
      spinMul: 0.45 + Math.random() * 0.75, // its own slow rotation
      alpha: 0.26 - i * 0.05,
    }))

    // ---- wire density ------------------------------------------------------
    const LAT = 13 + Math.round((density / 100) * 9)
    const LON = 18 + Math.round((density / 100) * 16)
    const NLAT = 9
    const NLON = 14

    // ---- framing: ALWAYS dead-centre (the phone requirement) --------------
    const cx = w / 2
    const cyc = h / 2
    const Rs = 0.38 * Math.min(w, h) // undeformed radius; lobes reach ~1.3×
    const D = 3.0 // camera distance, world units (ball radius ≈ 1)
    const F = 3.0 // focal length — noticeable perspective, like the reference

    // depth colour ramp: deep violet far → magenta-pink near, quantised into
    // stroke buckets so the frame loop builds no colour strings
    type Rgb = [number, number, number]
    const FAR: Rgb = light ? [79, 56, 178] : [77, 68, 224]
    const MID: Rgb = light ? [124, 58, 237] : [139, 92, 246]
    const NEAR: Rgb = light ? [199, 44, 168] : [244, 114, 208]
    const BUCKETS = 12
    const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ]
    const rampAt = (tc: number): Rgb => (tc < 0.5 ? mix(FAR, MID, tc * 2) : mix(MID, NEAR, (tc - 0.5) * 2))
    const css = (c: Rgb, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`
    const mainStrokes: string[] = []
    const glowStrokes: string[] = []
    const nestStrokes = nests.map((n) => [] as string[])
    for (let b = 0; b < BUCKETS; b++) {
      const tc = b / (BUCKETS - 1)
      const c = rampAt(tc)
      mainStrokes.push(css(c, (light ? 0.2 : 0.3) + (light ? 0.5 : 0.6) * tc))
      glowStrokes.push(css(c, (light ? 0.05 : 0.11) + 0.09 * tc))
      for (let si = 0; si < nests.length; si++) {
        nestStrokes[si]!.push(css(c, nests[si]!.alpha * (0.65 + 0.35 * tc)))
      }
    }

    // ---- motion (all rates ride `speed`; 0 freezes everything) ------------
    const spinY = 0.1 * speed
    const wobbleX = 0.033 * speed
    const breathRate = 0.3 * speed
    const baseTilt = 0.32 // resting tilt toward the viewer

    // scratch projection buffers (sized for the main grid, the largest)
    const pxs = new Float32Array(LAT * LON)
    const pys = new Float32Array(LAT * LON)
    const pzs = new Float32Array(LAT * LON)

    /** draw one shell's wireframe (lat rings + lon lines) into the scratch
     *  buffers, then stroke it: a wide dim glow pass first (optional), the
     *  crisp wires on top, sparse node dots last (optional). */
    const drawWire = (
      scale: number,
      rotY: number,
      rotX: number,
      latN: number,
      lonN: number,
      strokes: string[],
      glow: boolean,
      dots: boolean,
      aNow: number[],
    ) => {
      const cyv = Math.cos(rotY)
      const syv = Math.sin(rotY)
      const cxv = Math.cos(rotX)
      const sxv = Math.sin(rotX)
      for (let j = 0; j < latN; j++) {
        const th = (Math.PI * (j + 0.5)) / latN
        const ct = Math.cos(th)
        const st = Math.sin(th)
        for (let i = 0; i < lonN; i++) {
          const ph = (Math.PI * 2 * i) / lonN
          let r = scale
          for (let k = 0; k < N_H; k++) r += scale * aNow[k]! * harm(k, ct, st, ph)
          const x0 = r * st * Math.cos(ph)
          const y0 = r * ct
          const z0 = r * st * Math.sin(ph)
          // spin around Y, then tilt around X
          const x1 = x0 * cyv + z0 * syv
          const z1 = z0 * cyv - x0 * syv
          const y2 = y0 * cxv - z1 * sxv
          const z2 = y0 * sxv + z1 * cxv
          const kf = F / (D - z2)
          const idx = j * lonN + i
          pxs[idx] = cx + x1 * kf * Rs
          pys[idx] = cyc - y2 * kf * Rs
          pzs[idx] = z2
        }
      }
      const seg = (a: number, b: number, pass: 0 | 1) => {
        let tc = ((pzs[a]! + pzs[b]!) * 0.5 + 1.35) / 2.7
        if (tc < 0) tc = 0
        else if (tc > 1) tc = 1
        const bkt = Math.min(BUCKETS - 1, Math.round(tc * (BUCKETS - 1)))
        ctx.strokeStyle = pass === 1 ? glowStrokes[bkt]! : strokes[bkt]!
        ctx.lineWidth = pass === 1 ? 3.4 : 0.55 + 0.8 * tc
        ctx.beginPath()
        ctx.moveTo(pxs[a]!, pys[a]!)
        ctx.lineTo(pxs[b]!, pys[b]!)
        ctx.stroke()
      }
      // glow halo pass first — the neon bloom under the crisp wires
      if (glow) {
        for (let j = 0; j < latN; j++) {
          for (let i = 0; i < lonN; i++) seg(j * lonN + i, j * lonN + ((i + 1) % lonN), 1)
        }
        for (let i = 0; i < lonN; i++) {
          for (let j = 0; j < latN - 1; j++) seg(j * lonN + i, (j + 1) * lonN + i, 1)
        }
      }
      // crisp wires
      for (let j = 0; j < latN; j++) {
        for (let i = 0; i < lonN; i++) seg(j * lonN + i, j * lonN + ((i + 1) % lonN), 0)
      }
      for (let i = 0; i < lonN; i++) {
        for (let j = 0; j < latN - 1; j++) seg(j * lonN + i, (j + 1) * lonN + i, 0)
      }
      // sparse bright node dots on the near side (a reference detail)
      if (dots) {
        for (let j = 0; j < latN; j++) {
          for (let i = 0; i < lonN; i++) {
            if ((i + j) % 3 !== 0) continue
            const idx = j * lonN + i
            let tc = (pzs[idx]! + 1.35) / 2.7
            if (tc < 0.62 || tc > 1) continue
            const c = rampAt(tc)
            ctx.fillStyle = light
              ? css(c, 0.75 * tc)
              : `rgba(${Math.min(255, c[0] + 60) | 0},${Math.min(255, c[1] + 60) | 0},${Math.min(255, c[2] + 40) | 0},${(0.8 * tc).toFixed(3)})`
            ctx.beginPath()
            ctx.arc(pxs[idx]!, pys[idx]!, 0.9 + 0.7 * tc, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
    }

    const aNow: number[] = new Array(N_H).fill(0)
    return (t: number) => {
      ctx.fillStyle = baseCss
      ctx.fillRect(0, 0, w, h)
      // vignette — the corners fall off like the reference
      const vg = ctx.createRadialGradient(cx, cyc, Rs, cx, cyc, Math.hypot(w, h) * 0.62)
      vg.addColorStop(0, 'rgba(0,0,0,0)')
      vg.addColorStop(1, light ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.22)')
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, w, h)
      // glassy membrane behind the form — the faint jelly fill
      const mg = ctx.createRadialGradient(cx, cyc, 0, cx, cyc, Rs * 1.12)
      mg.addColorStop(0, light ? 'rgba(124,58,237,0.05)' : 'rgba(139,92,246,0.12)')
      mg.addColorStop(0.7, light ? 'rgba(124,58,237,0.02)' : 'rgba(91,79,216,0.05)')
      mg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = mg
      ctx.fillRect(0, 0, w, h)
      const mg2 = ctx.createRadialGradient(cx + Rs * 0.22, cyc + Rs * 0.18, 0, cx + Rs * 0.22, cyc + Rs * 0.18, Rs * 0.8)
      mg2.addColorStop(0, light ? 'rgba(199,44,168,0.04)' : 'rgba(244,114,208,0.09)')
      mg2.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = mg2
      ctx.fillRect(0, 0, w, h)

      // breathing coefficients — shared by every shell (same form, own spins)
      for (let k = 0; k < N_H; k++) {
        aNow[k] = A_BASE[k]! * (1 + 0.1 * Math.sin(t * breathRate * breathRt[k]! + breathPh[k]!))
      }
      ctx.lineCap = 'round'
      // nested shells first (they sit behind), main shell on top
      for (let si = 0; si < nests.length; si++) {
        const nst = nests[si]!
        drawWire(
          nst.scale,
          nst.rotY + t * spinY * nst.spinMul,
          nst.tiltX + Math.sin(t * wobbleX * 2 + nst.rotY) * 0.2,
          NLAT,
          NLON,
          nestStrokes[si]!,
          false,
          false,
          aNow,
        )
      }
      drawWire(1, t * spinY, baseTilt + Math.sin(t * wobbleX) * 0.16, LAT, LON, mainStrokes, true, true, aNow)
    }
  }
}

// ---------------------------------------------------------------------------
// Fluid Mechanics — an actual fluid solver (Stam's "stable fluids"):
// a velocity + dye grid, semi-Lagrangian advection, a pressure projection
// each frame so the field stays incompressible, and orbiting vortex
// stirrers that inject spin and dye. Four things make it read as REAL
// fluid rather than a swirl toy:
//   • dye buoyancy — dye is warm and rises, so arms curl upward into
//     mushroom plumes the way smoke does under glass
//   • vorticity confinement — the small-scale curl that grid diffusion
//     eats is re-injected each frame, so vortices stay crisp and alive
//   • OPEN boundaries — dye and velocity flow straight off screen (no
//     walls, no pile-up at the rim); anything that leaves is gone
//   • ~100k cells (3× the old grid) with a cheaper solve — the user's
//     explicit trade: accuracy sacrificed for resolution. Plain
//     semi-Lagrangian dye (no MacCormack corrector) and 12 pressure
//     sweeps instead of 26 — at this grid size the filaments come out
//     fine-grained and smooth, and the upscale is nearly 1:1 on phones.
// Rendered at grid resolution and upscaled — the upscale is the antialias.
// The sim itself advances at most ~34 Hz even on a 60 Hz display: the
// motion is slow enough that nobody can tell, and a phone's battery can.
// ---------------------------------------------------------------------------

export function makeFluidMechanics(settings: BgSettings): WarmupSceneFactory {
  const speed = numOf(settings.speed, 60) / 100 // 0 = the water holds still
  const density = numOf(settings.density, 50)
  const tb = themeBgOf(settings)
  const light = tb != null && lumOf(tb) > 0.5
  // dye composites over the theme's background colour: dark themes get the
  // classic glow (dye lifts toward white), light themes a watercolour ink
  // wash (dye darkens toward its own hue). No themeBg → the curated deep
  // blue-black base, byte-identical to the look the preview clips ship.
  const BASE: [number, number, number] = tb ?? [6, 10, 18]
  const factory = ((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    // --- sim grid, shaped like the viewport: a portrait phone would only
    //     ever see the middle third of a fixed 128x80 grid ------------------
    //     ~100k cells (3× the old 32k): filaments land at ~2-3 px on a phone
    //     canvas — the grain of the coarse grid is gone, which is the
    //     point of the accuracy-for-resolution trade documented above. -----
    const AR = Math.max(0.3, Math.min(4, w / Math.max(1, h)))
    const N = Math.max(48, Math.round(Math.sqrt(100000 * AR)))
    const M = Math.max(48, Math.round(N / AR))
    const S = N * M
    // detail scale: velocities/radii are tuned at ~10k cells; keep the same
    // visual sizes when the grid is finer
    const K = Math.sqrt(S / 10240)
    const u = new Float32Array(S)
    const v = new Float32Array(S)
    const u2 = new Float32Array(S)
    const v2 = new Float32Array(S)
    const dye = [new Float32Array(S), new Float32Array(S), new Float32Array(S)]
    // scratch target for the dye advection (read current, write scratch,
    // swap — an in-place update would read cells this step already rewrote)
    const dyeN = [new Float32Array(S), new Float32Array(S), new Float32Array(S)]
    const pr = new Float32Array(S)
    const dv = new Float32Array(S)
    const curl = new Float32Array(S)

    const at = (x: number, y: number) => y * N + x
    const clampI = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n)

    /** bilinear sample of a field at float grid coordinates */
    const sample = (f: Float32Array, x: number, y: number) => {
      const xi = clampI(Math.floor(x), 0, N - 1)
      const yi = clampI(Math.floor(y), 0, M - 1)
      const xj = clampI(xi + 1, 0, N - 1)
      const yj = clampI(yi + 1, 0, M - 1)
      const fx = x - xi
      const fy = y - yi
      const a = f[at(xi, yi)] * (1 - fx) + f[at(xj, yi)] * fx
      const b = f[at(xi, yj)] * (1 - fx) + f[at(xj, yj)] * fx
      return a * (1 - fy) + b * fy
    }

    // --- stirrers: slowly drifting vortices on a jittered grid so the
    //     whole frame is covered — no empty halves -------------------------
    const PALETTE: [number, number, number][] = [
      [56, 189, 248], // cyan
      [129, 140, 248], // indigo
      [167, 139, 250], // violet
      [45, 212, 191], // teal
      [251, 146, 60], // one warm ember note
    ]
    const count = 5 + Math.round((density / 100) * 5)
    const cols = Math.max(2, Math.round(Math.sqrt(count * AR)))
    const rows = Math.max(1, Math.ceil(count / cols))
    const stir: {
      col: [number, number, number]
      ax: number
      ay: number
      ar: number
      ph: number
      om: number
      gw: number
      spin: number
      emit: number
    }[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (stir.length >= count) break
        stir.push({
          col: PALETTE[stir.length % PALETTE.length],
          ax: (c + 0.5) / cols + (Math.random() - 0.5) * 0.18,
          ay: (r + 0.5) / rows + (Math.random() - 0.5) * 0.18,
          ar: 0.06 + Math.random() * 0.08, // slow drift orbit
          ph: Math.random() * Math.PI * 2,
          om: (0.04 + Math.random() * 0.06) * (Math.random() < 0.5 ? -1 : 1),
          gw: (12 + Math.random() * 7) * K, // vortex radius in cells — big enough to read
          spin: (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.5),
          emit: 1.0 + Math.random() * 0.6,
        })
      }
    }

    // --- render target: grid-res offscreen canvas, upscaled on draw --------
    // border falloff: the last few cells fade out so dye that reaches the
    // rim DISSOLVES past the frame instead of being clipped mid-brightness
    // (the open boundary already drains it; this is the visual soft landing)
    const edgeFade = new Float32Array(S)
    for (let y = 0; y < M; y++) {
      const fy = Math.min(y, M - 1 - y) / 4
      for (let x = 0; x < N; x++) {
        const fx = Math.min(x, N - 1 - x) / 4
        const f = Math.min(1, Math.min(fx, fy))
        edgeFade[y * N + x] = f < 0 ? 0 : f > 1 ? 1 : f
      }
    }
    const off = document.createElement('canvas')
    off.width = N
    off.height = M
    const octx = off.getContext('2d')!
    const img = octx.createImageData(N, M)
    let simT = 0
    let lastT = -1
    let primed = false
    let lastMaxVel = 4 // for the CFL guard (updated every advance)

    const advance = (dtRaw: number) => {
      // CFL guard for the MacCormack dye advection below: 2nd-order
      // advection is only stable while a parcel moves < ~1 cell per step.
      // Velocities are hard-capped (energy ceiling) and dt is clamped
      // against the fastest cell, so the scheme can never ring.
      const dt = Math.min(dtRaw, 0.9 / Math.max(lastMaxVel, 4))
      simT += dt
      // time-based decays so the look is frame-rate independent. Dye fades a
      // touch faster than the old MacCormack build did: without the
      // corrector, advection diffuses slightly, and the quicker turnover
      // keeps long-open tabs from collapsing into fog
      const vDecay = Math.pow(0.9995, dt / 0.0167) // rotation persists between pulses
      const dyeDecay = Math.pow(0.9985, dt / 0.0167)
      // 1) forces + dye injection ----------------------------------------
      // velocities stay GENTLE (≤ ~1 cell/step): fast fields make the
      // semi-Lagrangian back-trace sample across several cells and the
      // numerical diffusion turns the whole thing into gradient mush.
      // The dye source is a SMALL PATCH OFFSET from the vortex centre —
      // an axisymmetric source rotating in place looks like a static blob;
      // an offset stream gets wrapped into visible spiral arms. Emission is
      // PULSED (staggered per stirrer) so fresh arms keep being drawn and
      // the scene never decays into uniform mush on a long-open tab.
      for (const s of stir) {
        const ang = s.ph + simT * s.om * 4 // slow drift: a vortex must
        // sit and chew, not sweep
        const gx = (s.ax + Math.cos(ang) * s.ar) * N
        const gy = (s.ay + Math.sin(ang) * s.ar) * M
        const x0 = clampI(Math.floor(gx - s.gw), 1, N - 2)
        const x1 = clampI(Math.ceil(gx + s.gw), 1, N - 2)
        const y0 = clampI(Math.floor(gy - s.gw), 1, M - 2)
        const y1 = clampI(Math.ceil(gy + s.gw), 1, M - 2)
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const dx = x - gx
            const dy = y - gy
            const d = Math.hypot(dx, dy)
            if (d > s.gw || d < 0.001) continue
            const fall = (1 - d / s.gw) ** 2
            const i = at(x, y)
            u[i] += (-dy / d) * s.spin * 42 * K * fall * dt
            v[i] += (dx / d) * s.spin * 42 * K * fall * dt
          }
        }
        // 9s pulse cycle, 6s duty, phase-staggered. During the PRIMING
        // window (which the pre-roll covers) emission is continuous —
        // broad coverage fast, so the opening frame is developed water.
        // Priming stays SHORT: longer continuous emission over-saturates
        // the field and the long-run look collapses into fog. After
        // priming, emission is also STROBED (~0.5s bursts): a continuous
        // stream wraps into an Archimedean spiral whose turns sit closer
        // than a grid cell and merge into a blob; discrete bursts become
        // separate comet arms the vortex flings around — that is what
        // makes the rotation READ.
        const emitting = simT < 6 || (simT + s.ph * 1.6) % 9 < 6
        if (emitting && ((simT * 1.25 + s.ph * 2.1) % 1) < 0.5) {
          const sx = gx + s.gw * 0.45 // on the fast side of the spin
          const sy = gy
          const rDye = 3.2 * K
          const ix0 = clampI(Math.floor(sx - rDye), 1, N - 2)
          const ix1 = clampI(Math.ceil(sx + rDye), 1, N - 2)
          const iy0 = clampI(Math.floor(sy - rDye), 1, M - 2)
          const iy1 = clampI(Math.ceil(sy + rDye), 1, M - 2)
          for (let y = iy0; y <= iy1; y++) {
            for (let x = ix0; x <= ix1; x++) {
              const dd = Math.hypot(x - sx, y - sy)
              if (dd > rDye) continue
              const wq = (1 - dd / rDye) ** 2
              const i = at(x, y)
              const e = s.emit * 6 * wq * dt
              dye[0][i] += (s.col[0] / 255) * e
              dye[1][i] += (s.col[1] / 255) * e
              dye[2][i] += (s.col[2] / 255) * e
            }
          }
        }
      }

      // 1b) buoyancy — dye is warm and rises, GENTLY. This one body force
      //     is what separates "fluid in gravity" from a zero-g swirl tank:
      //     plumes lift and curl over like smoke under glass. Kept clearly
      //     weaker than the vortex wrap speed — buoyancy that rivals the
      //     spin strips the arms off the vortices before they can wrap,
      //     and the scene decays into vertical smear.
      for (let i = 0; i < S; i++) {
        const d = dye[0][i] + dye[1][i] + dye[2][i]
        if (d > 0.02) v[i] -= 0.55 * Math.min(d, 1.2) * dt
      }

      // 2) advect velocity through itself (semi-Lagrangian) ---------------
      for (let y = 1; y < M - 1; y++) {
        for (let x = 1; x < N - 1; x++) {
          const i = at(x, y)
          const bx = x - u[i] * dt
          const by = y - v[i] * dt
          u2[i] = sample(u, bx, by)
          v2[i] = sample(v, bx, by)
        }
      }
      u.set(u2)
      v.set(v2)

      // rotation dissipation (time-based) + energy ceiling: vortices may
      // spin hard enough to read, never hard enough to destabilize the
      // advection or smear dye across cells in one step
      let maxVel = 0
      for (let i = 0; i < S; i++) {
        let uv = u[i] * vDecay
        let vv = v[i] * vDecay
        if (uv > 22) uv = 22
        else if (uv < -22) uv = -22
        if (vv > 22) vv = 22
        else if (vv < -22) vv = -22
        u[i] = uv
        v[i] = vv
        const a = uv < 0 ? -uv : uv
        const b = vv < 0 ? -vv : vv
        if (a > maxVel) maxVel = a
        if (b > maxVel) maxVel = b
      }
      lastMaxVel = maxVel

      // 2b) vorticity confinement (Fedkiw) — measure the curl everywhere,
      //     then push each cell along the gradient of |curl| so the
      //     small vortices the grid numerically diffuses away are fed
      //     back. The plain semi-Lagrangian dye at this resolution diffuses
      //     noticeably, so the confinement runs STRONG (eps 13, up from 8)
      //     to keep plumes curling into filaments instead of puffing into
      //     fBm-looking clouds.
      for (let y = 1; y < M - 1; y++) {
        for (let x = 1; x < N - 1; x++) {
          const i = at(x, y)
          curl[i] =
            (v[at(x + 1, y)] - v[at(x - 1, y)]) * 0.5 -
            (u[at(x, y + 1)] - u[at(x, y - 1)]) * 0.5
        }
      }
      const epsC = 13 * K
      for (let y = 2; y < M - 2; y++) {
        for (let x = 2; x < N - 2; x++) {
          const i = at(x, y)
          const gx = (Math.abs(curl[at(x + 1, y)]) - Math.abs(curl[at(x - 1, y)])) * 0.5
          const gy = (Math.abs(curl[at(x, y + 1)]) - Math.abs(curl[at(x, y - 1)])) * 0.5
          const len = Math.sqrt(gx * gx + gy * gy) + 1e-5
          const w = curl[i]!
          u[i] += (epsC * w * (gy / len)) * dt
          v[i] -= (epsC * w * (gx / len)) * dt
        }
      }

      // 3) pressure projection — incompressibility is what makes it swirl
      //    like a fluid instead of mushing like noise. 12 Gauss–Seidel
      //    sweeps (down from 26 on the old coarse grid): the accuracy
      //    sacrificed for resolution, per the trade this build makes ——
      //    at 3× the cells the residual divergence per screen distance is
      //    still smaller than the old solve's
      for (let y = 1; y < M - 1; y++) {
        for (let x = 1; x < N - 1; x++) {
          const i = at(x, y)
          dv[i] = -0.5 * (u[at(x + 1, y)] - u[at(x - 1, y)] + v[at(x, y + 1)] - v[at(x, y - 1)])
        }
      }
      pr.fill(0)
      for (let it = 0; it < 12; it++) {
        for (let y = 1; y < M - 1; y++) {
          for (let x = 1; x < N - 1; x++) {
            const i = at(x, y)
            pr[i] = (dv[i] + pr[at(x - 1, y)] + pr[at(x + 1, y)] + pr[at(x, y - 1)] + pr[at(x, y + 1)]) * 0.25
          }
        }
      }
      for (let y = 1; y < M - 1; y++) {
        for (let x = 1; x < N - 1; x++) {
          const i = at(x, y)
          u[i] -= 0.5 * (pr[at(x + 1, y)] - pr[at(x - 1, y)])
          v[i] -= 0.5 * (pr[at(x, y + 1)] - pr[at(x, y - 1)])
        }
      }

      // 3b) OPEN boundaries: copy the rim velocities outward (zero-gradient
      //     outflow) so the edges behave as free exits, not walls. Dye that
      //     reaches the rim advects straight off screen — no collisions, no
      //     pile-up ridge along the border; material that leaves is simply
      //     gone (the open back-trace below zeroes it).
      for (let y = 0; y < M; y++) {
        u[at(0, y)] = u[at(1, y)]
        v[at(0, y)] = v[at(1, y)]
        u[at(N - 1, y)] = u[at(N - 2, y)]
        v[at(N - 1, y)] = v[at(N - 2, y)]
      }
      for (let x = 0; x < N; x++) {
        u[at(x, 0)] = u[at(x, 1)]
        v[at(x, 0)] = v[at(x, 1)]
        u[at(x, M - 1)] = u[at(x, M - 2)]
        v[at(x, M - 1)] = v[at(x, M - 2)]
      }

      // 4) advect dye — plain semi-Lagrangian (the accuracy given up for
      //    the 3× finer grid): one bilinear back-trace per cell and channel,
      //    into a scratch buffer, then swap. OPEN boundary: a back-trace
      //    that lands outside the grid returns zero — the parcel flowed off
      //    screen and vanished, exactly like water leaving the frame of a
      //    shot. The border ring is processed too (its traces mostly exit,
      //    so the rim drains instead of collecting a bright edge).
      for (let c = 0; c < 3; c++) {
        const d = dye[c]!
        const n = dyeN[c]!
        for (let y = 0; y < M; y++) {
          for (let x = 0; x < N; x++) {
            const i = y * N + x
            const bx = x - u[i]! * dt
            const by = y - v[i]! * dt
            if (bx < 0 || bx > N - 1 || by < 0 || by > M - 1) {
              n[i] = 0
              continue
            }
            const xi = Math.floor(bx)
            const yi = Math.floor(by)
            const xj = xi + 1 <= N - 1 ? xi + 1 : xi
            const yj = yi + 1 <= M - 1 ? yi + 1 : yi
            const fx = bx - xi
            const fy = by - yi
            const v00 = d[yi * N + xi]!
            const v10 = d[yi * N + xj]!
            const v01 = d[yj * N + xi]!
            const v11 = d[yj * N + xj]!
            const a0 = v00 + (v10 - v00) * fx
            const a1 = v01 + (v11 - v01) * fx
            n[i] = (a0 + (a1 - a0) * fy) * dyeDecay
          }
        }
        // swap: dye[c] becomes the freshly advected field
        const tmp = dye[c]!
        dye[c] = dyeN[c]!
        dyeN[c] = tmp
      }
    }

    // pre-roll: simulate ahead so the first visible frame is developed
    // water, not blank — but on a WALL-CLOCK BUDGET. The finer grid solves
    // one advance in ~20-40 ms; the budget covers what it covers and the
    // rest is finished lazily — one catch-up advance per painted frame (the
    // wake-up motion is indistinguishable from live speed), so the scene
    // keeps developing after it is already on screen.
    const PREROLL_TARGET = 240 // advances × 0.028 ≈ 6.7 sim-seconds
    const prerollStart = performance.now()
    let prerolled = 0
    while (prerolled < PREROLL_TARGET && performance.now() - prerollStart < 1000) {
      advance(0.028)
      prerolled++
    }
    let lazyLeft = PREROLL_TARGET - prerolled

    // 5) render: tonemapped dye over the base, upscaled with high-quality
    //    smoothing. The rim cells drain naturally under the open boundary
    //    (their back-traces exit the grid), so no edge copying is needed —
    //    off-screen really is off-screen.
    const render = () => {
      const data = img.data
      for (let i = 0; i < S; i++) {
        // 1.6× tonemap lift: the dye reads mid-bright without amplifying
        // the faint advection noise into visible grain
        const ef = edgeFade[i]!
        const d0 = dye[0][i]! * ef
        const d1 = dye[1][i]! * ef
        const d2 = dye[2][i]! * ef
        const a0 = (1.6 * d0) / (1 + 1.6 * d0)
        const a1 = (1.6 * d1) / (1 + 1.6 * d1)
        const a2 = (1.6 * d2) / (1 + 1.6 * d2)
        const k = i * 4
        if (light) {
          // watercolour ink: each channel blends toward a hue-preserving
          // dark target (the dye's own colour ratios, deepened) — colour
          // washes ON the light base instead of blowing out to white
          const I = d0 + d1 + d2
          if (I > 1e-4) {
            const inkR = (d0 / I) * 340
            const inkG = (d1 / I) * 340
            const inkB = (d2 / I) * 340
            data[k] = BASE[0] + (inkR - BASE[0]) * a0
            data[k + 1] = BASE[1] + (inkG - BASE[1]) * a1
            data[k + 2] = BASE[2] + (inkB - BASE[2]) * a2
          } else {
            data[k] = BASE[0]
            data[k + 1] = BASE[1]
            data[k + 2] = BASE[2]
          }
        } else {
          // glow: dye lifts toward white over the (dark) base — this is the
          // classic look, kept byte-compatible with the shipped preview clip
          data[k] = BASE[0] + 235 * a0
          data[k + 1] = BASE[1] + 235 * a1
          data[k + 2] = BASE[2] + 235 * a2
        }
        data[k + 3] = 255
      }
      octx.putImageData(img, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(off, 0, 0, w, h)
    }

    const frame = (t: number) => {
      const raw = lastT < 0 ? 0.03 : t - lastT
      if (!primed) {
        // the FIRST call always advances + renders, whatever t it gets —
        // the reduced-motion runner steps t in ~10ms slices that the
        // 34 Hz gate below would skip entirely, leaving a black canvas
        primed = true
        lastT = t
        if (lazyLeft > 0) {
          lazyLeft--
          advance(0.028)
        } else {
          advance(Math.min(0.05, Math.max(0.004, raw * speed)))
        }
        render()
        return
      }
      // sim at ≤ ~34 Hz: on a 60 Hz display every other rAF just keeps the
      // previous frame — the solver is the expensive part and motion this
      // slow looks identical, but the phone does half the work
      if (raw < 0.0295) return
      lastT = t
      if (lazyLeft > 0) {
        // wake-up tail: same cost as a normal frame, sim moves at live
        // speed, the water just finishes filling in
        lazyLeft--
        advance(0.028)
      } else {
        advance(Math.min(0.05, Math.max(0.004, raw * speed)))
      }
      render()
    }
    return frame
  }) as WarmupSceneFactory
  factory.warmupFrames = 110
  return factory
}
