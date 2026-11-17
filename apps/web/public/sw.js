/*
 * ETON LEX — Service Worker
 *
 * Estrategia:
 *  - Shell (HTML, manifest, iconos): precache en la instalación.
 *  - Navegación: red primero; si no hay red, se sirve el shell cacheado.
 *  - Assets con hash (/assets/...): caché primero (son inmutables).
 *  - Fuentes e iconos externos: stale-while-revalidate.
 *  - /api y /socket.io: SIEMPRE red. Nunca se cachean datos privados.
 *
 * Al cambiar VERSION se invalidan las cachés antiguas en la activación.
 */

const VERSION = 'eton-lex-v8';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const CACHE_PREFIX = 'eton-lex-';

const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

const OFFLINE_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sin conexión — ETON LEX</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #F1F1F3; color: #0A0A0A;
    font-family: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; }
  @media (prefers-color-scheme: dark) {
    body { background: #0A0A0B; color: #F4F4F6; }
    .card { background: #121214 !important; border-color: #2C2C30 !important; }
    .mark { background: #121214 !important; border-color: #2C2C30 !important; color: #F4F4F6 !important; }
    .muted { color: #F4F4F6 !important; opacity: .45; }
  }
  .card { background: #fff; border: 1px solid #E0E0E3; border-radius: 24px;
    padding: 40px 32px; max-width: 380px; text-align: center;
    box-shadow: 0 24px 60px -40px rgba(0,0,0,.5); }
  .mark { width: 56px; height: 56px; margin: 0 auto 20px; border-radius: 16px;
    display: grid; place-items: center; border: 1px solid #E0E0E3;
    color: #0A0A0A; background: #FFFFFF;
    box-shadow: 0 10px 24px -18px rgba(0,0,0,.6); }
  .mark svg { width: 36px; height: 36px; }
  h1 { font-size: 19px; margin: 0 0 8px; letter-spacing: .01em; }
  p { font-size: 13px; line-height: 1.6; margin: 0 0 24px; }
  .muted { color: #0A0A0A; opacity: .55; }
  button { font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
    border: 0; border-radius: 999px; padding: 12px 22px;
    background: #0A0A0A; color: #fff; }
  @media (prefers-color-scheme: dark) { button { background: #F4F4F6; color: #0A0A0B; } }
</style>
</head>
<body>
  <main class="card">
    <div class="mark">
      <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M256 62 L404 160 H108 Z" stroke-width="26" />
        <g stroke-width="22">
          <path d="M152 190 V330" />
          <path d="M204 190 V330" />
          <path d="M256 190 V330" />
          <path d="M308 190 V330" />
          <path d="M360 190 V330" />
        </g>
        <path d="M112 340 H400" stroke-width="24" />
        <path d="M256 372 C224 358, 172 354, 116 364 L116 440 C172 430, 224 434, 256 452 C288 434, 340 430, 396 440 L396 364 C340 354, 288 358, 256 372 Z" stroke-width="24" />
        <path d="M256 372 V452" stroke-width="18" />
      </svg>
    </div>
    <h1>Sin conexión</h1>
    <p class="muted">No pudimos cargar ETON LEX porque no hay red disponible.
      Tus datos guardados en este dispositivo siguen intactos.</p>
    <button onclick="location.reload()">Reintentar</button>
  </main>
</body>
</html>`;

const IS_API = (url) => url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io');

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Se guarda cada recurso por separado: si uno falla, la instalación no se cae.
      await Promise.all(
        SHELL_ASSETS.map(async (asset) => {
          try {
            const response = await fetch(new Request(asset, { cache: 'reload' }));
            if (response.ok) await cache.put(asset, response);
          } catch {
            /* sin red: se completará en la próxima visita */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && !key.startsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetchWithTimeout(request, 4500);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put('/', response.clone());
      return response;
    }
    // 4xx/5xx de un proxy o del servidor: mejor el shell cacheado que una página de error.
    return (await caches.match('/', { ignoreSearch: true })) || response;
  } catch {
    const cached = await caches.match('/', { ignoreSearch: true });
    if (cached) return cached;
    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network-timeout')), ms);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (IS_API(url)) return; // datos privados: solo red

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (
    sameOrigin ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
