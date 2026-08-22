import { defineConfig } from "vite";

export default defineConfig({
  server: {
    // host:true exposes the dev server on the local network, so you can open the
    // demo on a phone over wifi and use its camera instead of a laptop webcam.
    host: true,
    port: 5173,
    proxy: {
      // Same-origin API calls, so no CORS to fight and the phone talks to the
      // backend through whatever address it reached the front end on.
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/healthz": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
  // The wasm and the pose model are copied into public/ by scripts/vendor-assets.mjs
  // so nothing is fetched from a CDN at run time.
});
