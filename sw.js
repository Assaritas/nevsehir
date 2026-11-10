// Çevrimdışı kullanım: uygulama kabuğu önbelleğe alınır, harita karoları ve veriler gezinildikçe saklanır.
const VERSION = "v4";
const SHELL = `shell-${VERSION}`, DATA = `data-${VERSION}`, TILES = `tiles-${VERSION}`;
const MAX_TILES = 4000;
const SHELL_FILES = [
  "js/search.js", "js/tour.js", "js/history.js", "js/diorama.js",
  "vendor/three/three.module.js", "vendor/three/three.core.js", "vendor/three/addons/controls/OrbitControls.js", "vendor/three/addons/renderers/CSS2DRenderer.js",
  "./", "index.html", "css/app.css", "js/app.js", "js/card.js", "js/i18n.js",
  "config/categories.js", "config/provinces.js", "vendor/maplibre-gl.js", "vendor/maplibre-gl.css",
  "vendor/maplibre-contour.min.js", "manifest.webmanifest", "icons/app/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Vikipedi özetleri: her zaman güncel olanı dene, yoksa önbellek
  const isTile = /tiles\.openfreemap\.org|elevation-tiles-prod|tiles\.maps\.eox\.at|arcgis\.com|commons\.wikimedia\.org/.test(url.host + url.pathname);
  const isData = url.origin === location.origin && url.pathname.includes("/data/");

  if (isTile) {
    // önce önbellek (karolar değişmez)
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { c.put(req, res.clone()); if (Math.random() < 0.02) trim(TILES, MAX_TILES); }
      return res;
    }));
  } else if (isData || /wikipedia\.org/.test(url.host)) {
    // önce ağ (güncel veri), çevrimdışıysa önbellek
    e.respondWith(fetch(req).then((res) => { if (res.ok) caches.open(DATA).then((c) => c.put(req, res.clone())); return res; })
      .catch(() => caches.match(req)));
  } else if (url.origin === location.origin) {
    // uygulama dosyaları: önce ağ (güncellemeler hemen gelsin), çevrimdışıysa önbellek
    e.respondWith(fetch(req).then((res) => { if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone())); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true })));
  }
});
