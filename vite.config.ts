import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Frontend build/dev config. (Test config is separate, in vitest.config.ts, because the
// app root differs from the test root.)
//
// The app serves from web/ and calls /api on its own origin. During dev, Vite proxies /api
// (including the /api/stream SSE endpoint) to the running backend. Default target is the
// production container published on the host at :3000; override with VITE_API_TARGET.
const apiTarget = process.env.VITE_API_TARGET || 'http://host.docker.internal:3000';

export default defineConfig({
  root: 'web',
  // Tailwind v4's own Vite plugin (Phase 14, ARCHITECTURE §19) — processes web/css/tailwind.css
  // (imported from app.ts) via its @import "tailwindcss" directive. web/css/app.css keeps
  // loading separately via <link> in index.html, unchanged; the two coexist during the
  // incremental migration.
  plugins: [tailwindcss()],
  server: {
    host: true, // 0.0.0.0 so the container's published port is reachable from the host
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: '../dist/public', // the server will serve this from step 1.4 onward
    emptyOutDir: true,
  },
});
