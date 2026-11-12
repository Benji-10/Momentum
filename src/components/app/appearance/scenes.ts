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
// Particle Fields — a crisp technical constellation. Two parallax depth
// layers of sharp dots (no halos, no additive glow) with thin links between
// the near layer only — deliberately nothing like the soft glowing plankton
// of bioluminescence.
// ---------------------------------------------------------------------------

export function makeParticleField(settings: BgSettings): SceneFactory {
  const speed = (Number(settings.speed) || 100) / 100
  const density = Number(settings.density) ?? 45
  const connections = Number(settings.connections) ?? 50
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
        r: far ? 0.65 + Math.random() * 0.35 : 1.35 + Math.random() * 0.65,
        // a handful of near-layer "navigation stars" in accent cyan
        accent: !far && i % 17 === 0,
      }
    })
    const near = parts.filter((p) => !p.far)
    const field = (x: number, y: number, t: number) =>
      Math.sin(x * 0.0016 + t * 0.18) * 1.5 +
      Math.cos(y * 0.0021 - t * 0.14) * 1.5 +
      Math.sin((x + y) * 0.0009 + t * 0.1)
    const linkDist = 42 + connections * 0.55
    const linkAlpha = (connections / 100) * 0.2
    return (t: number) => {
      // flat technical base with a quiet corner falloff — no wash, no bloom
      ctx.fillStyle = '#05070c'
      ctx.fillRect(0, 0, w, h)
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62)
      vg.addColorStop(0, 'rgba(0,0,0,0)')
      vg.addColorStop(1, 'rgba(0,0,0,0.28)')
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

      // links only inside the near layer — fewer, thinner, quieter
      if (connections > 3) {
        ctx.lineWidth = 0.6
        for (let i = 0; i < near.length; i++) {
          for (let j = i + 1; j < near.length; j++) {
            const dx = near[i].x - near[j].x
            const dy = near[i].y - near[j].y
            const d2 = dx * dx + dy * dy
            if (d2 < linkDist * linkDist) {
              const d = Math.sqrt(d2)
              const a = (1 - d / linkDist) * linkAlpha
              ctx.strokeStyle = `rgba(148,163,184,${a.toFixed(3)})`
              ctx.beginPath()
              ctx.moveTo(near[i].x, near[i].y)
              ctx.lineTo(near[j].x, near[j].y)
              ctx.stroke()
            }
          }
        }
      }
      // crisp discs — far layer dim slate, near layer bright silver
      for (const p of parts) {
        ctx.fillStyle = p.far
          ? 'rgba(148,163,184,0.28)'
          : p.accent
            ? 'rgba(56,189,248,0.9)'
            : 'rgba(226,232,240,0.8)'
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
// vortex stirrers that inject spin and dye. Rendered at grid resolution
// and upscaled — the upscale is the antialias.
// ---------------------------------------------------------------------------

export function makeFluidMechanics(settings: BgSettings): WarmupSceneFactory {
  const speed = (Number(settings.speed) || 60) / 100
  const density = Number(settings.density) ?? 50
  const factory = ((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    // --- sim grid, shaped like the viewport: a portrait phone would only
    //     ever see the middle third of a fixed 128x80 grid ------------------
    const AR = Math.max(0.3, Math.min(4, w / Math.max(1, h)))
    const N = Math.max(48, Math.round(Math.sqrt(20480 * AR)))
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
    const pr = new Float32Array(S)
    const dv = new Float32Array(S)

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
    const count = 3 + Math.round((density / 100) * 4)
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
          gw: (10 + Math.random() * 6) * K, // vortex radius in cells — big enough to read
          spin: (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.5),
          emit: 0.6 + Math.random() * 0.6,
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

    const advance = (dt: number) => {
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
            u[i] += (-dy / d) * s.spin * 35 * K * fall * dt
            v[i] += (dx / d) * s.spin * 35 * K * fall * dt
          }
        }
        // 10s pulse cycle, 5.5s duty, phase-staggered; always on during the
        // opening so the first visible frame is a fully drawn swirl
        const emitting = simT < 5.5 || (simT + s.ph * 1.6) % 10 < 5.5
        if (emitting) {
          const sx = gx + s.gw * 0.45 // on the fast side of the spin
          const sy = gy
          const rDye = 2.2 * K
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

      // rotation dissipation (time-based)
      for (let i = 0; i < S; i++) {
        u[i] *= vDecay
        v[i] *= vDecay
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
      for (let it = 0; it < 14; it++) {
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

      // 4) advect dye ------------------------------------------------------
      for (let y = 1; y < M - 1; y++) {
        for (let x = 1; x < N - 1; x++) {
          const i = at(x, y)
          const bx = x - u[i] * dt
          const by = y - v[i] * dt
          for (let c = 0; c < 3; c++) dye2[c][i] = sample(dye[c], bx, by) * dyeDecay
        }
      }
      for (let c = 0; c < 3; c++) dye[c].set(dye2[c])
    }

    // pre-roll ~5.3 s of simulation: a live scene must not open as blank
    // water — the first visible frame should already be a developed swirl
    for (let i = 0; i < 320; i++) advance(0.0167)

    const frame = (t: number) => {
      if (!primed) {
        ctx.fillStyle = '#060a12'
        ctx.fillRect(0, 0, w, h)
        primed = true
      }
      const dt = Math.min(0.05, Math.max(0.004, lastT < 0 ? 0.016 : (t - lastT) * speed))
      lastT = t
      advance(dt)

      // 5) render: tonemapped dye over a deep base, upscaled with smoothing
      //    (grid edge cells never move — copy inward neighbours so the rim
      //    doesn't read as a border)
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
        // 1.6× tonemap lift: the dye reads mid-bright instead of murk
        const r = (1.6 * dye[0][i]) / (1 + 1.6 * dye[0][i])
        const g = (1.6 * dye[1][i]) / (1 + 1.6 * dye[1][i])
        const b = (1.6 * dye[2][i]) / (1 + 1.6 * dye[2][i])
        const k = i * 4
        data[k] = 6 + 235 * r
        data[k + 1] = 10 + 235 * g
        data[k + 2] = 18 + 235 * b
        data[k + 3] = 255
      }
      octx.putImageData(img, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(off, 0, 0, w, h)
    }
    return frame
  }) as WarmupSceneFactory
  factory.warmupFrames = 110
  return factory
}
