// Lets the game open with no connection once it has been played. Each request goes to the
// network first, so updates arrive as soon as they're published, and falls back to the copy
// saved last time when the network is missing or slow.
const CACHE = 'cavalcade';
const NETWORK_TIMEOUT = 3000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !/^https?:/.test(request.url)) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  });
  network.catch(() => {}); // a failure is handled below; don't report it twice
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT));
  const cached = cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  try {
    // Wait for the network, but not forever when there's a saved copy to show instead.
    const response = await Promise.race([network, timeout.then(() => cached)]);
    if (response) return response;
  } catch {
    // Offline: use the saved copy below.
  }
  return (await cached) ?? network;
}
