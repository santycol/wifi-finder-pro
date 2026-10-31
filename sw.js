/* WiFi Finder Pro — service worker: funciona sin conexión (excepto búsquedas en el mapa). */
const VERSION = 'wfp-v1.0.0';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'qr.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const CDN = ['unpkg.com', 'cdn.jsdelivr.net'];
const TILES = 'wfp-tiles';
const MAX_TILES = 400;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trimTiles() {
  const c = await caches.open(TILES); const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // Overpass usa POST: siempre red
  const url = new URL(req.url);

  // App propia: red primero para recibir actualizaciones; si no hay red, caché.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
    );
    return;
  }
  // Librerías de CDN (versión fija): caché primero.
  if (CDN.includes(url.hostname)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // Mosaicos del mapa: red primero, caché limitada como respaldo.
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone(); caches.open(TILES).then((c) => c.put(req, copy)).then(trimTiles);
      return res;
    }).catch(() => caches.match(req)));
  }
  // Nominatim y demás: sin interceptar.
});
