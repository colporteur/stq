// STQ service worker.
// Strategy:
//   • API responses are always served straight from the network (never cached).
//   • HTML page requests use network-first (so HTTPS redirects, etc. are handled
//     by the browser and never poisoned into the cache, which Safari rejects).
//   • Static assets (CSS, JS, icons) are cache-first with a network fill.
//   • Redirected responses are NEVER cached — Safari will refuse to serve any
//     response from a service worker that has redirected=true.

const VERSION = "v3";
const SHELL_CACHE = "stq-shell-" + VERSION;
const ASSET_URLS = [
  "/assets/style.css",
  "/assets/app.js",
  "/assets/quiz.js",
  "/assets/admin.js",
  "/assets/icon.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(ASSET_URLS).catch(() => {})) // best-effort
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // cross-origin: don't touch
  if (url.pathname.startsWith("/api/")) return;             // API: don't touch

  const accept = req.headers.get("accept") || "";
  const isHtml = req.mode === "navigate" || accept.includes("text/html");

  if (isHtml) {
    // Network-first for HTML. Don't cache HTML at all to avoid redirect-cache issues.
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // Cache-first for static assets, but never cache redirected responses.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const resp = await fetch(req);
      if (resp && resp.ok && !resp.redirected && resp.type === "basic") {
        cache.put(req, resp.clone());
      }
      return resp;
    } catch {
      return cached || Response.error();
    }
  })());
});

// Allow pages to trigger a hard reset of all caches by posting a message.
self.addEventListener("message", (e) => {
  if (e.data === "reset") {
    e.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});
