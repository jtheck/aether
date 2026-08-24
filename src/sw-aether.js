
// Network-first for app HTML/JS/CSS. Offline fallback for navigations.
// Each `npm run package` rewrites CACHE to aether-<mainHash>.
// Never intercept or cache.put the worker script itself.

const CACHE = "aether-5";
const offlineFallbackPage = "/config/offline.html";

function workerScriptPath(url) {
  try {
    return new URL(url, self.location.origin).pathname;
  } catch {
    return "";
  }
}

function isWorkerScript(url) {
  const path = workerScriptPath(url);
  return /\/sw-[^/]*\.js$/i.test(path) || /\/serviceworker\.js$/i.test(path);
}

function isAppHtmlJsCss(request) {
  const dest = request.destination;
  if (dest === "document" || dest === "iframe" || dest === "script" || dest === "style") {
    return true;
  }
  if (request.mode === "navigate") return true;
  try {
    return /\.(html?|js|mjs|cjs|css)$/i.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok && !isWorkerScript(request.url)) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate" || request.destination === "document") {
      const offline = await caches.match(offlineFallbackPage);
      if (offline) return offline;
    }
    throw err;
  }
}

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

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Never intercept the worker script — no respondWith, no cache.put.
  if (isWorkerScript(event.request.url)) return;
  if (!isAppHtmlJsCss(event.request)) return;

  event.respondWith(networkFirst(event.request));
});
