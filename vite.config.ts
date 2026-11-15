import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: 'dist/client',
    target: ['es2020', 'safari15', 'chrome90'],
    chunkSizeWarningLimit: 1600
  },
  server: {
    proxy: {
      '/socket': { target: 'ws://127.0.0.1:3000', ws: true },
      '/healthz': 'http://127.0.0.1:3000'
    }
  }
})
