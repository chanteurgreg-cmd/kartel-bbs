// Service worker : la caisse reste utilisable sans internet et se met à jour dès que le réseau revient.
const CACHE = 'kartel-bbs-v3';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/logic.js', 'js/catalog.js', 'js/store.js', 'js/demo.js', 'js/cloud.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (req, res) => {
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Le site : réseau d'abord (dernière version), cache si pas de réseau ou réseau trop lent.
  if (url.origin === location.origin) {
    const network = fetch(req).then((res) => put(req, res));
    const slow = new Promise((_, reject) => setTimeout(() => reject(new Error('lent')), 4000));
    e.respondWith(
      Promise.race([network, slow]).catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || network)
        .catch(() => caches.match('index.html'))),
    );
    return;
  }

  // Polices Google : cache d'abord, elles ne changent pas.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))));
  }
});
