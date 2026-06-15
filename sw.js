const CACHE_NAME = "cafe-d-dream-v17";
const APP_SHELL = [
  "./",
  "./index.html",
  "./admin.html",
  "./kitchen.html",
  "./style.css",
  "./private-sitting.css",
  "./app.js",
  "./admin.js",
  "./admin-shell.js",
  "./admin-orders.js",
  "./private-sitting.js",
  "./private-sitting-pdf.js",
  "./sitting-sync.js",
  "./kitchen.js",
  "./firebase.js",
  "./menu-cart.js",
  "./category-images.js",
  "./staff-auth.js",
  "./manifest.json",
  "./sample-menu.csv",
  "./icon-192.png",
  "./assets/icons/gpay.svg",
  "./assets/icons/paytm.svg",
  "./assets/icons/phonepe.svg",
  "./assets/categories/combos.jpg",
  "./assets/categories/tea.jpg",
  "./assets/categories/hot-coffee.jpg",
  "./assets/categories/cold-coffee.jpg",
  "./assets/categories/mojito.jpg",
  "./assets/categories/shakes.jpg",
  "./assets/categories/soft-drinks.jpg",
  "./assets/categories/starters.jpg",
  "./assets/categories/pasta.jpg",
  "./assets/categories/noodles.jpg",
  "./assets/categories/garlic-bread.jpg",
  "./assets/categories/burgers.jpg",
  "./assets/categories/sandwiches.jpg",
  "./assets/categories/momos.jpg",
  "./assets/categories/maggi.jpg",
  "./assets/categories/ice-cream.jpg",
  "./assets/categories/pizza.jpg",
  "./assets/categories/default.jpg"
];

const NETWORK_FIRST = ["/firebase", ".js", ".html"];

const OFFLINE_HTML = `
  <!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Offline</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        text-align: center;
        color: #232323;
      }
      h1 { color: #ff6b35; }
    </style>
  </head>
  <body>
    <main>
      <h1>You are offline</h1>
      <p>You are offline. Menu cannot be loaded. Please check internet connection.</p>
    </main>
  </body>
  </html>
`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

function preferNetwork(url) {
  return NETWORK_FIRST.some((part) => url.includes(part));
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = event.request.url;

  if (preferNetwork(url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || offlineResponse(event)))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || offlineResponse(event)))
  );
});

async function offlineResponse(event) {
  if (event.request.mode === "navigate") {
    return new Response(OFFLINE_HTML, {
      headers: { "Content-Type": "text/html" }
    });
  }
  return new Response("", { status: 503, statusText: "Offline" });
}
