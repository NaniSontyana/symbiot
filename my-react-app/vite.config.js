import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // bind 0.0.0.0 so remote previews (and LAN devices) can reach the app
    port: 5174,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      // Backend gateway REST API
      '/api': {
        target: process.env.GATEWAY_URL || 'http://localhost:5000',
        changeOrigin: true,
      },
      // Backend gateway copilot WebSocket
      '/ws/copilot': {
        target: process.env.GATEWAY_URL ? process.env.GATEWAY_URL.replace(/^http/, 'ws') : 'ws://localhost:5000',
        ws: true,
      },
      // Python ASR microservice WebSocket (browser hits same origin, proxy forwards)
      '/ws/asr-transcribe': {
        target: process.env.ASR_URL || 'ws://localhost:8000',
        ws: true,
        rewrite: () => '/ws/transcribe',
      },
    },
  },
})
