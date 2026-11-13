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
// Particle Fields — a crisp technical starfield. Two parallax depth
// layers of sharp dots drifting on a quiet flow field, WITH hairline
// constellation links between nearby near-layer particles — the links are
// what give it the "network / telemetry" character (distance-faded, never
// busy: only close pairs connect, and the far layer stays unlinked so the
// depth read survives). The canvas base adopts the theme's background
// colour; on light themes the dots flip to dark ink so the field reads on
// paper too.
// ---------------------------------------------------------------------------

export function makeParticleField(settings: BgSettings): SceneFactory {
  const speed = (Number(settings.speed) || 100) / 100
  const density = Number(settings.density) ?? 45
  const tb = themeBgOf(settings)
  const light = tb != null && lumOf(tb) > 0.5
  const baseCss = tb ? `rgb(${tb[0]},${tb[1]},${tb[2]})` : '#05070c'
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const count = Math.round(30 + (density / 100) * 110)
    // every third particle joins the far layer: smaller, dimmer, slower —
    // the depth gap is what makes the field read as space, not plankton
    const parts = Array.from({ length: count }, (_, i) => {
      const far = i % 3 === 0
      return {
        far,
        x: Math.random() * w,
        y: Math.random() * h,
        // the depth gap is deliberately wide: at phone size the two layers
        // must read as foreground vs background, not one uniform grain
        r: far ? 0.55 + Math.random() * 0.3 : 1.5 + Math.random() * 0.8,
        // a handful of near-layer "navigation stars" in accent cyan
        accent: !far && i % 17 === 0,
      }
    })
    // link pass works on the near layer only — precomputed once, no per-frame
    // filtering
    const near = parts.filter((p) => !p.far)
    // link radius tuned to the viewport: local clusters on a phone, wider
    // constellations on a desktop
    const linkR = Math.min(130, Math.max(72, Math.min(w, h) * 0.16))
    const linkR2 = linkR * linkR
    const field = (x: number, y: number, t: number) =>
      Math.sin(x * 0.0016 + t * 0.18) * 1.5 +
      Math.cos(y * 0.0021 - t * 0.14) * 1.5 +
      Math.sin((x + y) * 0.0009 + t * 0.1)
    return (t: number) => {
      // themed technical base with a quiet corner falloff — no wash, no bloom
      ctx.fillStyle = baseCss
      ctx.fillRect(0, 0, w, h)
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62)
      vg.addColorStop(0, 'rgba(0,0,0,0)')
      vg.addColorStop(1, light ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.28)')
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, w, h)

      for (const p of parts) {
        const a = field(p.x, p.y, t)
        const s = (p.far ? 0.45 : 1) * speed
        p.x += Math.cos(a) * 0.55 * s
        p.y += Math.sin(a) * 0.55 * s
        if (p.x < -12) p.x = w + 12
        if (p.x > w + 12) p.x = -12
        if (p.y < -12) p.y = h + 12
        if (p.y > h + 12) p.y = -12
      }

      // constellation links — hairline, distance-faded, UNDER the dots
      ctx.lineWidth = 0.75
      for (let i = 0; i < near.length; i++) {
        const a = near[i]!
        for (let j = i + 1; j < near.length; j++) {
          const b = near[j]!
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 > linkR2) continue
          const fade = 1 - Math.sqrt(d2) / linkR
          ctx.strokeStyle = light
            ? `rgba(51,65,85,${(fade * 0.24).toFixed(3)})`
            : `rgba(148,163,184,${(fade * 0.3).toFixed(3)})`
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }

      // crisp discs — far layer dim slate, near layer bright silver (or the
      // ink equivalents on a light base)
      for (const p of parts) {
        ctx.fillStyle = p.far
          ? light
            ? 'rgba(71,85,105,0.28)'
            : 'rgba(148,163,184,0.22)'
          : p.accent
            ? light
              ? 'rgba(8,145,178,0.92)'
              : 'rgba(56,189,248,0.95)'
            : light
              ? 'rgba(30,41,59,0.85)'
              : 'rgba(226,232,240,0.88)'
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Fluid Mechanics — an actual fluid solver (Stam's "stable fluids"):
// a coarse velocity + dye grid, semi-Lagrangian advection, a pressure
// projection each frame so the field stays incompressible, and orbiting
// vortex stirrers that inject spin and dye. Two things make it read as
// REAL fluid rather than a swirl toy:
//   • dye buoyancy — dye is warm and rises, so arms curl upward into
//     mushroom plumes the way smoke does under glass
//   • vorticity confinement — the small-scale curl that grid diffusion
//     eats is re-injected each frame, so vortices stay crisp and alive
//     instead of decaying into gradient mush
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
    //     ~32k cells (up from ~20k): finer vortices, sharper dye filaments —
    //     the upscale smooths them into “higher quality” water rather than
    //     bigger blobs. Still comfortably inside a phone's frame budget at
    //     the 34 Hz sim gate below.
    const AR = Math.max(0.3, Math.min(4, w / Math.max(1, h)))
    const N = Math.max(48, Math.round(Math.sqrt(32000 * AR)))
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
    const dye2 = [new Float32Array(S), new Float32Array(S), new Float32Array(S)]
    const dyeB = [new Float32Array(S), new Float32Array(S), new Float32Array(S)]
    const dyeMn = new Float32Array(S)
    const dyeMx = new Float32Array(S)
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
    const count = 4 + Math.round((density / 100) * 4)
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
      // time-based decays so the look is frame-rate independent
      const vDecay = Math.pow(0.9995, dt / 0.0167) // rotation persists between pulses
      const dyeDecay = Math.pow(0.999, dt / 0.0167)
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
          const rDye = 2.6 * K
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
      //     back. This is the standard trick that keeps real-time fluids
      //     looking lively; without it every vortex dies into mush.
      for (let y = 1; y < M - 1; y++) {
        for (let x = 1; x < N - 1; x++) {
          const i = at(x, y)
          curl[i] =
            (v[at(x + 1, y)] - v[at(x - 1, y)]) * 0.5 -
            (u[at(x, y + 1)] - u[at(x, y - 1)]) * 0.5
        }
      }
      const epsC = 8 * K
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
      //    like a fluid instead of mushing like noise
      for (let y = 1; y < M - 1; y++) {
        for (let x = 1; x < N - 1; x++) {
          const i = at(x, y)
          dv[i] = -0.5 * (u[at(x + 1, y)] - u[at(x - 1, y)] + v[at(x, y + 1)] - v[at(x, y - 1)])
        }
      }
      pr.fill(0)
      // 26 Gauss–Seidel sweeps (up from 20): a tighter incompressibility
      // solve is visible as crisper swirl structure at the finer grid
      for (let it = 0; it < 26; it++) {
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

      // 4) advect dye — MacCormack (2nd order) with the full Fedkiw
      //    clamp. Plain semi-Lagrangian smears each burst a little wider
      //    every step; over 15+ seconds every arm diffuses into uniform
      //    fog. Forward/back/correct puts the smear back — but the bare
      //    corrector rings (checkerboard) at high CFL, so the result is
      //    clamped to the min/max of the four source corners, and the CFL
      //    guard above keeps parcels under ~1 cell/step. (Velocity stays
      //    1st-order: the projection re-smooths it anyway.)
      for (let c = 0; c < 3; c++) {
        const d = dye[c]!
        const f = dye2[c]!
        const b = dyeB[c]!
        for (let y = 1; y < M - 1; y++) {
          for (let x = 1; x < N - 1; x++) {
            const i = at(x, y)
            const bx = x - u[i]! * dt
            const by = y - v[i]! * dt
            const xi = clampI(Math.floor(bx), 0, N - 1)
            const yi = clampI(Math.floor(by), 0, M - 1)
            const xj = clampI(xi + 1, 0, N - 1)
            const yj = clampI(yi + 1, 0, M - 1)
            const fx = bx - xi
            const fy = by - yi
            const v00 = d[at(xi, yi)]!
            const v10 = d[at(xj, yi)]!
            const v01 = d[at(xi, yj)]!
            const v11 = d[at(xj, yj)]!
            const a0 = v00 + (v10 - v00) * fx
            const a1 = v01 + (v11 - v01) * fx
            f[i] = a0 + (a1 - a0) * fy
            let lo = v00
            let hi = v00
            if (v10 < lo) lo = v10
            else if (v10 > hi) hi = v10
            if (v01 < lo) lo = v01
            else if (v01 > hi) hi = v01
            if (v11 < lo) lo = v11
            else if (v11 > hi) hi = v11
            dyeMn[i] = lo
            dyeMx[i] = hi
          }
        }
        for (let y = 1; y < M - 1; y++) {
          for (let x = 1; x < N - 1; x++) {
            const i = at(x, y)
            b[i] = sample(f, x + u[i]! * dt, y + v[i]! * dt)
          }
        }
        for (let y = 1; y < M - 1; y++) {
          for (let x = 1; x < N - 1; x++) {
            const i = at(x, y)
            let corr = f[i]! + 0.5 * (d[i]! - b[i]!)
            const lo = dyeMn[i]!
            const hi = dyeMx[i]!
            if (corr < lo) corr = lo
            else if (corr > hi) corr = hi
            f[i] = corr * dyeDecay
          }
        }
        d.set(f)
      }
    }

    // pre-roll: simulate ahead so the first visible frame is developed
    // water, not blank — but on a WALL-CLOCK BUDGET. A phone solves one
    // advance in ~10-20 ms; rolling 8 sim-seconds synchronously would
    // freeze the whole app for seconds on open. Whatever the budget does
    // not cover is finished lazily — one catch-up advance per painted
    // frame (the wake-up motion is indistinguishable from live speed),
    // so the scene keeps developing after it is already on screen.
    const PREROLL_TARGET = 280 // advances × 0.028 ≈ 7.8 sim-seconds
    const prerollStart = performance.now()
    let prerolled = 0
    while (prerolled < PREROLL_TARGET && performance.now() - prerollStart < 1000) {
      advance(0.028)
      prerolled++
    }
    let lazyLeft = PREROLL_TARGET - prerolled

    // 5) render: tonemapped dye over a deep base, upscaled with smoothing
    //    (grid edge cells never move — copy inward neighbours so the rim
    //    doesn't read as a border)
    const render = () => {
      for (let x = 0; x < N; x++) {
        for (const y of [0, M - 1]) {
          const src = at(x, y === 0 ? 1 : M - 2)
          for (let c = 0; c < 3; c++) dye[c][at(x, y)] = dye[c][src]
        }
      }
      for (let y = 0; y < M; y++) {
        for (const x of [0, N - 1]) {
          const src = at(x === 0 ? 1 : N - 2, y)
          for (let c = 0; c < 3; c++) dye[c][at(x, y)] = dye[c][src]
        }
      }
      const data = img.data
      for (let i = 0; i < S; i++) {
        // 1.7× tonemap lift: the dye reads mid-bright instead of murk
        const d0 = dye[0][i]!
        const d1 = dye[1][i]!
        const d2 = dye[2][i]!
        const a0 = (1.7 * d0) / (1 + 1.7 * d0)
        const a1 = (1.7 * d1) / (1 + 1.7 * d1)
        const a2 = (1.7 * d2) / (1 + 1.7 * d2)
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
