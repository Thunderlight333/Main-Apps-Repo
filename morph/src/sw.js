/// Morph service worker: offline precache + share target + lazy ffmpeg cache.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

self.skipWaiting();
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

try { registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'))); } catch { /* dev */ }

// ffmpeg core: cached the first time it is requested, then served offline forever.
registerRoute(({ url }) => url.pathname.includes('/ffmpeg/'), new CacheFirst({ cacheName: 'morph-ffmpeg' }));

// Web Share Target: files shared from other apps land here, are parked in a cache and picked up by the app.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith((async () => {
    const form = await event.request.formData();
    const cache = await caches.open('morph-share');
    const files = form.getAll('files').filter((f) => f && typeof f !== 'string');
    let i = 0;
    for (const f of files) {
      await cache.put(`/__share/${Date.now()}-${i++}`, new Response(f, {
        headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name) },
      }));
    }
    const text = [form.get('url'), form.get('text')].filter(Boolean).join(' ');
    const scope = self.registration.scope;
    return Response.redirect(`${scope}?shared=1${text ? '&text=' + encodeURIComponent(text) : ''}`, 303);
  })());
});
