const APP_CACHE = 'standalone-bus-app-f34e4929';
const DATA_CACHE = 'standalone-bus-data-3498715e';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './logos/LOGO.png',
  './logos/EAST.png',
  './logos/WEST.png',
  './src/css/styles.css',
  './src/js/data/DataProvider.js',
  './src/js/config/uiLayoutConfig.js',
  './src/js/config/dataSourcesConfig.js',
  './src/js/config/scopeDefinitions.js',
  './src/js/views/viewRegistry.js',
  './src/js/views/tableView.js',
  './src/js/clockTimePicker.js',
  './src/js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== APP_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function networkFirstData(request) {
  // Prefer network so manager re-extracts show up without a stale first paint.
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isData = /\.(json|csv|xlsx|xlsm)(\?|$)/i.test(url.pathname);
  if (isData) {
    event.respondWith(networkFirstData(request));
    return;
  }

  event.respondWith(networkFirst(request));
});
