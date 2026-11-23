// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const serverUrl = process.env.ARDOISE_DEV_SERVER_URL ?? 'http://localhost:3100';
const proxied = ['/api', '/sync', '/files', '/mcp', '/healthz', '/readyz'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: Number(process.env.ARDOISE_DEV_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      ...Object.fromEntries(
        // `/sync` also carries the poke socket (`/sync/ws`). Browsers open one WebSocket
        // handshake per host at a time (RFC 6455 §4.1), so an unproxied upgrade there
        // would also stall `/collab`.
        proxied.map((path) => [
          path,
          { target: serverUrl, changeOrigin: false, ws: path === '/sync' },
        ]),
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
            // The editor stack loads with the first page view (lazy route component).
            {
              name: 'editor',
              test: /node_modules[\\/](@tiptap|prosemirror-[a-z-]+|yjs|y-prosemirror|y-protocols|lib0|lowlight|highlight\.js|katex|@hocuspocus|linkifyjs|@floating-ui|orderedmap|rope-sequence|w3c-keyname|unified|remark-[a-z-]+|micromark[a-z-]*|mdast-[a-z-]+)[\\/]/,
            },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
});
