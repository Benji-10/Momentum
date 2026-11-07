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
 *  - Hashed build assets (/_next/static/...) and icons: cache-first —
 *    they are immutable, so no request is needed after the first visit.
 *    Same for fonts (they carry a versioned query).
 *  - Everything under /api/ and /.netlify/ is never intercepted: those
 *    requests must hit the network (and fail honestly) so the app layer
 *    can serve the cached snapshot / queue the mutation.
 *
 * Deliberately dependency-free and tiny — no Workbox, no build step.
 */

const CACHE = 'momentum-shell-v1'

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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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

  // 1) navigations: network-first, cache fallback (offline boot)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {})
          return res
        })
        .catch(async () => {
          const cache = await caches.open(CACHE)
          return (
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
          )
        }),
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
