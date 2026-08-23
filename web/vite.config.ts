import { existsSync, readFileSync } from "node:fs";

import { defineConfig } from "vite";

import { CERT, KEY, ensureCert } from "./scripts/make-cert.mjs";
import { phonePlugin } from "./scripts/phone.mjs";

/**
 * Serve over https, with a certificate that keeps itself current.
 *
 * This is what makes the camera work on a phone. Browsers only expose
 * `getUserMedia` on a secure origin; `localhost` is exempt, but the
 * `192.168.x.x` address a phone has to use is not — so over plain http the
 * pose detection, which is the whole point of the app, cannot run there at all.
 *
 * `ensureCert()` runs on every start and rewrites the certificate if this
 * laptop's address has changed since it was made. That drift is not a rare
 * event: a DHCP lease moves on its own, and the symptom is a phone refusing to
 * connect with an error that names no cause. Checking costs one `openssl` call.
 *
 * If openssl is missing the server falls back to http, which is fine for a demo
 * driven from this machine. `RTP_HTTPS=0` forces http even when a certificate
 * exists — useful for anything that cannot click through a self-signed warning.
 */
export default defineConfig(({ command }) => {
  const wanted = process.env["RTP_HTTPS"] !== "0";
  // Vitest loads this config too. Running tests has no business rewriting
  // certificates, and `openssl` on every test run would be a strange tax.
  const serving = command === "serve" && !process.env["VITEST"];
  const cert = wanted && serving ? ensureCert() : null;

  const https =
    wanted && existsSync(KEY) && existsSync(CERT)
      ? { key: readFileSync(KEY), cert: readFileSync(CERT) }
      : undefined;

  return {
    // Prints a QR code under the dev server's addresses, and serves the same
    // code at /phone — so nobody has to type an IP address into a phone.
    plugins: [phonePlugin({ cert: cert?.status ?? null })],
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
  };
});
