// Offline support for the installed app. Network first: when online, every file comes fresh from the site, so a new
// build reaches the player on the next launch; each response is also stored, so once a match has been played the
// whole game runs without a connection.
const CACHE = 'elemental-forge-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// the page sends the list of files it loaded (the first visit loads them before this worker is in control): store them
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'cache' || !Array.isArray(e.data.urls)) return;
  const urls = e.data.urls.filter(u => { try { return new URL(u).origin === self.location.origin; } catch (_) { return false; } });
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(urls.map(u => c.match(u, { ignoreSearch: true }).then(hit => hit || c.add(u).catch(() => {}))))));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
