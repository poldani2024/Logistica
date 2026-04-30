// Service Worker — Logística Soka Gakkai
// Estrategia: Cache-first para assets estáticos, Network-first para Firebase

const CACHE_NAME = "logistica-sgi-v1";

const STATIC_ASSETS = [
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./mi-ruta.html",
  "./tracking.html",
  "./assignments.html",
  "./drivers.html",
  "./passengers.html",
  "./events.html",
  "./calendar.html"
];

// ── Instalación: pre-cachear assets estáticos ──────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn("SW install: algunos assets no se pudieron cachear", err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── Activación: limpiar caches viejas ─────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: estrategia según tipo de request ────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Firebase y Google APIs → siempre red (sin cachear)
  if (
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("gstatic.com") ||
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("identitytoolkit") ||
    url.pathname.includes("firebase")
  ) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: "Sin conexión" }),
          { headers: { "Content-Type": "application/json" } }
        );
      })
    );
    return;
  }

  // Assets locales (.js, .css, .html) → Cache-first con fallback a red
  if (
    event.request.method === "GET" &&
    (url.pathname.endsWith(".js") ||
     url.pathname.endsWith(".css") ||
     url.pathname.endsWith(".html") ||
     url.pathname.endsWith(".json") ||
     url.pathname.endsWith(".png") ||
     url.pathname.endsWith(".ico"))
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      }).catch(() => {
        return caches.match("./index.html");
      })
    );
    return;
  }

  // Todo lo demás → red directa
  event.respondWith(fetch(event.request));
});

// ── Push Notifications ────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Logística SGI", body: event.data.text() };
  }

  const title = payload.title || "Logística SGI";
  const options = {
    body: payload.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: payload.data || {},
    tag: payload.tag || "logistica-notif",
    renotify: true,
    actions: payload.actions || []
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "./mi-ruta.html";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
