// ---------------------------------------------------------------------------
// Static background art generators.
//
// Each generator returns a data-URL image (SVG markup or a canvas render),
// produced once per settings change (the caller memoizes) — never per frame.
//
// "Image-style" backgrounds are rendered procedurally to a static image so
// the app ships no binary assets — with one exception: Mineral is a real
// photograph (public/backgrounds/mineral.jpg, shipped with the app).
//
// Everything is seeded and deterministic: the same settings always produce
// the same art, so re-renders never flicker.
// ---------------------------------------------------------------------------

/** Deterministic seeded RNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Serialize SVG markup into a CSS-ready data URL. */
function svgUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\s+/g, ' '))}`
}

const W = 1600
const H = 1000

/**
 * Any CSS colour (hex, rgb, hsl, lab, oklch…) → [r,g,b].
 * Path 1: rasterize one pixel on a canvas — the engine's own parser, works
 *         for every colour format the browser supports.
 * Path 2 (fallback): computed style, for engines that serialize to rgb().
 * Returns null only if the browser cannot parse the colour at all.
 */
function colorToRgb(color: string): [number, number, number] | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx) {
      ctx.fillStyle = '#010203'
      ctx.fillStyle = color
      if (String(ctx.fillStyle) !== '#010203') {
        ctx.fillRect(0, 0, 1, 1)
        const d = ctx.getImageData(0, 0, 1, 1).data
        return [d[0], d[1], d[2]]
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const el = document.createElement('span')
    el.style.display = 'none'
    document.body.appendChild(el)
    try {
      el.style.color = '#010203'
      el.style.color = color
      const computed = getComputedStyle(el).color
      const m = /rgba?\(([^)]+)\)/.exec(computed)
      if (m) {
        const parts = m[1]!
          .split(/[ ,/]+/)
          .filter(Boolean)
          .map(Number)
        if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
          return [parts[0]!, parts[1]!, parts[2]!]
        }
      }
    } finally {
      el.remove()
    }
  } catch {
    /* give up */
  }
  return null
}

// ---------------------------------------------------------------------------
// Topography — a real heightfield: random peaks (each with its own
// steepness), a couple of basins and a continental tilt, traced with
// marching squares. Closely packed rings on steep slopes and gentle fans on
// shallow ones come out of the field for free — that is what a topographic
// map actually is.
// ---------------------------------------------------------------------------

export function generateTopography(opts: {
  fg: string
  intensity: number // 0..100
  scale: number // 40..220 (%)
}): string {
  const { fg, intensity, scale } = opts
  const rnd = mulberry32(1337)

  // ---- 1) the heightfield -------------------------------------------------
  interface Peak {
    x: number
    y: number
    h: number
    s: number // steepness: small sigma = sharp peak = tight rings
  }
  const peaks: Peak[] = []
  const peakCount = 4 + Math.floor(rnd() * 3)
  for (let i = 0; i < peakCount; i++) {
    peaks.push({
      x: 130 + rnd() * (W - 260),
      y: 100 + rnd() * (H - 200),
      h: 0.65 + rnd() * 0.4,
      // half the peaks are steep (tight rings), half gentle (wide fans) —
      // the spread between them is what makes the map read as terrain
      s: (i % 2 === 0 ? 45 + rnd() * 70 : 170 + rnd() * 130) * (scale / 100),
    })
  }
  const basins: Peak[] = []
  for (let i = 0; i < 3; i++) {
    basins.push({ x: rnd() * W, y: rnd() * H, h: -(0.25 + rnd() * 0.3), s: (200 + rnd() * 220) * (scale / 100) })
  }
  const field = (x: number, y: number) => {
    let h = 0.12 + 0.06 * (x / W) + 0.04 * (1 - y / H)
    for (const p of peaks) {
      const d2 = ((x - p.x) ** 2 + (y - p.y) ** 2 * 1.35) / (p.s * p.s)
      h += p.h * Math.exp(-d2)
    }
    for (const b of basins) {
      h += b.h * Math.exp(-(((x - b.x) ** 2 + (y - b.y) ** 2) / (b.s * b.s)))
    }
    return h
  }

  // ---- 2) sample it on a fine grid (5px cells — smooth curves) -------------
  const GW = 320
  const GH = 200
  const cell = W / GW
  const height = new Float32Array(GW * GH)
  let lo = Infinity
  let hi = -Infinity
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const v = field(x * cell, y * cell)
      height[y * GW + x] = v
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }

  // ---- 3) marching squares at ~18 levels ----------------------------------
  // edge ids: 0 = top, 1 = right, 2 = bottom, 3 = left (midpoints)
  const EDGES: [number, number][] = [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ]
  // case (tl<<3|tr<<2|br<<1|bl) → segments as edge pairs; 5 and 10 are saddles
  const TABLE: number[][][] = [
    [], [[3, 2]], [[2, 1]], [[3, 1]],
    [[0, 1]], [], [[0, 2]], [[0, 3]],
    [[0, 3]], [[0, 2]], [], [[3, 1]],
    [[3, 1]], [[1, 2]], [[3, 2]], [],
  ]
  const levels = 18
  const paths: string[] = []
  const baseA = Math.min(0.5, 0.14 + (0.3 * intensity) / 100)
  for (let l = 1; l <= levels; l++) {
    const level = lo + ((hi - lo) * l) / (levels + 1)
    const d: string[] = []
    for (let y = 0; y < GH - 1; y++) {
      for (let x = 0; x < GW - 1; x++) {
        const tl = height[y * GW + x]
        const tr = height[y * GW + x + 1]
        const br = height[(y + 1) * GW + x + 1]
        const bl = height[(y + 1) * GW + x]
        let cse = 0
        if (tl >= level) cse |= 8
        if (tr >= level) cse |= 4
        if (br >= level) cse |= 2
        if (bl >= level) cse |= 1
        if (cse === 0 || cse === 15) continue
        let segs: number[][]
        if (cse === 5 || cse === 10) {
          // saddle: does the level pass above or below the cell centre?
          const center = (tl + tr + br + bl) / 4
          const up = cse === 5 ? center >= level : center < level
          segs = cse === 5 ? (up ? [[0, 3], [1, 2]] : [[0, 1], [3, 2]]) : up ? [[0, 1], [3, 2]] : [[0, 3], [1, 2]]
        } else {
          segs = TABLE[cse]!
        }
        for (const [ea, eb] of segs) {
          const ax = (x + EDGES[ea]![0]) * cell
          const ay = (y + EDGES[ea]![1]) * cell
          const bx = (x + EDGES[eb]![0]) * cell
          const by = (y + EDGES[eb]![1]) * cell
          d.push(`M${ax.toFixed(1)} ${ay.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`)
        }
      }
    }
    if (!d.length) continue
    // index contours (every 5th) read a touch stronger, like real maps.
    // stroke widths are tuned for PHONE display: the 1600-wide art lands at
    // ~23% on a 375px screen, so 1-unit lines would vanish — 4.5/7 reads as
    // ~1.1/1.7px there and stays elegant on desktop.
    const index = l % 5 === 0
    paths.push(
      `<path d="${d.join('')}" fill="none" stroke="${fg}" stroke-width="${index ? 7 : 4.5}" opacity="${(baseA * (index ? 1.4 : 1)).toFixed(3)}" stroke-linecap="round"/>`,
    )
  }
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${paths.join('')}</svg>`,
  )
}

// ---------------------------------------------------------------------------
// Fractals — a Julia set, escape-time rendered with banded contours.
// The banding (integer escape counts) reads like etched topographic rings
// around the set — unmistakably fractal, and quiet enough to sit behind UI.
// ---------------------------------------------------------------------------

export function generateFractals(opts: { fg: string; intensity: number; scale: number }): string {
  const { fg, intensity, scale } = opts
  const rnd = mulberry32(4242)
  const rgb = colorToRgb(fg) ?? [150, 160, 175]
  const baseA = Math.min(0.32, 0.07 + (0.24 * intensity) / 100)

  // curated c values — each gives a connected, elegant set
  const CS: [number, number][] = [
    [-0.7269, 0.1889],
    [-0.4, 0.6],
    [-0.8, 0.156],
    [0.285, 0.01],
    [-0.835, -0.2321],
    [-0.70176, -0.3842],
    [0.3, -0.01],
    [-0.54, 0.54],
  ]
  const c = CS[Math.floor(rnd() * CS.length)]!

  // scale = zoom: 40% shows the whole neighbourhood, 220% crops into detail.
  // 1.7 at 100% puts the set across most of the frame with breathing room.
  const halfW = 1.7 * (110 / Math.max(40, Math.min(220, scale)))
  const cw = 640
  const ch = 400
  const halfH = (halfW * ch) / cw
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(cw, ch)
  const data = img.data
  const maxIter = 64
  const step = (2 * halfW) / cw
  // quantized into ~10 fat bands: thin sub-pixel rings would vanish when the
  // browser downsamples the art to a phone screen
  const baseA2 = Math.min(0.95, 0.45 + (0.5 * intensity) / 100)
  for (let py = 0; py < ch; py++) {
    const y = -halfH + py * ((2 * halfH) / ch)
    for (let px = 0; px < cw; px++) {
      const x = -halfW + px * step
      let zx = x
      let zy = y
      let n = 0
      let zx2 = zx * zx
      let zy2 = zy * zy
      while (n < maxIter && zx2 + zy2 < 16) {
        zy = 2 * zx * zy + c[1]
        zx = zx2 - zy2 + c[0]
        zx2 = zx * zx
        zy2 = zy * zy
        n++
      }
      const k = (py * cw + px) * 4
      if (n >= maxIter) {
        data[k + 3] = 0 // inside the set: leave the theme background untouched
        continue
      }
      // banded: quantized escape counts give concentric contour rings
      const band = Math.floor(n / 7) // 0..9
      const bandA = baseA2 * (0.5 + 0.5 * (band / 9))
      data[k] = rgb[0]
      data[k + 1] = rgb[1]
      data[k + 2] = rgb[2]
      data[k + 3] = Math.round(bandA * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

// ---------------------------------------------------------------------------
// Mycelium — a living network: wavy tapering hyphae that branch and FUSE
// (anastomosis loops, the signature of real mycelium), thick rhizomorph
// cords as the skeleton, bioluminescent growth tips, and spore clusters
// where hyphae end or meet — not a random walk web.
// ---------------------------------------------------------------------------

interface Walker {
  x: number
  y: number
  angle: number
  life: number
  life0: number
  width: number
  alpha: number
  hue: [number, number, number]
  tip: boolean // a "growth tip" walker — glows faint cyan near the end
}

export function generateMycelium(opts: { density: number; glow: number; scale: number }): string {
  const { density, glow, scale } = opts
  const rnd = mulberry32(90210)
  // rendered at 800x500 (not 1600): on phones the art lands at ~47% of this
  // instead of ~23%, so hyphae stay visible without comically fat strokes
  const LW = 800
  const LH = 500
  const canvas = document.createElement('canvas')
  canvas.width = LW
  canvas.height = LH
  const ctx = canvas.getContext('2d')!
  const sc = scale / 100

  // substrate: deep violet humus with soft uneven washes + vignette
  const bg = ctx.createRadialGradient(LW * 0.5, LH * 0.42, 40, LW * 0.5, LH * 0.5, LW * 0.75)
  bg.addColorStop(0, '#191230')
  bg.addColorStop(0.6, '#120c22')
  bg.addColorStop(1, '#0b0816')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, LW, LH)
  for (let i = 0; i < 3; i++) {
    const wx = rnd() * LW
    const wy = rnd() * LH
    const wr = 140 + rnd() * 170
    const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr)
    wg.addColorStop(0, 'rgba(124,110,200,0.05)')
    wg.addColorStop(1, 'rgba(124,110,200,0)')
    ctx.fillStyle = wg
    ctx.fillRect(0, 0, LW, LH)
  }

  // occupancy map for anastomosis: last point seen per 12px cell
  const CS = 12
  const cols = Math.ceil(LW / CS)
  const occ: (Walker | null)[] = new Array(Math.ceil(LW / CS) * Math.ceil(LH / CS)).fill(null)
  const occAt = (x: number, y: number) => occ[Math.floor(y / CS) * cols + Math.floor(x / CS)]
  const occSet = (x: number, y: number, wk: Walker) => {
    occ[Math.floor(y / CS) * cols + Math.floor(x / CS)] = wk
  }

  const VIOLET: [number, number, number] = [167, 139, 250]
  const CYAN: [number, number, number] = [125, 211, 252]
  const stepLen = 1.7 * sc
  let fusions = 0
  const fuseNodes: { x: number; y: number }[] = []
  const sporeClusters: { x: number; y: number; n: number }[] = []

  const walk = (wk: Walker, budget: { left: number }) => {
    let bow = (rnd() - 0.5) * 0.16
    for (let s = 0; s < wk.life; s++) {
      // organic wander: local jitter on top of a slow bow
      wk.angle += (rnd() - 0.5) * 0.5 + Math.sin(s * 0.045 + bow * 40) * 0.035
      if (s === Math.floor(wk.life * 0.3)) bow = (rnd() - 0.5) * 0.16
      const nx = wk.x + Math.cos(wk.angle) * stepLen
      const ny = wk.y + Math.sin(wk.angle) * stepLen
      if (nx < -12 || nx > LW + 12 || ny < -12 || ny > LH + 12) break

      const t = s / wk.life
      const w = wk.width * (1 - 0.35 * t) // hyphae taper as they extend
      const tipGlow = wk.tip && t > 0.88 // growth tips light up near the end
      const col = tipGlow ? CYAN : wk.hue
      const a = tipGlow ? wk.alpha + 0.1 : wk.alpha
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(3)})`
      ctx.lineWidth = Math.max(0.5, w)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(wk.x, wk.y)
      ctx.lineTo(nx, ny)
      ctx.stroke()

      // anastomosis: if another hypha passes close by, fuse into it and stop
      if (fusions < 30 && s > 24) {
        const cellW = occAt(nx, ny)
        if (cellW && cellW !== wk) {
          const d = Math.hypot(cellW.x - nx, cellW.y - ny)
          if (d > 9 && d < 32 && rnd() < 0.5) {
            ctx.strokeStyle = `rgba(${wk.hue[0]},${wk.hue[1]},${wk.hue[2]},0.14)`
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.moveTo(nx, ny)
            ctx.quadraticCurveTo((nx + cellW.x) / 2 + (rnd() - 0.5) * 30, (ny + cellW.y) / 2 + (rnd() - 0.5) * 30, cellW.x, cellW.y)
            ctx.stroke()
            fusions++
            fuseNodes.push({ x: (nx + cellW.x) / 2, y: (ny + cellW.y) / 2 })
            sporeClusters.push({ x: cellW.x, y: cellW.y, n: 3 + Math.floor(rnd() * 3) })
            return
          }
        }
      }
      occSet(nx, ny, wk)
      wk.x = nx
      wk.y = ny

      // branch
      if (rnd() < 0.0035 + (density / 100) * 0.0011 && budget.left > 0) {
        budget.left--
        walk(
          {
            x: nx,
            y: ny,
            angle: wk.angle + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.7),
            life: Math.floor(wk.life * 0.6),
            life0: Math.floor(wk.life * 0.6),
            width: wk.width * 0.75,
            alpha: wk.alpha * 0.9,
            hue: wk.hue,
            tip: rnd() < 0.3,
          },
          budget,
        )
      }
    }
    // natural end of a hypha: spore cluster at the tip
    if (rnd() < 0.55) sporeClusters.push({ x: wk.x, y: wk.y, n: 3 + Math.floor(rnd() * 4) })
  }

  // thick rhizomorph cords — the skeleton of the network
  const budget = { left: 150 }
  const cordCount = 4 + Math.floor(rnd() * 3)
  for (let i = 0; i < cordCount; i++) {
    const edge = Math.floor(rnd() * 4)
    const x = edge === 0 ? -6 : edge === 1 ? LW + 6 : rnd() * LW
    const y = edge === 2 ? -6 : edge === 3 ? LH + 6 : rnd() * LH
    walk(
      {
        x,
        y,
        angle: Math.atan2(LH / 2 - y, LW / 2 - x) + (rnd() - 0.5) * 0.8,
        life: Math.floor((420 + rnd() * 260) * sc),
        life0: 500,
        width: 6 + rnd() * 2.6,
        alpha: 0.2 + rnd() * 0.06,
        hue: VIOLET,
        tip: false,
      },
      budget,
    )
  }
  // fine hyphae — the bulk of the network
  const hyphaCount = Math.round(20 + (density / 100) * 34)
  for (let i = 0; i < hyphaCount; i++) {
    walk(
      {
        x: rnd() * LW,
        y: rnd() * LH,
        angle: rnd() * Math.PI * 2,
        life: Math.floor((200 + rnd() * 260) * sc),
        life0: 300,
        width: 2 + rnd() * 2.2,
        alpha: 0.17 + rnd() * 0.13,
        hue: VIOLET,
        tip: rnd() < 0.22,
      },
      budget,
    )
  }

  // spore clusters: tight groups of glow dots (not uniform confetti) —
  // a crisp core with a tight halo, sitting on tips and junctions
  for (const c of sporeClusters) {
    for (let i = 0; i < c.n; i++) {
      const r = 2 + rnd() * 2.6
      const dx = (rnd() - 0.5) * 14
      const dy = (rnd() - 0.5) * 14
      const halo = r * (2.2 + (glow / 100) * 3.5)
      const g = ctx.createRadialGradient(c.x + dx, c.y + dy, 0, c.x + dx, c.y + dy, halo)
      g.addColorStop(0, `rgba(196,181,253,${(0.55 + (glow / 100) * 0.35).toFixed(3)})`)
      g.addColorStop(0.45, 'rgba(167,139,250,0.28)')
      g.addColorStop(1, 'rgba(167,139,250,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(c.x + dx, c.y + dy, halo, 0, Math.PI * 2)
      ctx.fill()
      // crisp core so the cluster reads as a dot, not a smudge
      ctx.fillStyle = 'rgba(226,214,255,0.9)'
      ctx.beginPath()
      ctx.arc(c.x + dx, c.y + dy, r * 0.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // fusion junctions get one brighter bead each
  for (const f of fuseNodes) {
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 14 + (glow / 100) * 18)
    g.addColorStop(0, 'rgba(196,181,253,0.6)')
    g.addColorStop(1, 'rgba(167,139,250,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(f.x, f.y, 14 + (glow / 100) * 18, 0, Math.PI * 2)
    ctx.fill()
  }

  // vignette
  const vg = ctx.createRadialGradient(LW / 2, LH / 2, LH * 0.32, LW / 2, LH / 2, LW * 0.72)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.5)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, LW, LH)
  return canvas.toDataURL('image/webp', 0.9)
}

// ---------------------------------------------------------------------------
// Mineral — a real photograph (public/backgrounds/mineral.jpg): dark stone
// with quiet veining, zoomable like any other background. See
// BackgroundLayer for the renderer.
// ---------------------------------------------------------------------------
export const MINERAL_IMAGE_URL = '/backgrounds/mineral.jpg'

// ---------------------------------------------------------------------------
// Carbon — carbon-fibre weave, tuned to a whisper: near-black strands on a
// near-black ground, one soft diagonal sheen. It should take a second look
// to notice the weave at all.
// ---------------------------------------------------------------------------

export function generateCarbon(opts: { scale: number }): string {
  // weave pitch ~72px at 100%: big enough to survive the intrinsic-size
  // rasterize-then-downscale path without moiré, still quiet on a phone
  const t = Math.max(18, Math.round(36 * (opts.scale / 100)))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#202622"/><stop offset="0.55" stop-color="#161b18"/><stop offset="1" stop-color="#101412"/></linearGradient>
<linearGradient id="b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#202622"/><stop offset="0.55" stop-color="#161b18"/><stop offset="1" stop-color="#101412"/></linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.022"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<pattern id="w" width="${t * 2}" height="${t * 2}" patternUnits="userSpaceOnUse">
<rect width="${t * 2}" height="${t * 2}" fill="#0a0c0b"/>
<rect x="0.5" y="0.5" width="${t - 1}" height="${t - 1}" fill="url(#a)" rx="3"/>
<rect x="${t + 0.5}" y="0.5" width="${t - 1}" height="${t - 1}" fill="url(#b)" rx="3"/>
<rect x="0.5" y="${t + 0.5}" width="${t - 1}" height="${t - 1}" fill="url(#b)" rx="3"/>
<rect x="${t + 0.5}" y="${t + 0.5}" width="${t - 1}" height="${t - 1}" fill="url(#a)" rx="3"/>
</pattern>
</defs>
<rect width="${W}" height="${H}" fill="url(#w)"/>
<rect width="${W}" height="${H}" fill="url(#sheen)"/>
</svg>`
  return svgUrl(svg)
}

// ---------------------------------------------------------------------------
// Iridescence — anodized titanium, not a funfair: one restrained diagonal
// sweep of teal → violet → rose on near-black, ultra-soft (drawn small and
// upscaled, so the blur is free), with two hairline sheen streaks.
// ---------------------------------------------------------------------------

export function generateIridescence(opts: { intensity: number }): string {
  const { intensity } = opts
  const rnd = mulberry32(777)
  const I = 0.35 + (0.65 * intensity) / 100
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#050608'
  ctx.fillRect(0, 0, W, H)

  // draw the colour sweep at 1/8 scale, then upscale — 8× free blur
  const sw = 200
  const sh = 125
  const off = document.createElement('canvas')
  off.width = sw
  off.height = sh
  const octx = off.getContext('2d')!
  octx.fillStyle = '#050608'
  octx.fillRect(0, 0, sw, sh)
  // the sweep axis: bottom-left → top-right
  const ax0 = sw * 0.16
  const ay0 = sh * 0.84
  const ax1 = sw * 0.84
  const ay1 = sh * 0.16
  const lobes: { t: number; r: number; col: [number, number, number]; a: number }[] = [
    { t: 0.3, r: 58, col: [20, 184, 166], a: 0.24 * I }, // teal
    { t: 0.55, r: 72, col: [139, 92, 246], a: 0.2 * I }, // violet
    { t: 0.78, r: 62, col: [244, 114, 182], a: 0.18 * I }, // rose
    { t: 0.42, r: 34, col: [255, 255, 255], a: 0.11 * I }, // specular
  ]
  for (const lb of lobes) {
    const lx = ax0 + (ax1 - ax0) * lb.t + (rnd() - 0.5) * 12
    const ly = ay0 + (ay1 - ay0) * lb.t + (rnd() - 0.5) * 8
    const g = octx.createRadialGradient(lx, ly, 0, lx, ly, lb.r)
    g.addColorStop(0, `rgba(${lb.col[0]},${lb.col[1]},${lb.col[2]},${lb.a.toFixed(3)})`)
    g.addColorStop(1, `rgba(${lb.col[0]},${lb.col[1]},${lb.col[2]},0)`)
    octx.fillStyle = g
    octx.fillRect(0, 0, sw, sh)
  }
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(off, 0, 0, W, H)

  // hairline sheen streaks along the axis
  const A = { x: ax0 * (W / sw), y: ay0 * (H / sh) }
  const B = { x: ax1 * (W / sw), y: ay1 * (H / sh) }
  const dx = B.x - A.x
  const dy = B.y - A.y
  const len = Math.hypot(dx, dy)
  const nx = -dy / len
  const ny = dx / len
  for (const offP of [-46, 52]) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(A.x + nx * offP - dx * 0.1, A.y + ny * offP - dy * 0.1)
    ctx.lineTo(B.x + nx * offP + dx * 0.1, B.y + ny * offP + dy * 0.1)
    ctx.stroke()
  }

  // quiet vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.72)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.35)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, W, H)
  return canvas.toDataURL('image/webp', 0.9)
}

// ---------------------------------------------------------------------------
// Film-grain noise overlay (used by Nebula)
// ---------------------------------------------------------------------------

export const NOISE_IMAGE_URL = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="300" height="300" filter="url(#n)"/></svg>`,
)
