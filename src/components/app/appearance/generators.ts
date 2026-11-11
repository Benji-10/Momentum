// ---------------------------------------------------------------------------
// Static background art generators.
//
// Each generator returns a data-URL image (SVG markup or a canvas render),
// produced once per settings change (the caller memoizes) — never per frame.
// "Image-style" backgrounds (mycelium, mineral, carbon, iridescence) are
// rendered procedurally to a static image, so the app ships no binary assets.
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

// ---------------------------------------------------------------------------
// Topography — procedural contour lines (SVG)
// ---------------------------------------------------------------------------

export function generateTopography(opts: {
  fg: string
  intensity: number // 0..100
  scale: number // 40..220 (%)
}): string {
  const { fg, intensity, scale } = opts
  const rnd = mulberry32(1337)
  const parts: string[] = []
  const peaks = 3 + Math.floor(rnd() * 3)
  const step = 30 * (scale / 100)

  for (let p = 0; p < peaks; p++) {
    const cx = 180 + rnd() * (W - 360)
    const cy = 120 + rnd() * (H - 240)
    const rings = 8 + Math.floor(rnd() * 8)
    const a1 = rnd() * Math.PI * 2
    const a2 = rnd() * Math.PI * 2
    for (let r = 1; r <= rings; r++) {
      const radius = r * step
      const pts: string[] = []
      const n = 46
      for (let i = 0; i <= n; i++) {
        const ang = (i / n) * Math.PI * 2
        const w =
          1 +
          0.15 * Math.sin(ang * 3 + a1) +
          0.1 * Math.sin(ang * 5 + a2) +
          0.06 * Math.sin(ang * 8 + a1 * 2)
        pts.push(
          `${(cx + Math.cos(ang) * radius * w).toFixed(1)},${(cy + Math.sin(ang) * radius * w * 0.76).toFixed(1)}`,
        )
      }
      const fade = 1 - (r - 1) / rings // inner rings stronger
      const alpha = (0.05 + (0.16 * intensity) / 100) * (0.35 + 0.65 * fade)
      parts.push(
        `<polyline points="${pts.join(' ')}" fill="none" stroke="${fg}" stroke-width="${r === rings ? 1.5 : 1}" opacity="${alpha.toFixed(3)}" stroke-linejoin="round"/>`,
      )
    }
  }
  // a few small independent contour clusters for texture
  for (let c = 0; c < 5; c++) {
    const cx = 100 + rnd() * (W - 200)
    const cy = 80 + rnd() * (H - 160)
    const rings = 2 + Math.floor(rnd() * 3)
    const a = rnd() * Math.PI * 2
    for (let r = 1; r <= rings; r++) {
      const pts: string[] = []
      for (let i = 0; i <= 30; i++) {
        const ang = (i / 30) * Math.PI * 2
        const rad = r * step * 0.45 * (1 + 0.2 * Math.sin(ang * 4 + a))
        pts.push(`${(cx + Math.cos(ang) * rad).toFixed(1)},${(cy + Math.sin(ang) * rad * 0.8).toFixed(1)}`)
      }
      parts.push(
        `<polyline points="${pts.join(' ')}" fill="none" stroke="${fg}" stroke-width="0.9" opacity="${((0.04 + (0.1 * intensity) / 100)).toFixed(3)}"/>`,
      )
    }
  }
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`)
}

// ---------------------------------------------------------------------------
// Fractals — recursive branching canopy (SVG)
// ---------------------------------------------------------------------------

function branch(
  x: number,
  y: number,
  angle: number,
  len: number,
  depth: number,
  width: number,
  fg: string,
  alpha: number,
  rnd: () => number,
  out: string[],
) {
  const x2 = x + Math.cos(angle) * len
  const y2 = y + Math.sin(angle) * len
  out.push(
    `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${fg}" stroke-width="${width.toFixed(2)}" opacity="${alpha.toFixed(3)}" stroke-linecap="round"/>`,
  )
  if (depth <= 0 || len < 4) return
  const spread = 0.36 + rnd() * 0.18
  branch(x2, y2, angle - spread, len * (0.7 + rnd() * 0.08), depth - 1, width * 0.74, fg, alpha, rnd, out)
  branch(x2, y2, angle + spread, len * (0.7 + rnd() * 0.08), depth - 1, width * 0.74, fg, alpha, rnd, out)
  if (rnd() < 0.16) {
    branch(x2, y2, angle + (rnd() - 0.5) * 0.3, len * 0.5, depth - 1, width * 0.5, fg, alpha, rnd, out)
  }
}

export function generateFractals(opts: { fg: string; intensity: number; scale: number }): string {
  const { fg, intensity, scale } = opts
  const rnd = mulberry32(4242)
  const out: string[] = []
  const alpha = 0.06 + (0.16 * intensity) / 100
  const len = 52 * (scale / 100)
  const depth = 8

  // roots along the bottom edge, growing upward
  const roots = 6
  for (let i = 0; i < roots; i++) {
    const x = (W / (roots + 1)) * (i + 1) + (rnd() - 0.5) * 120
    branch(x, H + 30, -Math.PI / 2 + (rnd() - 0.5) * 0.4, len, depth, 2.4, fg, alpha, rnd, out)
  }
  // two canopies hanging in from the top corners
  branch(-20, -10, Math.PI / 3, len * 0.85, depth - 1, 2, fg, alpha, rnd, out)
  branch(W + 20, -10, (2 * Math.PI) / 3, len * 0.85, depth - 1, 2, fg, alpha, rnd, out)
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`)
}

// ---------------------------------------------------------------------------
// Mycelium — branching hyphal network with bioluminescent nodes (canvas)
// ---------------------------------------------------------------------------

interface Walker {
  x: number
  y: number
  angle: number
  speed: number
  life: number
  width: number
}

export function generateMycelium(opts: { density: number; glow: number; scale: number }): string {
  const { density, glow, scale } = opts
  const rnd = mulberry32(90210)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // deep-purple substrate
  const bgGrad = ctx.createRadialGradient(W * 0.5, H * 0.42, 80, W * 0.5, H * 0.5, W * 0.75)
  bgGrad.addColorStop(0, '#1c1330')
  bgGrad.addColorStop(0.6, '#140e24')
  bgGrad.addColorStop(1, '#0c0916')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, W, H)

  const startCount = Math.round(10 + (density / 100) * 16)
  const maxWalkers = 90
  const queue: Walker[] = []
  for (let i = 0; i < startCount; i++) {
    queue.push({
      x: rnd() * W,
      y: rnd() * H,
      angle: rnd() * Math.PI * 2,
      speed: (2 + rnd() * 2.2) * (scale / 100),
      life: 220 + Math.floor(rnd() * 260),
      width: 1 + rnd() * 0.8,
    })
  }
  let spawnBudget = maxWalkers - startCount
  const stepLen = 3.2

  while (queue.length) {
    const wk = queue.shift()!
    for (let s = 0; s < wk.life; s++) {
      wk.angle += (rnd() - 0.5) * 0.55
      const nx = wk.x + Math.cos(wk.angle) * stepLen
      const ny = wk.y + Math.sin(wk.angle) * stepLen
      if (nx < -20 || nx > W + 20 || ny < -20 || ny > H + 20) break
      ctx.strokeStyle = `rgba(167, 139, 250, ${0.1 + rnd() * 0.12})`
      ctx.lineWidth = wk.width
      ctx.beginPath()
      ctx.moveTo(wk.x, wk.y)
      ctx.lineTo(nx, ny)
      ctx.stroke()
      // bioluminescent node at branch points (and occasionally along a run)
      if (rnd() < 0.012 + (glow / 100) * 0.01) {
        const r = 1.4 + rnd() * 2.2
        const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, r * (3 + glow * 0.09))
        g.addColorStop(0, 'rgba(196, 181, 253, 0.85)')
        g.addColorStop(0.35, 'rgba(167, 139, 250, 0.35)')
        g.addColorStop(1, 'rgba(167, 139, 250, 0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(nx, ny, r * (3 + glow * 0.09), 0, Math.PI * 2)
        ctx.fill()
      }
      wk.x = nx
      wk.y = ny
      // branch
      if (rnd() < 0.006 + (density / 100) * 0.01 && spawnBudget > 0) {
        spawnBudget--
        queue.push({
          x: nx,
          y: ny,
          angle: wk.angle + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.7),
          speed: wk.speed * 0.9,
          life: Math.floor(wk.life * 0.55),
          width: wk.width * 0.8,
        })
      }
    }
  }
  return canvas.toDataURL('image/png')
}

// ---------------------------------------------------------------------------
// Mineral — layered agate banding (canvas)
// ---------------------------------------------------------------------------

export function generateMineral(opts: { scale: number }): string {
  const { scale } = opts
  const rnd = mulberry32(555)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  const base = ctx.createLinearGradient(0, 0, W, H)
  base.addColorStop(0, '#191310')
  base.addColorStop(1, '#211a14')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, W, H)

  const cx = W * (0.36 + rnd() * 0.28)
  const cy = H * (0.4 + rnd() * 0.2)
  const bands = 22
  const maxR = Math.hypot(W, H) * 0.62
  const palette = ['#5b4636', '#8a6a4f', '#d9c5a5', '#453a30', '#a8845f', '#6e5a48', '#c9b391', '#3d332b']
  const a1 = rnd() * Math.PI * 2
  const a2 = rnd() * Math.PI * 2

  for (let b = bands; b >= 1; b--) {
    const radius = (b / bands) * maxR * (scale / 100 + 0.4)
    const col = palette[(b + Math.floor(rnd() * 2)) % palette.length]
    ctx.beginPath()
    const n = 72
    for (let i = 0; i <= n; i++) {
      const ang = (i / n) * Math.PI * 2
      const w =
        1 +
        0.08 * Math.sin(ang * 4 + a1) +
        0.05 * Math.sin(ang * 7 + a2) +
        0.03 * Math.sin(ang * 11 + a1)
      const x = cx + Math.cos(ang) * radius * w
      const y = cy + Math.sin(ang) * radius * w * 0.82
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fillStyle = col
    ctx.globalAlpha = 0.55 + rnd() * 0.3
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // crystal specks
  for (let i = 0; i < 320; i++) {
    const x = rnd() * W
    const y = rnd() * H
    const r = rnd() * 1.3
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(217, 197, 165, 0.3)' : 'rgba(255, 255, 255, 0.16)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, W, H)
  return canvas.toDataURL('image/png')
}

// ---------------------------------------------------------------------------
// Carbon — carbon-fibre weave (SVG pattern)
// ---------------------------------------------------------------------------

export function generateCarbon(opts: { scale: number }): string {
  const t = Math.max(8, Math.round(30 * (opts.scale / 100)))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a403a"/><stop offset="0.5" stop-color="#20241f"/><stop offset="1" stop-color="#101210"/></linearGradient>
<linearGradient id="b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a403a"/><stop offset="0.5" stop-color="#20241f"/><stop offset="1" stop-color="#101210"/></linearGradient>
<pattern id="w" width="${t * 2}" height="${t * 2}" patternUnits="userSpaceOnUse">
<rect width="${t * 2}" height="${t * 2}" fill="#0d0f0d"/>
<rect x="1" y="1" width="${t - 2}" height="${t - 2}" fill="url(#a)" rx="2"/>
<rect x="${t + 1}" y="1" width="${t - 2}" height="${t - 2}" fill="url(#b)" rx="2"/>
<rect x="1" y="${t + 1}" width="${t - 2}" height="${t - 2}" fill="url(#b)" rx="2"/>
<rect x="${t + 1}" y="${t + 1}" width="${t - 2}" height="${t - 2}" fill="url(#a)" rx="2"/>
</pattern>
</defs>
<rect width="${W}" height="${H}" fill="url(#w)"/>
</svg>`
  return svgUrl(svg)
}

// ---------------------------------------------------------------------------
// Iridescence — oil-slick reflections (SVG, blurred gradients)
// ---------------------------------------------------------------------------

export function generateIridescence(opts: { intensity: number }): string {
  const { intensity } = opts
  const rnd = mulberry32(777)
  const blobs: string[] = []
  const colours = ['#ff3d81', '#22d3ee', '#fbbf24', '#a78bfa', '#2dd4bf', '#f472b6', '#818cf8']
  const count = 7
  for (let i = 0; i < count; i++) {
    const cx = Math.round(rnd() * W)
    const cy = Math.round(rnd() * H)
    const rx = Math.round(240 + rnd() * 380)
    const ry = Math.round(180 + rnd() * 320)
    const rot = Math.round(rnd() * 180)
    const op = (0.16 + (0.3 * intensity) / 100).toFixed(3)
    blobs.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${colours[i % colours.length]}" opacity="${op}" transform="rotate(${rot} ${cx} ${cy})"/>`,
    )
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><filter id="b" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="70"/></filter>
<linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050507" stop-opacity="0.1"/><stop offset="1" stop-color="#050507" stop-opacity="0.75"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="#07070a"/>
<g filter="url(#b)">${blobs.join('')}</g>
<rect width="${W}" height="${H}" fill="url(#d)"/>
</svg>`
  return svgUrl(svg)
}

// ---------------------------------------------------------------------------
// Film-grain noise overlay (used by Nebula)
// ---------------------------------------------------------------------------

export const NOISE_IMAGE_URL = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="300" height="300" filter="url(#n)"/></svg>`,
)
