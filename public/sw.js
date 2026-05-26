// STQ service worker — caches the static shell so the app installs as a PWA
// and loads fast. API and quiz responses are always fetched fresh from the network.

const VERSION = "v1";
const SHELL_CACHE = "stq-shell-" + VERSION;
const SHELL_URLS = [
  "/",
  "/index.html",
  "/quiz.html",
  "/admin.html",
  "/leaderboard.html",
  "/manifest.webmanifest",
  "/assets/style.css",
  "/assets/app.js",
  "/assets/quiz.js",
  "/assets/admin.js",
  "/assets/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache API responses — always fresh.
  if (url.pathname.startsWith("/api/")) return;

  // Stale-while-revalidate for same-origin shell assets.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then((resp) => {
        if (resp && resp.status === 200) cache.put(req, resp.clone());
        return resp;
      }).catch(() => cached);
      return cached || network;
    })());
  }
});
