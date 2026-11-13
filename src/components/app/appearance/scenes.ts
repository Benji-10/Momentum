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

// ---------------------------------------------------------------------------
// Bioluminescence — dark water with glowing drifting particles
// ---------------------------------------------------------------------------

export function makeBioluminescence(settings: BgSettings): SceneFactory {
  const speed = (Number(settings.speed) || 100) / 100
  const density = Number(settings.density) ?? 50
  const glow = Number(settings.glow) ?? 60
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
// Particle Fields — a 3D wire terrain. A tight grid of points laid out on a
// plane is displaced by animated 3D value noise (two octaves: the shapes
// morph while the whole field slowly scrolls toward the viewer) and
// projected in perspective from a raised camera. Hairline mesh links along
// BOTH grid axes, depth-fogged, make it read as a technical surface; the
// vertex dots carry the accent — crest highlights plus a few pulsing
// beacons. The framing is auto-fitted (cover) to the projected flat plane,
// so the terrain fills and centres itself on any viewport — phones
// included. The canvas base adopts the theme's background colour; light
// themes flip the whole field to slate ink on paper. A fresh noise lattice
// is rolled on every scene build: each reload grows a different terrain.
// ---------------------------------------------------------------------------

export function makeParticleField(settings: BgSettings): SceneFactory {
  const speed = (Number(settings.speed) || 100) / 100
  const density = Number(settings.density) ?? 45
  const tb = themeBgOf(settings)
  const light = tb != null && lumOf(tb) > 0.5
  const baseCss = tb ? `rgb(${tb[0]},${tb[1]},${tb[2]})` : '#05070c'
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    // --- the grid: tighter with density; rows follow the plane's aspect ----
    const cols = Math.round(30 + (density / 100) * 28) // 30..58 points across
    const PW = 2.35 // plane width, world units
    const PD = 4.4 // plane depth — deep enough that the far edge reads as horizon
    const AMP = 0.36 // hill amplitude
    const rows = Math.max(14, Math.round(((cols * PD) / PW) * 0.62))

    // --- 3D value noise: a random lattice, trilinear + smoothstep ---------
    // rolled per build → a fresh terrain every page load
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
    const F1 = 1.0
    const F2 = 2.1
    const zDrift = 0.14 * speed // terrain flows toward the viewer
    const morph = 0.1 * speed // the field itself slowly changes shape
    /** normalized height at a plane point, roughly -1..1 */
    const heightAt = (x: number, z: number, t: number) => {
      const zz = z + t * zDrift
      let n = noise3(x * F1 + 41.7, zz * F1, t * morph) * 0.68
      n += noise3(x * F2 + 7.3, zz * F2, t * morph * 1.6 + 33.3) * 0.32
      let v = (n - 0.5) * 2.6
      if (v > 1) v = 1
      else if (v < -1) v = -1
      return v
    }

    // --- camera: pitched down, raised and pulled back — a moderate depth
    //     ratio between the near and far edge keeps the near cells from
    //     blowing up to poster size under the perspective divide ----------
    const pitch = 1.08 // ~62°
    const cp = Math.cos(pitch)
    const sp = Math.sin(pitch)
    const camH = 1.35
    const camD = 2.2
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

    // --- framing: the mesh is laid out to FILL the frame — horizon (far
    //     edge) at ~16% height, the near edge pushed BELOW the bottom edge
    //     (so no dead band under the last row), near width overflowing the
    //     sides. Centred by construction on every viewport, and the layout
    //     is computed from the FLAT plane so it never "breathes" ----------
    const fitBuf = new Float32Array(3)
    project(PW / 2, 0, 0, fitBuf, 0)
    const nearX = fitBuf[0]!
    const nearY = fitBuf[1]!
    const nearD = fitBuf[2]!
    project(0, 0, PD, fitBuf, 0)
    const farY = fitBuf[1]!
    const farD = fitBuf[2]!
    // vertical span (near edge 8% PAST the bottom, horizon at 16% height)
    let fitScale = (0.92 * h) / Math.max(0.0001, nearY - farY)
    // width floor: the near rows must overflow the sides
    const fitFloor = (0.64 * w) / Math.max(0.0001, nearX)
    if (fitScale < fitFloor) fitScale = fitFloor
    const cxf = w / 2
    const cyf = 0.16 * h - farY * fitScale
    const dMin = nearD
    const dSpan = Math.max(0.0001, farD - nearD)

    // per-point projected coords + depth + height
    const S = cols * rows
    const sx = new Float32Array(S)
    const sy = new Float32Array(S)
    const dd = new Float32Array(S)
    const hh = new Float32Array(S)

    // beacons: a handful of pulsing accent dots, placed only where the FLAT
    // projection lands comfortably inside the frame (heights wobble the
    // points vertically, so leave generous margins) — a beacon clipped by
    // the viewport reads as a bug, not a design choice
    const beaconCount = Math.max(4, Math.round(S / 260))
    const beacons: { idx: number; ph: number }[] = []
    {
      const cand: number[] = []
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = (i / (cols - 1) - 0.5) * PW
          const z = (j / (rows - 1)) * PD
          project(x, 0, z, fitBuf, 0)
          const bx = cxf + fitBuf[0]! * fitScale
          const by = cyf + fitBuf[1]! * fitScale
          if (bx > w * 0.16 && bx < w * 0.84 && by > h * 0.3 && by < h * 0.72) cand.push(j * cols + i)
        }
      }
      for (let i = 0; i < beaconCount && cand.length > 0; i++) {
        const pick = cand.splice(Math.floor(Math.random() * cand.length), 1)[0]!
        beacons.push({ idx: pick, ph: Math.random() * Math.PI * 2 })
      }
    }

    // palette: silver hairlines + cyan accents on dark, slate ink + teal on
    // light paper
    const LINE = light ? 'rgba(51,65,85,' : 'rgba(148,163,184,'
    const LINE_CREST = light ? 'rgba(8,145,178,' : 'rgba(56,189,248,'
    const DOT = light ? 'rgba(30,41,59,' : 'rgba(226,232,240,'
    const DOT_CREST = light ? 'rgba(8,145,178,' : 'rgba(125,211,252,'
    const BEACON = light ? 'rgba(13,148,136,' : 'rgba(34,211,238,'

    const px = new Float32Array(3)
    // the far edge's on-screen y (constant — computed from the flat plane):
    // the horizon line the sky glow below is anchored to
    const horizonY = cyf + farY * fitScale

    return (t: number) => {
      // themed technical base with a quiet top-corners falloff (kept away
      // from the bottom, where the nearest — brightest — mesh rows live)
      ctx.fillStyle = baseCss
      ctx.fillRect(0, 0, w, h)
      const vg = ctx.createRadialGradient(w / 2, h * 0.3, Math.min(w, h) * 0.45, w / 2, h * 0.3, Math.hypot(w, h) * 0.62)
      vg.addColorStop(0, 'rgba(0,0,0,0)')
      vg.addColorStop(1, light ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.16)')
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, w, h)
      // horizon atmosphere: a faint tinted band at the far edge, so the sky
      // above the mesh reads as distance haze rather than dead space
      const hg = ctx.createLinearGradient(0, horizonY - h * 0.1, 0, horizonY + h * 0.06)
      hg.addColorStop(0, 'rgba(0,0,0,0)')
      hg.addColorStop(0.55, light ? 'rgba(51,65,85,0.05)' : 'rgba(56,130,184,0.07)')
      hg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = hg
      ctx.fillRect(0, horizonY - h * 0.1, w, h * 0.16)

      // --- project every grid point ----------------------------------------
      // rows run far → near; near rows that fall entirely below the frame
      // are skipped (the plane is deliberately pushed past the bottom edge)
      for (let j = 0; j < rows; j++) {
        const z = (j / (rows - 1)) * PD
        const rowOff = j * cols
        for (let i = 0; i < cols; i++) {
          const x = (i / (cols - 1) - 0.5) * PW
          const hgt = heightAt(x, z, t)
          project(x, hgt * AMP, z, px, 0)
          const k = rowOff + i
          sx[k] = cxf + px[0]! * fitScale
          sy[k] = cyf + px[1]! * fitScale
          dd[k] = px[2]!
          hh[k] = hgt
        }
      }

      // --- hairline mesh: links along both axes, depth-fogged --------------
      // NEAR lines are the brightest and slightly thicker (they are the
      // widest apart, so they can afford the weight); distance fades them
      // hard so the compressed far field stays quiet. Crest segments tint
      // cyan — but only in the near half, where the eye can separate them.
      // No geometric LOD: density changes read as tears; the alpha fade IS
      // the level of detail.
      ctx.lineCap = 'round'
      const drawSeg = (a: number, b: number) => {
        const ay = sy[a]!
        const by = sy[b]!
        // cull segments that are entirely well outside the frame (the plane
        // deliberately spills past the bottom edge and the sides)
        if ((ay > h + 60 && by > h + 60) || (ay < -60 && by < -60)) return
        if ((sx[a]! < -60 && sx[b]! < -60) || (sx[a]! > w + 60 && sx[b]! > w + 60)) return
        const dAvg = (dd[a]! + dd[b]!) / 2
        const fog = Math.max(0, 1 - (dAvg - dMin) / dSpan) // 1 near → 0 far
        const hAvg = (hh[a]! + hh[b]!) / 2
        const crest = hAvg > 0.5 && fog > 0.35
        const alpha = (0.13 + 0.5 * Math.pow(fog, 1.45)) * (crest ? 1.3 : 1) * (0.72 + 0.28 * hAvg)
        ctx.strokeStyle = (crest ? LINE_CREST : LINE) + Math.min(0.62, alpha).toFixed(3) + ')'
        ctx.lineWidth = 0.85 + 0.45 * fog
        ctx.beginPath()
        ctx.moveTo(sx[a]!, ay)
        ctx.lineTo(sx[b]!, by)
        ctx.stroke()
      }
      for (let j = 0; j < rows; j++) {
        const rowOff = j * cols
        for (let i = 0; i < cols - 1; i++) drawSeg(rowOff + i, rowOff + i + 1)
      }
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows - 1; j++) drawSeg(j * cols + i, (j + 1) * cols + i)
      }

      // --- vertex dots: near points bigger and brighter ---------------------
      for (let j = 0; j < rows; j++) {
        const rowOff = j * cols
        for (let i = 0; i < cols; i++) {
          const k = rowOff + i
          if (sy[k]! < -40 || sy[k]! > h + 40) continue
          const fog = Math.max(0, 1 - (dd[k]! - dMin) / dSpan)
          if (fog < 0.12 && (i + j) % 2 === 1) continue // sparse far dots
          const crest = hh[k]! > 0.55 && fog > 0.3
          const r = Math.max(0.55, Math.min(2.6, 1.0 + 1.6 * fog))
          const alpha = (0.2 + 0.6 * fog) * (crest ? 1.3 : 1)
          ctx.fillStyle = (crest ? DOT_CREST : DOT) + Math.min(0.95, alpha).toFixed(3) + ')'
          ctx.beginPath()
          ctx.arc(sx[k]!, sy[k]!, crest ? r * 1.3 : r, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // --- beacons: pulsing accent lights on the surface --------------------
      for (const bc of beacons) {
        const k = bc.idx
        const pulse = 0.45 + 0.55 * Math.sin(t * 1.4 + bc.ph)
        const fog = 1 - (dd[k]! - dMin) / dSpan
        const a = (0.3 + 0.6 * pulse) * (0.35 + 0.65 * fog)
        const r = 1.5 + 1.3 * pulse
        const halo = r * (3 + pulse * 3)
        const g = ctx.createRadialGradient(sx[k]!, sy[k]!, 0, sx[k]!, sy[k]!, halo)
        g.addColorStop(0, BEACON + (a * 0.8).toFixed(3) + ')')
        g.addColorStop(1, BEACON + '0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(sx[k]!, sy[k]!, halo, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = BEACON + Math.min(1, a + 0.25).toFixed(3) + ')'
        ctx.beginPath()
        ctx.arc(sx[k]!, sy[k]!, r, 0, Math.PI * 2)
        ctx.fill()
      }
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
  const speed = (Number(settings.speed) || 60) / 100
  const density = Number(settings.density) ?? 50
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
