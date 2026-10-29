// Service worker. tools/build.mjs fills in VERSION and FILES for each build.
// App files are cached so kang-notes opens offline; a new build gets a new cache,
// which is how the phone and the PC pick up updates. Firebase traffic is not touched.
const VERSION = '%VERSION%';
const FILES = %FILES%;
const CACHE = `kang-notes-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Pages: try the network briefly so updates show up, fall back to the cached app.
    event.respondWith((async () => {
      try {
        const res = await Promise.race([
          fetch(req),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500)),
        ]);
        if (res.ok) return res;
        throw new Error(String(res.status));
      } catch {
        return (await caches.match('index.html', { cacheName: CACHE })) || Response.error();
      }
    })());
    return;
  }

  event.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
