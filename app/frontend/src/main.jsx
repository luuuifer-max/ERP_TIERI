import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// El scroll del mouse sobre un input numérico enfocado lo hace cambiar de valor solo
// (por eso aparecían decimales tipo 0.001, 0.002). Esto lo desactiva en toda la app:
// si el mouse pasa por encima de un input numérico mientras se hace scroll de la página,
// simplemente se le quita el foco antes de que el navegador alcance a cambiar el valor.
document.addEventListener('wheel', (evento) => {
  const elemento = document.activeElement
  if (elemento && elemento.tagName === 'INPUT' && elemento.type === 'number') {
    elemento.blur()
  }
}, { passive: true })

// Conexión desde otros dispositivos: el código escribe la API como http://localhost:3000.
// En la propia PC (localhost) no cambia nada. Si la app se abre desde otro dispositivo
// (por ejemplo por Tailscale), las peticiones a la API se hacen al mismo sitio desde el que
// se abrió la app, y el servidor de Vite las reenvía al backend (ver vite.config.js).
const API_ORIGINAL = 'http://localhost:3000'
if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) {
  const fetchOriginal = window.fetch.bind(window)
  window.fetch = (entrada, opciones) => (typeof entrada === 'string' && entrada.startsWith(API_ORIGINAL)
    ? fetchOriginal(window.location.origin + entrada.slice(API_ORIGINAL.length), opciones)
    : fetchOriginal(entrada, opciones))
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Registra el service worker para que la app se pueda instalar (PWA) y cargue al
// instante aunque internet falle un momento. Si falla el registro (ej. navegador muy
// viejo), la app sigue funcionando normal, solo sin esta mejora.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
