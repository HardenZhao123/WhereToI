const CACHE_PREFIX = "wheretoi-static";
const CACHE_VERSION = "development";
const STATIC_CACHE = `${CACHE_PREFIX}-${CACHE_VERSION}`;
const PRECACHE_ASSETS = /* __PRECACHE_MANIFEST__ */ [
  "/",
  "/app.webmanifest",
  "/offline.html",
  "/src/assets/icons/icon-192.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== STATIC_CACHE)
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    const requestUrl = new URL(request.url);
    if (response.status === 200 && ["/", "/index.html"].includes(requestUrl.pathname)) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put("/", response.clone());
    }
    return response;
  } catch {
    return (
      (await caches.match(request, { ignoreSearch: true })) ??
      (await caches.match("/")) ??
      (await caches.match("/offline.html"))
    );
  }
}

async function handleStaticRequest(request) {
  const cachedResponse = await caches.match(request, { ignoreSearch: true });
  const networkResponse = fetch(request)
    .then(async (response) => {
      if (response.status === 200 && response.type === "basic") {
        const cache = await caches.open(STATIC_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cachedResponse);

  return cachedResponse ?? networkResponse;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleStaticRequest(request));
});
