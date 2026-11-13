// ---------------------------------------------------------------------------
// Static background art generators.
//
// Each generator returns a data-URL image (SVG markup or a canvas render),
// produced once per settings change (the caller memoizes) — never per frame.
//
// "Image-style" backgrounds are rendered procedurally to a static image so
// the app ships no binary assets — with one exception: Mineral is a real
// photograph (public/backgrounds/mineral.webp, shipped with the app).
//
// Generators take a `seed` (the app passes a fresh one per page load, so
// every visit grows a new terrain / network / Julia rule). Within a load
// the seed is fixed, so slider tweaks never flicker the art. Callers that
// want stable art (settings thumbnails, the preview harness) pass their
// own fixed seed and get the same picture every time.
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

export { colorToRgb }

/** Relative luminance of an rgb triple, 0…1. */
function luminance(rgb: [number, number, number]): number {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
}

/** Channel-wise mix of two rgb triples. */
function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/** Line-art colours must stay readable on the paper they are drawn on: if
 *  a theme colour sits too close to the theme background (a bright primary
 *  on white, say), push it away — darker on light paper, lighter on dark —
 *  so the themed hue survives with its contrast intact. */
function ensureContrast(
  c: [number, number, number],
  bg: [number, number, number] | null | undefined,
): [number, number, number] {
  if (!bg) return c
  const lc = luminance(c)
  const lb = luminance(bg)
  if (Math.abs(lc - lb) < 0.24) {
    return lb > 0.5 ? mixRgb(c, [15, 23, 42], 0.5) : mixRgb(c, [226, 232, 255], 0.42)
  }
  return c
}

const rgbCss = (c: [number, number, number]) =>
  `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`

// ---------------------------------------------------------------------------
// Topography — a real heightfield: a DOMINANT peak at the canvas centre
// (phones cover-crop the middle of the landscape art, so the main mountain
// system must live there), satellite peaks with their own steepness, a
// couple of basins and a continental tilt — traced with marching squares
// WITH LINEAR INTERPOLATION along the cell edges, so the contour rings come
// out as smooth curves instead of the blocky mid-point staircase. Closely
// packed rings on steep slopes and gentle fans on shallow ones come out of
// the field for free — that is what a topographic map actually is.
// ---------------------------------------------------------------------------

export function generateTopography(opts: {
  fg: string
  /** the theme's primary colour — regular contour rings (falls back to fg) */
  primary?: string
  /** the theme's accent colour — index contours (falls back to primary) */
  accent2?: string
  /** the theme's background colour — contrast guard for the strokes */
  themeBg?: [number, number, number] | null
  intensity: number // 0..100
  scale: number // 40..220 (%)
  /** fresh terrain per page load; fixed seed = stable thumbnail */
  seed?: number
}): string {
  const { fg, intensity, scale } = opts
  const rnd = mulberry32(opts.seed ?? 1337)
  // the ring colours inherit the palette: regular rings ride the theme's
  // primary hue, index contours (every 5th, the bolder map lines) the
  // accent — both pushed off the paper if the theme puts them too close
  // to the background to read
  const fallback = colorToRgb(fg) ?? [154, 160, 173]
  const mainRgb = ensureContrast(colorToRgb(opts.primary ?? '') ?? fallback, opts.themeBg)
  const indexRgb = ensureContrast(colorToRgb(opts.accent2 ?? '') ?? mainRgb, opts.themeBg)
  const strokeMain = rgbCss(mainRgb)
  const strokeIndex = rgbCss(indexRgb)

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
    if (i === 0) {
      // the dominant mountain sits ON the centre (with a nudge), tall and
      // steep — the tight ring system around it is the map's anchor and
      // stays fully visible in a phone's cover-crop of this art
      peaks.push({
        x: W / 2 + (rnd() - 0.5) * 120,
        y: H / 2 + (rnd() - 0.5) * 90,
        h: 0.9 + rnd() * 0.2,
        s: (70 + rnd() * 60) * (scale / 100),
      })
      continue
    }
    peaks.push({
      x: 130 + rnd() * (W - 260),
      y: 100 + rnd() * (H - 200),
      h: 0.45 + rnd() * 0.4,
      // half the satellites are steep (tight rings), half gentle (wide
      // fans) — the spread between them is what makes the map read as terrain
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

  // ---- 2) sample it on a fine grid (4px cells) ------------------------------
  const GW = 400
  const GH = 250
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

  // ---- 3) marching squares at ~18 levels, WITH edge interpolation ----------
  // The crossing point on each cell edge is placed by linear interpolation
  // between the two corner heights — that is the difference between smooth
  // circular contour rings and the chunky staircase you get from fixed
  // midpoints. Crossing points on a shared edge agree from both neighbouring
  // cells, so the tiny segments chain into visually continuous curves; at
  // 4px cells (≈1px on a phone) the polygon IS the smooth curve.
  //
  // Each edge is a corner pair: top tl→tr, right tr→br, bottom bl→br,
  // left tl→bl.
  const EDGE_CORNERS: [0 | 1 | 2 | 3, 0 | 1 | 2 | 3][] = [
    [0, 1], // 0 top
    [1, 2], // 1 right
    [3, 2], // 2 bottom
    [0, 3], // 3 left
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
    /** interpolated crossing point of `level` on cell edge `e`, in art px */
    const edgePoint = (
      x: number,
      y: number,
      corners: [number, number, number, number], // tl tr br bl
      e: number,
    ): [number, number] => {
      const [ca, cb] = EDGE_CORNERS[e]!
      const va = corners[ca]!
      const vb = corners[cb]!
      // t along the edge; corners are exactly AT the level in degenerate
      // cells — guard so t stays in [0,1]
      let t = vb === va ? 0.5 : (level - va) / (vb - va)
      if (t < 0) t = 0
      else if (t > 1) t = 1
      switch (e) {
        case 0: return [(x + t) * cell, y * cell]
        case 1: return [(x + 1) * cell, (y + t) * cell]
        case 2: return [(x + t) * cell, (y + 1) * cell]
        default: return [x * cell, (y + t) * cell]
      }
    }
    for (let y = 0; y < GH - 1; y++) {
      for (let x = 0; x < GW - 1; x++) {
        const tl = height[y * GW + x]
        const tr = height[y * GW + x + 1]
        const br = height[(y + 1) * GW + x + 1]
        const bl = height[(y + 1) * GW + x]
        const corners: [number, number, number, number] = [tl, tr, br, bl]
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
          const [ax, ay] = edgePoint(x, y, corners, ea)
          const [bx, by] = edgePoint(x, y, corners, eb)
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
      `<path d="${d.join('')}" fill="none" stroke="${index ? strokeIndex : strokeMain}" stroke-width="${index ? 7 : 4.5}" opacity="${(baseA * (index ? 1.4 : 1)).toFixed(3)}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
  }
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${paths.join('')}</svg>`,
  )
}

// ---------------------------------------------------------------------------
// Fractals — Julia sets, escape-time rendered with banded contours.
// The banding (integer escape counts) reads like etched topographic rings
// around the set — unmistakably fractal, and quiet enough to sit behind UI.
//
// Twenty-four curated RULES (a Julia constant c × an iteration power —
// z²+c characters and dendrites plus two z⁴+c flowers, each with its own
// framing). Every constant was verified to render well with this banded
// renderer via the candidate tester; cubic z³+c was tried and dropped
// (it renders as faint dust at every tested constant). Selecting the
// background rolls a random variant; the Variant slider browses all 24.
// Variant 1 is the classic the app has always shipped.
// ---------------------------------------------------------------------------

export interface FractalRule {
  c: [number, number]
  power: 2 | 3 | 4
  /** half-width of the viewport at scale 100 — higher powers have smaller sets */
  baseHalf: number
  maxIter: number
}
const FRACTAL_RULES: FractalRule[] = [
  // 1–8: the curated quadratic classics (1 = the long-shipped default)
  { c: [-0.835, -0.2321], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.7269, 0.1889], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.4, 0.6], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.8, 0.156], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [0.285, 0.01], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.70176, -0.3842], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [0.3, -0.01], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.54, 0.54], power: 2, baseHalf: 1.7, maxIter: 64 },
  // 9–10 + 15–16: more quadratic characters (each verified to render well
  // with banded escape contours — candidate-tested, see
  // scripts/bg-previews/entry-candidates.ts)
  { c: [0.37, 0.37], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.4, -0.59], power: 2, baseHalf: 1.7, maxIter: 64 },
  // 11–14 + 19–21: dendrites on the |c| = 0.7885 ring — near-boundary
  // constants give branching lightning Julias. The interesting sector is
  // θ ≈ 1.7–4.1 rad; angles outside it render as faint dust.
  { c: [-0.1563, 0.7729], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.7013, 0.3656], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.7782, -0.1272], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.4231, -0.6666], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.62, 0.41], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.123, 0.745], power: 2, baseHalf: 1.7, maxIter: 64 }, // Douady rabbit
  // 17–18: quartic (z⁴+c) — four-fold flowers, candidate-tested
  { c: [0.55, 0.55], power: 4, baseHalf: 1.4, maxIter: 40 },
  { c: [-0.7, -0.45], power: 4, baseHalf: 1.4, maxIter: 40 },
  { c: [-0.2919, 0.7325], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.4316, 0.6599], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.7741, 0.1501], power: 2, baseHalf: 1.7, maxIter: 64 },
  // 22–24: seahorse spiral, tight curls, dust
  { c: [-0.79, 0.15], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.7, 0.28], power: 2, baseHalf: 1.7, maxIter: 64 },
  { c: [-0.485, -0.375], power: 2, baseHalf: 1.7, maxIter: 64 },
]

/** Render one raw fractal rule (the candidate tester in
 *  scripts/bg-previews uses this directly with arbitrary constants).
 *
 *  The rendered set is CENTRED on the canvas: pass 1 renders the seeded
 *  window and measures the centroid of the inside pixels, and when it sits
 *  off-centre pass 2 re-renders the window shifted onto it. The art is a
 *  landscape canvas cover-fit into the viewport — a portrait phone keeps
 *  only the middle ~30% of its width, so anything but a centred set falls
 *  off-screen on mobile. */
export function generateFractalRule(
  rule: FractalRule,
  opts: {
    fg: string
    /** the theme's primary — outer escape bands (falls back to fg) */
    primary?: string
    /** the theme's accent — inner bands hugging the set (falls back to primary) */
    accent2?: string
    /** the theme's background colour — contrast guard for the band colours */
    themeBg?: [number, number, number] | null
    intensity: number
    scale: number
  },
  seed = 0,
): string {
  const { fg, intensity, scale } = opts
  // framing jitter, deterministic per seed: the same seed always frames the
  // same way, different seeds land differently (the re-centring below keeps
  // the SET centred; the jitter survives as zoom + a few px of drift)
  const fr = mulberry32(seed * 7919 + 3)
  const cx = (fr() - 0.5) * 0.3
  const cy = (fr() - 0.5) * 0.24
  const zoom = 0.88 + fr() * 0.3
  const rgb = colorToRgb(fg) ?? [150, 160, 175]
  // the escape bands inherit the palette: a duotone ramp from the theme's
  // primary (far, faint outer rings) to its accent (the bright rings
  // hugging the set), each pushed off the paper when the theme puts them
  // too close to the background to read. No themed colours passed (thumbs,
  // the candidate sheet) → the classic monochrome fg bands.
  const primaryC = ensureContrast(colorToRgb(opts.primary ?? '') ?? rgb, opts.themeBg)
  const accentC = ensureContrast(colorToRgb(opts.accent2 ?? '') ?? primaryC, opts.themeBg)
  // precompute the fourteen quantized band colours (band 0 far → 13 near
  // the set) — finer than the old ten because the art UPSCALES on phones
  // (640px canvas → ~2× screen), so thin rings survive
  const BANDS = 14
  const bandC: [number, number, number][] = []
  for (let b = 0; b < BANDS; b++) bandC.push(mixRgb(primaryC, accentC, b / (BANDS - 1)))
  const [cr, ci] = rule.c
  const power = rule.power

  // scale = zoom: 40% shows the whole neighbourhood, 220% crops into detail.
  const halfW = rule.baseHalf * zoom * (110 / Math.max(40, Math.min(220, scale)))
  const cw = 640
  const ch = 400
  const halfH = (halfW * ch) / cw
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(cw, ch)
  const data = img.data
  const maxIter = rule.maxIter
  const step = (2 * halfW) / cw
  // quantized into ~10 fat bands: thin sub-pixel rings would vanish when the
  // browser downsamples the art to a phone screen
  const baseA2 = Math.min(0.95, 0.45 + (0.5 * intensity) / 100)

  /** render the window centred on (ccx, ccy) into `data`; returns the
   *  centroid of the inside pixels in IMAGE pixels. */
  const renderAt = (ccx: number, ccy: number): [number, number] => {
    let sx = 0
    let sy = 0
    let inside = 0
    for (let py = 0; py < ch; py++) {
      const y = ccy - halfH + py * ((2 * halfH) / ch)
      for (let px = 0; px < cw; px++) {
        const x = ccx - halfW + px * step
        let zx = x
        let zy = y
        let n = 0
        let zx2 = zx * zx
        let zy2 = zy * zy
        while (n < maxIter && zx2 + zy2 < 16) {
          if (power === 2) {
            zy = 2 * zx * zy + ci
            zx = zx2 - zy2 + cr
          } else if (power === 3) {
            // z³ by the binomial: x(x²−3y²) + i·y(3x²−y²)
            const t = zx * (zx2 - 3 * zy2) + cr
            zy = zy * (3 * zx2 - zy2) + ci
            zx = t
          } else {
            // z⁴ = square twice
            const a = zx2 - zy2
            const b = 2 * zx * zy
            zx = a * a - b * b + cr
            zy = 2 * a * b + ci
          }
          zx2 = zx * zx
          zy2 = zy * zy
          n++
        }
        const k = (py * cw + px) * 4
        if (n >= maxIter) {
          data[k + 3] = 0 // inside the set: leave the theme background untouched
          sx += px
          sy += py
          inside++
          continue
        }
        // banded: quantized escape counts give concentric contour rings,
        // each band walking the theme's primary→accent duotone ramp
        const band = Math.min(BANDS - 1, Math.floor((n / maxIter) * BANDS))
        const bandA = baseA2 * (0.5 + 0.5 * (band / (BANDS - 1)))
        const bc = bandC[band]!
        data[k] = bc[0]
        data[k + 1] = bc[1]
        data[k + 2] = bc[2]
        data[k + 3] = Math.round(bandA * 255)
      }
    }
    return inside > 0 ? [sx / inside, sy / inside] : [cw / 2, ch / 2]
  }

  // pass 1: the seeded window; measure where the set actually sits
  let [gcx, gcy] = renderAt(cx, cy)
  // pass 2 (only when needed): shift the window so the set's centroid lands
  // on the canvas centre — threshold ~2% of the canvas, beyond which the
  // off-centre drift starts pushing the set toward a phone's crop edge
  const dx = gcx - cw / 2
  const dy = gcy - ch / 2
  if (Math.hypot(dx, dy) > cw * 0.02) {
    // pixels are square in complex space (vertical step == horizontal step),
    // so both shifts are simply px × step
    ;[gcx, gcy] = renderAt(cx + dx * step, cy + dy * step)
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

export function generateFractals(opts: {
  fg: string
  primary?: string
  accent2?: string
  themeBg?: [number, number, number] | null
  intensity: number
  scale: number
  /** 0 (the default) = auto: a seeded random rule — a fresh Julia every
   *  page load. 1..24 pins that rule; the slider writes this. */
  variant?: number
  /** per-load seed: drives the auto rule pick AND the framing jitter */
  seed?: number
}): string {
  const seed = opts.seed ?? 0
  const raw = Math.round(opts.variant ?? 0)
  const vIdx =
    raw <= 0
      ? // auto: one seeded roll — stable for the whole visit (the caller
        // regenerates only on settings changes), fresh on the next load
        Math.floor(mulberry32((seed >>> 0) * 2654435761 + 11)() * FRACTAL_RULES.length)
      : raw - 1
  const clamped = Math.max(0, Math.min(FRACTAL_RULES.length - 1, vIdx))
  return generateFractalRule(FRACTAL_RULES[clamped]!, opts, clamped + (seed >>> 0) * 65599)
}

// ---------------------------------------------------------------------------
// Mycelium — a glowing node network: bright synapse-like nodes strung
// together by fine luminous filaments in blue-violet and cyan, on a deep
// substrate (the reference look). Nodes come from a jittered grid (even
// coverage, organic spacing); each node links to a handful of near
// neighbours with gently bowed curves — a few thick trunk lines carry the
// structure, the rest are hairlines. Every filament is drawn twice (wide
// soft halo + crisp core) with additive blending on dark substrates, so
// crossings accumulate light exactly like the reference; junctions
// (degree ≥ 3) get the brightest halos. A light theme keeps its paper and
// the whole network flips to deep ink.
// ---------------------------------------------------------------------------

export function generateMycelium(opts: {
  density: number
  glow: number
  scale: number
  /** fresh growth per page load; fixed seed = stable thumbnail */
  seed?: number
  /** the theme's background colour — the substrate adopts it (dark themes
   *  get a violet-tinted version of their own bg, light themes keep their
   *  light bg and the network switches to deep-violet ink) */
  themeBg?: [number, number, number] | null
}): string {
  const { density, glow, scale } = opts
  const rnd = mulberry32(opts.seed ?? 90210)
  // rendered at 800x500 (not 1600): on phones the art lands at ~47% of this
  // instead of ~23%, so filaments stay visible without comically fat strokes
  const LW = 800
  const LH = 500
  const canvas = document.createElement('canvas')
  canvas.width = LW
  canvas.height = LH
  const ctx = canvas.getContext('2d')!
  const sc = scale / 100

  // substrate — themed: dark themes mix their own background colour into the
  // deep violet humus (the theme's hue survives, the darkness keeps the
  // glowy identity); light themes keep their light background and the whole
  // network flips to ink-on-paper. No themeBg (previews/thumbnails) keeps
  // the classic fixed violet-black substrate.
  const DEEP: [number, number, number] = [11, 8, 22]
  const tb = opts.themeBg ?? null
  const light = tb != null && luminance(tb) > 0.5
  const sub =
    tb == null
      ? { c0: '#191230', c1: '#120c22', c2: '#0b0816' }
      : light
        ? { c0: rgbCss(tb), c1: rgbCss(tb), c2: rgbCss(mixRgb(tb, [246, 242, 234], 0.45)) }
        : {
            c0: rgbCss(mixRgb(tb, DEEP, 0.45)),
            c1: rgbCss(mixRgb(tb, DEEP, 0.68)),
            c2: rgbCss(mixRgb(tb, DEEP, 0.88)),
          }
  const bg = ctx.createRadialGradient(LW * 0.5, LH * 0.42, 40, LW * 0.5, LH * 0.5, LW * 0.75)
  bg.addColorStop(0, sub.c0)
  bg.addColorStop(0.6, sub.c1)
  bg.addColorStop(1, sub.c2)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, LW, LH)
  for (let i = 0; i < 3; i++) {
    const wx = rnd() * LW
    const wy = rnd() * LH
    const wr = 140 + rnd() * 170
    const wg = ctx.createRadialGradient(wx, wy, 0, wx, wy, wr)
    // violet humus washes — on a light substrate they would grey it out
    const washA = light ? 0.02 : 0.05
    wg.addColorStop(0, `rgba(124,110,200,${washA})`)
    wg.addColorStop(1, 'rgba(124,110,200,0)')
    ctx.fillStyle = wg
    ctx.fillRect(0, 0, LW, LH)
  }

  // --- node lattice: a jittered grid — even coverage, organic spacing ------
  // phones cover-crop the landscape art to its middle third, so the lattice
  // must stay dense enough to read as a full web even from a 30% strip ----
  const spacing = Math.max(24, (62 - (density / 100) * 26) * sc)
  const gcols = Math.max(6, Math.round(LW / spacing))
  const grows = Math.max(5, Math.round(LH / spacing))
  const NN = gcols * grows
  const nx = new Float32Array(NN)
  const ny = new Float32Array(NN)
  for (let j = 0; j < grows; j++) {
    for (let i = 0; i < gcols; i++) {
      const k = j * gcols + i
      nx[k] = ((i + 0.5) / gcols) * LW + (rnd() - 0.5) * spacing * 0.9
      ny[k] = ((j + 0.5) / grows) * LH + (rnd() - 0.5) * spacing * 0.9
    }
  }

  // --- shared filament record + drawer -------------------------------------
  // every stroke in the network is a bowed quadratic sampled at thirds
  // (a gently sagging 4-point path) drawn twice: a soft wide halo (light
  // IN the filament) and a tapered core (thin-dim → thick-bright → thin-dim).
  // On dark substrates everything composites additively so crossings pool
  // their light like the reference.
  const glowK = glow / 100
  const VIOLET: [number, number, number] = light ? [82, 58, 190] : [167, 139, 250]
  const CYAN: [number, number, number] = light ? [8, 145, 178] : [125, 211, 252]
  const edgeCol = () => mixRgb(VIOLET, CYAN, rnd() * 0.6)
  interface Filament {
    ax: number
    ay: number
    bx: number
    by: number
    bow: number // perpendicular sag of the arc, as a chord fraction
    w: number
    a0: number
    haloK: number // halo strength multiplier (strands glow, mesh whispers)
    col: [number, number, number]
  }
  const rgba = (c: [number, number, number], a: number) =>
    `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`
  ctx.globalCompositeOperation = light ? 'source-over' : 'lighter'
  ctx.lineCap = 'round'
  const drawFilament = (e: Filament) => {
    const mx = (e.ax + e.bx) / 2
    const my = (e.ay + e.by) / 2
    const dx = e.bx - e.ax
    const dy = e.by - e.ay
    const cxp = mx - dy * e.bow
    const cyp = my + dx * e.bow
    // TRUE smooth arcs: quadraticCurveTo renders a real curve, not a
    // polyline — segment chains read as "straight beams with kinks", which
    // is exactly the look we are replacing
    const haloA = (light ? 0.08 : 0.13) * (0.45 + glowK) * e.haloK
    ctx.strokeStyle = rgba(e.col, haloA)
    ctx.lineWidth = e.w * (2.4 + glowK * 2.2) * (0.7 + 0.3 * e.haloK)
    ctx.beginPath()
    ctx.moveTo(e.ax, e.ay)
    ctx.quadraticCurveTo(cxp, cyp, e.bx, e.by)
    ctx.stroke()
    // core: one smooth arc at full width — the taper lives ACROSS hops
    // (each hop of a strand carries its own thinner width)
    ctx.strokeStyle = rgba(e.col, e.a0)
    ctx.lineWidth = Math.max(0.7, e.w)
    ctx.beginPath()
    ctx.moveTo(e.ax, e.ay)
    ctx.quadraticCurveTo(cxp, cyp, e.bx, e.by)
    ctx.stroke()
  }

  // --- the substrate mesh: short faint links between lattice neighbours ---
  // tight radius, axis-aligned links dropped at extra rate (diagonals carry
  // the web), and a low-frequency block mask so the mesh clusters with
  // breathing voids instead of covering the canvas evenly ---------------
  const mesh: Filament[] = []
  const deg = new Uint8Array(NN)
  const linkR = spacing * 1.5
  const linkR2 = linkR * linkR
  const blockCols = Math.ceil(gcols / 2)
  const blockDrop = new Float32Array(blockCols * Math.ceil(grows / 2))
  for (let i = 0; i < blockDrop.length; i++) blockDrop[i] = 0.22 + rnd() * 0.42
  for (let j = 0; j < grows; j++) {
    for (let i = 0; i < gcols; i++) {
      const a = j * gcols + i
      const drop = blockDrop[(j >> 1) * blockCols + (i >> 1)]!
      for (let dj = 0; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (dj === 0 && di <= 0) continue
          const i2 = i + di
          const j2 = j + dj
          if (i2 < 0 || i2 >= gcols || j2 >= grows) continue
          const b = j2 * gcols + i2
          const dx = nx[a]! - nx[b]!
          const dy = ny[a]! - ny[b]!
          if (dx * dx + dy * dy > linkR2) continue
          const axis = di === 0 || dj === 0
          if (rnd() < drop + (axis ? 0.32 : 0)) continue
          deg[a] = deg[a] < 255 ? deg[a] + 1 : deg[a]
          deg[b] = deg[b] < 255 ? deg[b] + 1 : deg[b]
          mesh.push({
            ax: nx[a]!,
            ay: ny[a]!,
            bx: nx[b]!,
            by: ny[b]!,
            bow: (rnd() - 0.5) * 0.9,
            w: 0.65 + rnd() * 0.5,
            a0: 0.16 + rnd() * 0.14,
            haloK: 0.7,
            col: edgeCol(),
          })
        }
      }
    }
  }
  for (const e of mesh) drawFilament(e)

  // --- the hyphae: long wandering strands — the mycelium proper -----------
  // Each strand is a chain of long arcs (1-2 spacings per hop) that keeps a
  // heading with a lazy wander, TAPERS along its length, and occasionally
  // forks a child strand. HUBS bias the growth: several strands germinate
  // at a hub and others aim their first hops toward one, so the web CLUSTERS
  // into luminous knots (the reference's layered look) instead of scattering
  // evenly. Bright "junction" pinpoints land on the strand vertices. -------
  const strandFils: Filament[] = []
  const vertices: { x: number; y: number; w: number; hub: boolean }[] = []
  const branchBudget = { left: Math.round(14 + (density / 100) * 10) }
  const hubCount = 7 + Math.floor(rnd() * 4)
  const hubs: { x: number; y: number }[] = []
  for (let i = 0; i < hubCount; i++) {
    hubs.push({ x: LW * 0.16 + rnd() * LW * 0.68, y: LH * 0.16 + rnd() * LH * 0.68 })
  }
  const nearHub = (x: number, y: number, r: number) =>
    hubs.some((hb) => (hb.x - x) ** 2 + (hb.y - y) ** 2 < r * r)
  const M = 24 // off-canvas margin
  const growStrand = (x0: number, y0: number, heading: number, hops: number, w0: number, a0: number) => {
    let px = x0
    let py = y0
    let h = heading
    for (let s = 0; s < hops; s++) {
      // lazy wander: small heading turns keep the arcs long and sweeping —
      // sharp turns would read as a zigzag of short links again
      h += (rnd() - 0.5) * 0.6
      const len = spacing * (1.2 + rnd() * 1.3)
      const qx = px + Math.cos(h) * len
      const qy = py + Math.sin(h) * len
      if (qx < -M || qx > LW + M || qy < -M || qy > LH + M) break
      const taper = 1 - 0.5 * (s / Math.max(1, hops - 1))
      const w = Math.max(0.5, w0 * taper)
      strandFils.push({
        ax: px,
        ay: py,
        bx: qx,
        by: qy,
        // long lazy sag, sign alternating-ish per hop
        bow: (rnd() < 0.5 ? -1 : 1) * (0.22 + rnd() * 0.26),
        w,
        a0: a0 * (0.72 + 0.28 * taper),
        haloK: 1,
        col: rnd() < 0.12 ? CYAN : edgeCol(),
      })
      vertices.push({ x: qx, y: qy, w, hub: nearHub(qx, qy, 90) })
      // fork: a child strand leaves at a wider angle — the branching that
      // makes it mycelium rather than a bundle of arcs
      if (s >= 1 && branchBudget.left > 0 && rnd() < 0.3) {
        branchBudget.left--
        growStrand(
          qx,
          qy,
          h + (rnd() < 0.5 ? -1 : 1) * (0.65 + rnd() * 0.6),
          2 + Math.floor(rnd() * 3),
          w0 * 0.72,
          a0 * 0.88,
        )
      }
      px = qx
      py = qy
    }
  }
  const strandCount = Math.round(26 + (density / 100) * 30)
  for (let s = 0; s < strandCount; s++) {
    const trunk = rnd() < 0.3
    const w0 = trunk ? 2.4 + rnd() * 1.1 : 1.0 + rnd() * 0.9
    const a0 = trunk ? 0.52 + rnd() * 0.16 : 0.34 + rnd() * 0.18
    const roll = rnd()
    if (roll < 0.45) {
      // germinate AT a hub, heading outward — the knot grows from its center
      const hb = hubs[Math.floor(rnd() * hubs.length)]!
      growStrand(hb.x, hb.y, rnd() * Math.PI * 2, 4 + Math.floor(rnd() * 5), w0, a0)
    } else if (roll < 0.72) {
      // start elsewhere but aim the first hops at the nearest hub — the
      // strand sweeps toward the cluster and threads it
      const sx = rnd() * LW
      const sy = rnd() * LH
      let best = hubs[0]!
      let bd = Infinity
      for (const hb of hubs) {
        const d = (hb.x - sx) ** 2 + (hb.y - sy) ** 2
        if (d < bd) {
          bd = d
          best = hb
        }
      }
      growStrand(sx, sy, Math.atan2(best.y - sy, best.x - sx) + (rnd() - 0.5) * 0.5, 5 + Math.floor(rnd() * 4), w0, a0)
    } else {
      growStrand(rnd() * LW, rnd() * LH, rnd() * Math.PI * 2, 4 + Math.floor(rnd() * 5), w0, a0)
    }
  }
  // hub bloom: a soft luminous wash under each knot — light pooled where
  // the strands braid, the layered glow of the reference
  for (const hb of hubs) {
    const R = 60 + rnd() * 70
    const g = ctx.createRadialGradient(hb.x, hb.y, 0, hb.x, hb.y, R)
    const hc = rnd() < 0.4 ? CYAN : VIOLET
    g.addColorStop(0, rgba(hc, light ? 0.05 : 0.08 + glowK * 0.07))
    g.addColorStop(1, rgba(hc, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(hb.x, hb.y, R, 0, Math.PI * 2)
    ctx.fill()
  }
  for (const e of strandFils) drawFilament(e)

  // feathers: short fine arcs leaving the strand vertices — the fuzzy
  // micro-branch texture that hugs the real network, denser around hubs
  const featherCount = Math.round(vertices.length * 0.8)
  for (let i = 0; i < featherCount; i++) {
    const v = vertices[Math.floor(rnd() * vertices.length)]!
    if (!v.hub && rnd() < 0.45) continue // hub vertices feather more
    const len = 12 + rnd() * 22
    const ang = rnd() * Math.PI * 2
    drawFilament({
      ax: v.x,
      ay: v.y,
      bx: v.x + Math.cos(ang) * len,
      by: v.y + Math.sin(ang) * len,
      bow: (rnd() - 0.5) * 0.9,
      w: 0.5 + rnd() * 0.45,
      a0: 0.14 + rnd() * 0.14,
      haloK: 0.4,
      col: edgeCol(),
    })
  }

  // micro-filaments: short faint wisps between everything — the fuzzy
  // substrate of the reference, filling what would otherwise be dead dark
  // patches. Never bright enough to compete with the strands.
  const wispCount = Math.round(NN * 0.5)
  for (let i = 0; i < wispCount; i++) {
    let wx = rnd() * LW
    let wy = rnd() * LH
    let wa = rnd() * Math.PI * 2
    const col = edgeCol()
    const segs = 2 + Math.floor(rnd() * 2)
    const wa0 = (light ? 0.06 : 0.08) + rnd() * (light ? 0.06 : 0.09)
    ctx.strokeStyle = rgba(col, wa0)
    ctx.lineWidth = 0.45 + rnd() * 0.5
    ctx.beginPath()
    ctx.moveTo(wx, wy)
    for (let s = 0; s < segs; s++) {
      wa += (rnd() - 0.5) * 1.3
      wx += Math.cos(wa) * (10 + rnd() * 16)
      wy += Math.sin(wa) * (10 + rnd() * 16)
      ctx.lineTo(wx, wy)
    }
    ctx.stroke()
  }

  // --- junctions: bright pinpoints on the strand vertices (thicker strand
  //     → brighter dot), each with a TIGHT glow — many small sparkles, not
  //     bokeh balls ----------------------------------------------------------
  const CORE = light ? 'rgba(46,29,124,0.95)' : 'rgba(214,202,250,0.93)'
  for (const v of vertices) {
    // bright tier on ~40% of vertices (trunk ends and hub vertices
    // favoured), dim tier on another ~30% — the rest stay unlit so the
    // sparkle stays sparse
    const roll = rnd()
    const bright = roll < (v.hub || v.w > 1.6 ? 0.6 : 0.34)
    if (!bright && roll > 0.66) continue
    const r = (bright ? 0.85 + rnd() * 0.6 : 0.55 + rnd() * 0.35) * (v.w > 1.6 ? 1.2 : 1)
    const halo = r * (bright ? 2.6 + glowK * 3.2 : 1.6 + glowK * 1.8)
    const g = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, halo)
    const hc = rnd() < 0.35 ? CYAN : VIOLET
    const ha = (light ? 0.12 : 0.2 + glowK * 0.2) * (bright ? 1.25 : 0.6)
    g.addColorStop(0, rgba(hc, ha))
    g.addColorStop(0.5, rgba(hc, ha * 0.35))
    g.addColorStop(1, rgba(hc, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(v.x, v.y, halo, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = CORE
    ctx.beginPath()
    ctx.arc(v.x, v.y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'

  // vignette — heavy on the glowy dark substrate, a whisper on paper
  const vg = ctx.createRadialGradient(LW / 2, LH / 2, LH * 0.32, LW / 2, LH / 2, LW * 0.72)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, `rgba(0,0,0,${light ? 0.14 : 0.46})`)
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, LW, LH)
  return canvas.toDataURL('image/webp', 0.9)
}

// ---------------------------------------------------------------------------
// Mineral — a real photograph (public/backgrounds/mineral.webp): dark stone
// with quiet veining, zoomable like any other background. See
// BackgroundLayer for the renderer.
// ---------------------------------------------------------------------------
export const MINERAL_IMAGE_URL = '/backgrounds/mineral.webp'

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

export function generateIridescence(opts: { intensity: number; seed?: number }): string {
  const { intensity } = opts
  const rnd = mulberry32(opts.seed ?? 777)
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
