import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const KEY = join(here, ".cert", "key.pem");
const CERT = join(here, ".cert", "cert.pem");

/**
 * Serve over https when a development certificate exists.
 *
 * This is what makes the camera work on a phone. Browsers only expose
 * `getUserMedia` on a secure origin; `localhost` is exempt, but the
 * `192.168.x.x` address a phone has to use is not — so over plain http the
 * pose detection, which is the whole point of the app, cannot run there at all.
 *
 * Generate the certificate with `node scripts/make-cert.mjs`. It is optional:
 * with no certificate the server falls back to http, which is fine for a demo
 * driven from this machine. `RTP_HTTPS=0` forces http even when one exists --
 * useful for anything that cannot click through a self-signed warning.
 */
const wanted = process.env["RTP_HTTPS"] !== "0";
const https =
  wanted && existsSync(KEY) && existsSync(CERT)
    ? { key: readFileSync(KEY), cert: readFileSync(CERT) }
    : undefined;

export default defineConfig({
  server: {
    // host:true exposes the dev server on the local network, so you can open the
    // demo on a phone over wifi and use its camera instead of a laptop webcam.
    host: true,
    port: 5173,
    https,
    proxy: {
      // Same-origin API calls, so no CORS to fight and the phone talks to the
      // backend through whatever address it reached the front end on. The
      // backend stays on plain http -- only the browser-facing origin has to be
      // secure, and this hop never leaves the machine.
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/healthz": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
  // The wasm and the pose models are copied into public/ by scripts/vendor-assets.mjs
  // so nothing is fetched from a CDN at run time.
});
