const CACHE_NAME = "moveoptimize-shell-v4";
const APP_SHELL = [
  "/",
  "/index.html",
  "/index.css",
  "/index.js",
  "/manifest.webmanifest",
  "/pages/home.html",
  "/pages/home.css",
  "/pages/home.js",
  "/assets/app-icon.svg",
  "/assets/box-placeholder.svg",
  "/assets/vendor/roselt/roselt.js",
  "/assets/vendor/bootstrap-icons/bootstrap-icons.css",
  "/assets/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2",
  "/assets/vendor/bootstrap-icons/fonts/bootstrap-icons.woff"
];

const IS_LOCAL_DEVELOPMENT_HOST = ["localhost", "127.0.0.1"].includes(self.location.hostname);

self.addEventListener("install", (event) => {
  if (IS_LOCAL_DEVELOPMENT_HOST) {
    self.skipWaiting();
    return;
  }

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  if (IS_LOCAL_DEVELOPMENT_HOST) {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .then(() => self.registration.unregister())
    );
    return;
  }

  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (IS_LOCAL_DEVELOPMENT_HOST) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match("/index.html")))
  );
});
