// Ebook Canvas — Service Worker
// Caches the shell so the app loads offline.
const CACHE = "ec-v1";
const SHELL = [
  "/", "/index.html", "/library.html", "/login.html", "/signup.html",
  "/reader.html", "/css/style.css", "/js/main.js", "/js/auth.js",
  "/js/firebase-config.js", "/js/reader.js", "/manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e) => {
  // Network-first for API calls, cache-first for assets
  if (e.request.url.includes("firestore") || e.request.url.includes("cloudinary")) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
