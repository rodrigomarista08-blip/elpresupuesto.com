var CACHE = 'presupuesto-v26';
var FILES = ['./', './index.html', './errores.js', './prefs.js', './calc.js', './guia.js', './app.js', './fonts/plus-jakarta-sans-latin.woff2', './fonts/nunito-latin.woff2',
  './fonts/atkinson-hyperlegible-400-latin.woff2', './fonts/atkinson-hyperlegible-700-latin.woff2', './fonts/lora-latin.woff2', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon.svg'];
var NET_TIMEOUT = 4000; // con una red muy lenta, a los 4 s se usa lo guardado

self.addEventListener('install', function (e) {
  // cache: 'reload' para guardar siempre la versión recién publicada, no una copia vieja del navegador.
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

// Al activarse una versión nueva se borran las cachés antiguas y toma el control enseguida.
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function fromNetwork(req) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('tiempo')); }, NET_TIMEOUT);
    // cache: 'no-cache' pregunta al servidor si hay versión nueva (si no la hay, responde rápido sin volver a descargar).
    var fresh = new Request(req.url, { cache: 'no-cache', credentials: 'same-origin', redirect: req.redirect });
    fetch(fresh).then(function (res) { clearTimeout(t); resolve(res); }, function (err) { clearTimeout(t); reject(err); });
  });
}

// Primero la red (así las mejoras llegan solas y nadie se queda con una versión vieja);
// sin conexión o con la red atascada, lo guardado. Solo se guardan respuestas correctas del propio sitio.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fromNetwork(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (r) {
        if (r) return r;
        // Solo una página (no una imagen o un script que falte) cae en la app guardada.
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
