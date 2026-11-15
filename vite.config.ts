import { defineConfig } from 'vite'

const apiPort = process.env.RTS_API_PORT ?? '3000'

export default defineConfig({
  build: {
    outDir: 'dist/client',
    target: ['es2020', 'safari15', 'chrome90'],
    chunkSizeWarningLimit: 1600
  },
  server: {
    allowedHosts: process.env.VITE_ALLOWED_HOST ? [process.env.VITE_ALLOWED_HOST] : [],
    proxy: {
      '/socket': { target: `ws://127.0.0.1:${apiPort}`, ws: true },
      '/healthz': `http://127.0.0.1:${apiPort}`
    }
  }
})
