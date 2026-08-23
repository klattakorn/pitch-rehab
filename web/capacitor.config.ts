import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Wrap the built web app as an Android app.
 *
 * Why this exists at all, when the same code already runs in a phone browser:
 * the browser route needs a self-signed certificate, because a camera will not
 * open on an insecure origin. Here the app's own files are served from inside
 * the package over `https://localhost`, which the platform trusts outright — so
 * the certificate, the warning, and the address to type all disappear. Only the
 * API calls leave the phone.
 *
 * What does NOT move into the phone is the backend. The protocols, the criteria
 * engine and the database still live on the laptop, and the app talks to them
 * over the local network — see `serverOrigin()` in src/api.ts. This is an
 * installable front end, not a standalone app.
 */
const config: CapacitorConfig = {
  appId: "app.pitchrehab.demo",
  appName: "Pitch Rehab",
  webDir: "dist",
  android: {
    // The backend is plain http on the local network. Android blocks cleartext
    // by default, which is the right default everywhere except here: this is a
    // laptop on the same wifi, over a hop that never reaches the internet.
    allowMixedContent: true,
  },
  server: {
    androidScheme: "https",
    cleartext: true,
  },
};

export default config;
