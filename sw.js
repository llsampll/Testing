// Offline cache so the game works without a connection once installed.
const CACHE = 'apex-circuit-v1';
const ASSETS = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/main.js', 'js/game.js', 'js/race.js', 'js/ai.js', 'js/input.js', 'js/audio.js',
  'js/physics/tire.js', 'js/physics/vehicle.js', 'js/physics/cars.js',
  'js/track/track.js', 'js/track/trackData.js',
  'js/render/carMesh.js', 'js/render/trackMesh.js',
  'js/vendor/three.module.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Network first (so updates show up), falling back to the cache offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
