/**
 * Momentum service worker — makes the app shell itself work offline.
 *
 * The page's data layer (lib/offline.ts) already keeps a localStorage
 * snapshot of the goals and queues offline mutations, but without this
 * worker a *reload* with no connection would die at the HTML request.
 * Here:
 *
 *  - Navigations (document requests): network-first, falling back to the
 *    cached shell. A fresh deploy is picked up immediately when online;
 *    offline you still boot into the app and see your synced list.
 *  - PWA boot chrome: the worker personalises every navigation response
 *    with the account's theme (status-bar metas + html background, from the
 *    momentum-pwa-meta cache the page keeps fresh) and rewrites the
 *    manifest's theme/background colours the same way. iOS reads the
 *    apple-mobile-web-app-status-bar-style meta from the launch HTML and
 *    ignores runtime DOM changes — without this, a dark theme boots under
 *    a white status bar; Android's launch splash comes from the manifest.
 *  - Hashed build assets (/_next/static/...) and icons: cache-first —
 *    they are immutable, so no request is needed after the first visit.
 *    Same for fonts (they carry a versioned query).
 *  - Everything under /api/ and /.netlify/ is never intercepted: those
 *    requests must hit the network (and fail honestly) so the app layer
 *    can serve the cached snapshot / queue the mutation.
 *
 * Deliberately dependency-free and tiny — no Workbox, no build step.
 */

const CACHE = 'momentum-shell-v5'

/** Where the page mirrors the active appearance for us (lib/pwa-meta.ts).
 *  Unversioned on purpose — it must survive shell cache rotations. */
const META_CACHE = 'momentum-pwa-meta'
const META_KEY = '/__pwa-meta'

// assets worth precaching on install: the icons + manifest (small, stable).
// The full shell is cached lazily on the first successful navigation.
const PRECACHE = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== META_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/** Requests whose responses are safe to serve from cache without asking. */
function isImmutableAsset(url) {
  // Next.js hashed chunks, fonts with a version query, static icons
  if (url.pathname.startsWith('/_next/static/')) return true
  if (url.pathname.startsWith('/_next/image')) return false
  if (url.origin === self.location.origin && /^\/(favicon\.svg|favicon\.ico|apple-touch-icon\.png|icon-192\.png|icon-512\.png|manifest\.webmanifest)$/.test(url.pathname))
    return true
  if (url.hostname.includes('fonts.gstatic.com')) return true
  return false
}

/** The appearance record the page keeps for us (see lib/pwa-meta.ts), or
 *  null when this device never applied one — callers pass responses through
 *  untouched in that case (the in-page boot script still does its thing). */
async function readPwaMeta() {
  try {
    const c = await caches.open(META_CACHE)
    const r = await c.match(META_KEY)
    if (!r) return null
    const m = await r.json()
    if (m && typeof m.themeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(m.themeColor)) {
      return { themeColor: m.themeColor, dark: !!m.dark }
    }
  } catch {
    /* unreadable — treat as absent */
  }
  return null
}

/** Stamp the boot chrome onto an HTML document: the two status-bar metas
 *  (iOS reads these from the launch HTML — runtime insertion is ignored)
 *  and an html background so the first frame is already themed. */
function injectBootMeta(html, meta) {
  const tags =
    '<meta name="theme-color" content="' + meta.themeColor + '" data-sw="1">' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="' + (meta.dark ? 'black' : 'default') + '" data-sw="1">' +
    '<style data-sw="1">html{background-color:' + meta.themeColor + '}</style>'
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (h) => h + tags)
  return tags + html
}

/** Personalise a navigation response with the account's theme. Non-HTML or
 *  meta-less responses pass through untouched; the body is only re-wrapped
 *  when there is something to inject. */
async function personalizeHtml(res) {
  const meta = await readPwaMeta()
  if (!meta) return res
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('text/html')) return res
  let html
  try {
    html = await res.text()
  } catch {
    return res
  }
  return new Response(injectBootMeta(html, meta), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

self.addEventListener('fetch', (event) => {
  const req = event.request

  // only handle same-origin GETs; never touch the data plane
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) {
    // cross-origin: only transparently cache the (immutable) webfonts
    if (!isImmutableAsset(url)) return
  } else if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) {
    return
  }

  // 1) navigations: network-first, cache fallback (offline boot) — the
  //    response the browser boots from always carries the account's
  //    status-bar colours (see injectBootMeta)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {})
          return personalizeHtml(res)
        })
        .catch(async () => {
          const cache = await caches.open(CACHE)
          const cached =
            (await cache.match('/')) ||
            (await cache.match(req)) || // e.g. an explicitly cached route
            new Response(
              '<!doctype html><meta charset="utf-8"><title>Momentum — offline</title>' +
                '<meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#faf9f6;color:#444">' +
                '<div style="text-align:center"><h1 style="font-size:1.2rem;margin:0 0 .5rem">You&apos;re offline</h1>' +
                '<p style="margin:0">This page hasn&apos;t been cached yet — reconnect once and it will open offline from then on.</p>' +
                '<p><button onclick="location.reload()" style="margin-top:1rem;padding:.5rem 1rem;border-radius:.5rem;border:1px solid #ddd;background:#fff;cursor:pointer">Try again</button></p></div></body>',
              { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            )
          return personalizeHtml(cached)
        }),
    )
    return
  }

  // 1b) the manifest: same personalisation for Android — its launch splash
  //     is built from theme_color/background_color, which are static light
  //     in the shipped file. Network-first (tiny), rewritten on the way out.
  if (url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      (async () => {
        let res = null
        try {
          res = await fetch(req)
        } catch {
          res = null
        }
        if (!res || !res.ok) {
          try {
            const hit = await caches.open(CACHE).then((c) => c.match(req))
            if (hit) res = hit
          } catch {
            /* fall through with what we have */
          }
        }
        if (!res) return new Response('', { status: 504, statusText: 'Offline' })
        const meta = await readPwaMeta()
        if (!meta) return res
        try {
          const data = await res.clone().json()
          data.theme_color = meta.themeColor
          data.background_color = meta.themeColor
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/manifest+json' },
          })
        } catch {
          return res
        }
      })(),
    )
    return
  }

  // 2) immutable assets: cache-first
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        try {
          const res = await fetch(req)
          if (res.ok) cache.put(req, res.clone()).catch(() => {})
          return res
        } catch {
          return new Response('', { status: 504, statusText: 'Offline' })
        }
      }),
    )
    return
  }

  // 3) anything else same-origin (rare): plain network, no caching —
  //    not calling respondWith() is the correct "do nothing" here.
})
