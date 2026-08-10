
// Offline-fallback only. Does NOT cache game JS/assets.
// Each `npm run package` rewrites CACHE to aether-<mainHash>.

const CACHE = "aether-5";
const offlineFallbackPage = "/config/offline.html";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(offlineFallbackPage)).catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("aether-") && k !== CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// Navigations: network only; offline page if the document fetch fails.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (event.request.mode !== "navigate" || event.request.destination !== "document") return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.open(CACHE).then((cache) => cache.match(offlineFallbackPage)),
    ),
  );
});
