import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Cuando la app se abre desde otro dispositivo, /api se reenvía al backend de esta PC.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true }
    },
    // Permite abrir la app con el nombre de Tailscale (algo.tailXXXX.ts.net).
    allowedHosts: ['.ts.net']
  }
})
