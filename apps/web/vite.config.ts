// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serverUrl = process.env.ARDOISE_DEV_SERVER_URL ?? 'http://localhost:3000';
const proxied = ['/api', '/sync', '/files', '/mcp', '/healthz', '/readyz'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      ...Object.fromEntries(
        proxied.map((path) => [path, { target: serverUrl, changeOrigin: false }]),
      ),
      '/collab': { target: serverUrl.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    sourcemap: true,
    rolldownOptions: {
      output: {
        // Long-lived vendor chunk; routes are code-split as they arrive (ARCHITECTURE §8.6).
        advancedChunks: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
});
