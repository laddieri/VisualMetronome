/* Visual Metronome service worker.
 *
 * Strategy:
 *  - Precache the same-origin app shell at install so the app boots offline.
 *  - Navigations: network-first, falling back to the cached index.html.
 *  - Same-origin GETs: stale-while-revalidate (instant load, refresh in bg).
 *  - Cross-origin (CDN libs, fonts): cache-first, populated on first fetch.
 *
 * Bump CACHE_VERSION to force clients onto a fresh precache.
 */
'use strict';

const CACHE_VERSION = 'vm-v2';
const PRECACHE = CACHE_VERSION + '-precache';
const RUNTIME  = CACHE_VERSION + '-runtime';

// Same-origin shell. Module graph is listed explicitly so a cold offline
// launch has every import on hand rather than discovering them lazily.
const SHELL = [
  './',
  './index.html',
  './colors_and_type.css',
  './stylesheet.css',
  './layout.css',
  './js/main.js',
  './js/layout.js',
  './js/Tone.js',
  './js/tonejs-ui.js',
  './js/modules/state.js',
  './js/modules/voice.js',
  './js/modules/stage.js',
  './js/modules/animations.js',
  './js/modules/conductor3d.js',
  './js/modules/camera.js',
  './js/modules/settings.js',
  './js/modules/audio-context.js',
  './js/modules/sounds.js',
  './js/modules/transport.js',
  './js/modules/tempo.js',
  './js/modules/view-sync.js',
  './js/modules/counting-trainer.js',
  './js/modules/songs.js',
  './js/modules/sketch.js',
  './js/modules/remote.js',
  './js/modules/custom-rhythm.js',
  './js/modules/check-rhythm.js',
  './js/modules/two-measure.js',
  './manifest.webmanifest',
  './assets/logo.svg',
  './assets/pig.svg',
  './assets/pig-192.png',
  './assets/pig-512.png',
  './assets/pig-maskable-512.png',
  './assets/pig-180.png',
  './assets/pig-favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE)
      // Individual adds so one missing optional file can't fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== PRECACHE && k !== RUNTIME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // App navigations: try network (fresh deploys), fall back to cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(PRECACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreSearch: true })
          .then((r) => r || caches.match('./')))
    );
    return;
  }

  // Same-origin assets: stale-while-revalidate.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(RUNTIME).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Cross-origin (CDN libraries, Google Fonts): cache-first.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      // Opaque responses (no-cors CDN) are still cacheable for offline use.
      const copy = res.clone();
      caches.open(RUNTIME).then((c) => c.put(req, copy));
      return res;
    }).catch(() => cached))
  );
});
