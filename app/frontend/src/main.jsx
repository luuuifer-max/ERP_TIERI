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
