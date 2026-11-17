// ---------------------------------------------------------------------------
// PWA boot personalisation — the bridge between the appearance system and the
// service worker.
//
// The OS-level chrome of an installed PWA is coloured from STATIC document
// data, not from anything a script can change after the fact:
//
//   - iOS standalone reads <meta name="apple-mobile-web-app-status-bar-style">
//     from the launch HTML — a runtime DOM insertion is ignored, so a dark
//     theme still booted under a white status bar (white flash after the
//     launch snapshot);
//   - Android builds its launch splash from the manifest's theme_color /
//     background_color.
//
// The server can't personalise either file (the theme lives in the user's
// account, the HTML is unauthenticated), so the service worker does it: this
// module mirrors the active appearance into a tiny CacheStorage record the
// worker CAN read, and public/sw.js injects the matching metas into every
// navigation response (and rewrites the manifest colours) before the browser
// ever sees them. writePwaMetaCache() is called wherever the offline settings
// cache is refreshed, so the two never drift.
//
// Storage notes: CacheStorage (not localStorage) because service workers have
// no DOM access; one record per device, last-applied appearance wins — the
// same policy as the offline settings cache it shadows.
// ---------------------------------------------------------------------------

import { isCustomThemeDark, paletteMeta, statusBarColorFor } from '@/lib/appearance/palettes'
import type { AppearanceSettings } from '@/lib/appearance/types'

/** Keep in sync with META_CACHE / META_KEY in public/sw.js. */
const META_CACHE = 'momentum-pwa-meta'
const META_KEY = '/__pwa-meta'

export interface PwaMeta {
  /** the page-background hex the status bar / splash should wear */
  themeColor: string
  /** renders dark (iOS bar style black vs default) */
  dark: boolean
}

/** The boot-time chrome colours for one appearance. */
export function pwaMetaFor(appearance: AppearanceSettings): PwaMeta {
  return {
    themeColor: statusBarColorFor(appearance.theme, appearance.custom),
    dark:
      appearance.theme === 'custom'
        ? isCustomThemeDark(appearance.custom)
        : (paletteMeta(appearance.theme)?.dark ?? false),
  }
}

/**
 * Mirror the active appearance into CacheStorage for the service worker.
 * Fire-and-forget: a failure (private mode, quota, missing support) just
 * means the worker keeps serving unpersonalised HTML — the in-page boot
 * script still paints the right colours.
 */
export function writePwaMetaCache(appearance: AppearanceSettings): void {
  if (typeof caches === 'undefined') return
  try {
    const meta = pwaMetaFor(appearance)
    void caches
      .open(META_CACHE)
      .then((c) =>
        c.put(
          META_KEY,
          new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }),
        ),
      )
      .catch(() => {})
  } catch {
    // caches throwing synchronously (some privacy modes) — nothing to do
  }
}
