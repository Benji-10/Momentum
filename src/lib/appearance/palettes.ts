// ---------------------------------------------------------------------------
// Colour palettes — the catalog of the 14 presets.
//
// The actual colour VALUES live once, in globals.css (`[data-theme='…']`
// blocks), so presets render pre-paint with zero JS. This module holds the
// metadata the UI needs (labels, grouping, which are dark) plus:
//
//   - legacy key migration (the six original themes map onto the new set)
//   - the CSS-variable expansion of a CustomTheme (the 11 editable roles
//     become the full ~30-variable palette via color-mix / luminance-derived
//     foregrounds, so a custom palette is as complete as any preset)
//
// Palette previews in the UI don't duplicate values either: a preview card is
// a small div carrying its own data-theme attribute, and the CSS cascade
// renders it with the real palette.
// ---------------------------------------------------------------------------

import type { CustomTheme } from './types'

export interface PaletteMeta {
  key: string
  label: string
  /** one-line hint shown under the label */
  hint: string
  /** renders on a dark surface (drives toast theme, etc.) */
  dark: boolean
  /** standard five first, then the signature palettes */
  group: 'standard' | 'signature'
}

/** The 14 preset palettes (values in globals.css). */
export const PALETTES: PaletteMeta[] = [
  { key: 'light', label: 'Light', hint: 'Clean neutral light', dark: false, group: 'standard' },
  { key: 'dark', label: 'Dark', hint: 'Neutral dark', dark: true, group: 'standard' },
  { key: 'forest', label: 'Forest', hint: 'Deep green dark', dark: true, group: 'standard' },
  { key: 'berry', label: 'Berry', hint: 'Soft berry light', dark: false, group: 'standard' },
  { key: 'sunset', label: 'Sunset', hint: 'Warm amber dark', dark: true, group: 'standard' },
  { key: 'petrolhead', label: 'Petrolhead', hint: 'Racing green · charcoal · cream', dark: true, group: 'signature' },
  { key: 'ultraviolet', label: 'Ultraviolet', hint: 'Aubergine · deep purple · lavender', dark: true, group: 'signature' },
  { key: 'pomegranate', label: 'Pomegranate', hint: 'Burgundy · crimson · warm pink', dark: true, group: 'signature' },
  { key: 'cryosphere', label: 'Cryosphere', hint: 'Blue-grey · teal · glacial cyan', dark: true, group: 'signature' },
  { key: 'marigold', label: 'Marigold', hint: 'Dark olive · antique gold · cream', dark: true, group: 'signature' },
  { key: 'nightshade', label: 'Nightshade', hint: 'Dark plum · chartreuse · green', dark: true, group: 'signature' },
  { key: 'oxidation', label: 'Oxidation', hint: 'Charcoal · brown · copper', dark: true, group: 'signature' },
  { key: 'afterburn', label: 'Afterburn', hint: 'Near-black · burnt orange · peach', dark: true, group: 'signature' },
  { key: 'mycelium', label: 'Mycelium', hint: 'Deep purple · violet · lavender', dark: true, group: 'signature' },
]

export const PALETTE_KEYS = PALETTES.map((p) => p.key)

export function isPaletteKey(key: string): boolean {
  return PALETTE_KEYS.includes(key)
}

export function paletteMeta(key: string): PaletteMeta | undefined {
  return PALETTES.find((p) => p.key === key)
}

/**
 * The six original themes, mapped onto the new catalog. Used when reading
 * stored settings (server rows and offline caches written before the
 * appearance system existed). globals.css keeps alias selectors for the same
 * keys so a pre-migration paint still shows the right colours.
 */
const LEGACY_THEMES: Record<string, string> = {
  paper: 'light',
  meadow: 'light',
  blossom: 'berry',
  charcoal: 'dark',
  forest: 'forest',
  sunset: 'sunset',
}

/** Map any stored theme key (current or legacy) to a current palette key. */
export function migrateThemeKey(key: string | null | undefined): string {
  if (!key) return 'light'
  if (key === 'custom' || isPaletteKey(key)) return key
  return LEGACY_THEMES[key] ?? 'light'
}

/** Palettes that render on a dark surface (custom decided by its background). */
export const DARK_PALETTES = PALETTES.filter((p) => p.dark).map((p) => p.key)

// ---------------------------------------------------------------------------
// Custom theme → CSS variables
// ---------------------------------------------------------------------------

/** Relative luminance of a #rrggbb colour (0..1, WCAG-ish). */
export function hexLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** Black-ish or white-ish text for maximum contrast on the given colour. */
export function contrastText(hex: string): string {
  return hexLuminance(hex) > 0.35 ? '#141414' : '#fbfbfb'
}

/** 'rgba(r, g, b, a)' from a hex colour. */
export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * Expand a CustomTheme into the full set of CSS custom properties. Injected
 * as a <style> on `html[data-theme='custom']` — the same variables every
 * preset defines, so nothing downstream needs to know a theme is custom.
 * Derived roles (hover surfaces, focus rings, chart colours, foregrounds on
 * coloured fills) are computed with color-mix and luminance contrasts.
 */
export function customThemeCss(t: CustomTheme): string {
  const onPrimary = contrastText(t.primary)
  const onSuccess = contrastText(t.success)
  const onWarning = contrastText(t.warning)
  const onError = contrastText(t.error)
  const isDarkSurface = hexLuminance(t.background) < 0.3
  return `
html[data-theme='custom'] {
  color-scheme: ${isDarkSurface ? 'dark' : 'light'};
  --background: ${t.background};
  --foreground: ${t.text};
  --card-solid: ${t.surface};
  --card-foreground: ${t.text};
  --popover-solid: ${t.surface};
  --popover-foreground: ${t.text};
  --primary: ${t.primary};
  --primary-foreground: ${onPrimary};
  --secondary: ${t.surfaceAlt};
  --secondary-foreground: ${t.text};
  --muted: ${t.surfaceAlt};
  --muted-foreground: ${t.textMuted};
  --accent: color-mix(in oklab, ${t.accent2} 14%, ${t.surface});
  --accent-foreground: ${t.text};
  --destructive: ${t.error};
  --destructive-foreground: ${onError};
  --success: ${t.success};
  --success-foreground: ${onSuccess};
  --warning: ${t.warning};
  --warning-foreground: ${onWarning};
  --border: ${t.border};
  --input: ${t.border};
  --ring: ${t.primary};
  --chart-1: ${t.primary};
  --chart-2: ${t.accent2};
  --chart-3: ${t.warning};
  --chart-4: ${t.success};
  --chart-5: color-mix(in oklab, ${t.accent2} 60%, ${t.primary});
  --sidebar: ${t.surface};
  --sidebar-foreground: ${t.text};
  --sidebar-primary: ${t.primary};
  --sidebar-primary-foreground: ${onPrimary};
  --sidebar-accent: color-mix(in oklab, ${t.accent2} 14%, ${t.surface});
  --sidebar-accent-foreground: ${t.text};
  --sidebar-border: ${t.border};
  --sidebar-ring: ${t.primary};
}`.trim()
}

/** Does a custom palette render dark? (drives toast theme + previews) */
export function isCustomThemeDark(t: CustomTheme | null): boolean {
  return !t || hexLuminance(t.background) < 0.3
}
