// Service worker del ERP Tieri.
// Objetivo único: cachear los archivos propios de la app (HTML, JS, CSS, íconos)
// para que abra al instante y funcione aunque se corte internet un momento.
//
// IMPORTANTE: nunca cachea llamadas a la API (/api/...) ni peticiones a otro origen
// (como http://localhost:3000). Los datos del negocio (stock, precios, ventas) siempre
// se piden en vivo al servidor; este service worker jamás debe inventar o guardar
// respuestas de la API, porque mostrar stock o precios viejos podría hacer vender algo
// que ya no existe.

// Sube este número cada vez que publiques cambios importantes, para forzar a que todos
// los dispositivos descarten la caché vieja y tomen los archivos nuevos.
const CACHE_NAME = 'tieri-shell-v1'

self.addEventListener('install', (evento) => {
  self.skipWaiting()
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(nombres.filter((nombre) => nombre !== CACHE_NAME).map((nombre) => caches.delete(nombre)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request
  const url = new URL(peticion.url)

  // Solo nos metemos con peticiones GET de nuestro propio origen (los archivos de la app).
  // Todo lo demás (la API en otro puerto, POST/PUT/DELETE, etc.) pasa de largo sin tocar.
  if (peticion.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return
  }

  evento.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const enCache = await cache.match(peticion)
      const enRed = fetch(peticion)
        .then((respuesta) => {
          if (respuesta && respuesta.ok) cache.put(peticion, respuesta.clone())
          return respuesta
        })
        .catch(() => null)

      // Si ya lo teníamos guardado, lo mostramos al instante (y de paso lo actualizamos
      // en segundo plano). Si no lo teníamos, esperamos la red; si no hay red y tampoco
      // hay caché, ahí sí falla (no hay forma de inventar la página).
      return enCache || (await enRed) || Response.error()
    })
  )
})
