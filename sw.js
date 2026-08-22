/* Leaf service worker — offline shell + Android share target. */

const SHELL = 'leaf-shell-v1';
const SHARE = 'leaf-share';

const PDFJS_VERSION = '4.10.38';

const LOCAL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

const REMOTE = [
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`,
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`,
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`,
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`,
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Local files must all land; a missing one means a broken deploy.
    await cache.addAll(LOCAL);
    // Remote files are best-effort — one CDN being down shouldn't fail the install.
    await Promise.all(REMOTE.map(url =>
      cache.add(new Request(url, { mode: 'cors' })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n !== SHELL && n !== SHARE).map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ── Share target: Android hands us the PDF as a multipart POST ──
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      const home = new URL('./?shared=1', self.registration.scope);
      try {
        const form = await event.request.formData();
        const file = form.get('pdf');
        if (file && file.size) {
          const cache = await caches.open(SHARE);
          await cache.put('shared-file', new Response(file, {
            headers: {
              'content-type': 'application/pdf',
              'x-filename': encodeURIComponent(file.name || 'Shared.pdf'),
            },
          }));
        }
      } catch (err) {
        // Fall through to the app, which will show its own message.
      }
      return Response.redirect(home.href, 303);
    })());
    return;
  }

  if (event.request.method !== 'GET') return;

  // ── Navigations: serve the shell so the app opens offline ──
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(event.request);
      } catch {
        const cache = await caches.open(SHELL);
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // ── Everything else: cache first, then network, then cache the result ──
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: false });
    if (cached) return cached;
    try {
      const res = await fetch(event.request);
      if (res.ok && (url.origin === location.origin || res.type === 'cors')) {
        const cache = await caches.open(SHELL);
        cache.put(event.request, res.clone());
      }
      return res;
    } catch {
      return cached || Response.error();
    }
  })());
});
