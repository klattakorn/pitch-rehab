/**
 * Make a self-signed certificate so the dev server can speak https.
 *
 *   node scripts/make-cert.mjs
 *
 * Why this exists: a browser will not hand over a camera unless the page came
 * from a secure origin. `localhost` counts as secure by special case, but
 * `http://192.168.1.5:5173` -- the address a phone has to use -- does not. So
 * without https the pose detection, which is the whole point of the app, simply
 * cannot run on a phone.
 *
 * The certificate covers localhost and every local network address this machine
 * currently has, so the same file keeps working as you move between wifi
 * networks (as long as the address does not change; re-run this if it does).
 *
 * It is self-signed, so the phone will warn once. That is expected: tap through
 * it ("Advanced -> Proceed" on Android, "Show Details -> visit this website" on
 * iOS) and the camera works from then on. Nothing here is fit for the public
 * internet and nothing here pretends to be -- it is a development certificate
 * for a machine on your own network.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
export const CERT_DIR = join(web, ".cert");
export const KEY = join(CERT_DIR, "key.pem");
export const CERT = join(CERT_DIR, "cert.pem");

/**
 * Is this address on a virtual adapter rather than the real network?
 *
 * A laptop with VirtualBox, Docker or a VPN installed reports several IPv4
 * addresses, and only one of them is the wifi the phone is also on. Printed in
 * whatever order Windows happens to list them, someone types the wrong one into
 * their phone and concludes the app is broken.
 */
function isVirtual(address) {
  return (
    address.startsWith("192.168.56.") || // VirtualBox host-only
    address.startsWith("169.254.") || // link-local: no DHCP answered
    /^172\.(1[7-9]|2\d|3[01])\./.test(address) // Docker bridges
  );
}

/**
 * Every IPv4 address this machine has on a local network, most likely first.
 *
 * The certificate covers all of them — listing an extra one there costs
 * nothing. The order only matters for what a person is asked to type.
 */
export function localAddresses() {
  const found = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      found.push(address.address);
    }
  }
  return found.sort((a, b) => Number(isVirtual(a)) - Number(isVirtual(b)));
}

function haveOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Print the addresses a phone should open, one per line.
 *
 * start.bat calls this instead of parsing `ipconfig`, whose labels are
 * translated -- "IPv4 Address" only appears on an English install, so scraping
 * it silently prints nothing on a Thai one.
 */
function printUrls() {
  const scheme = existsSync(CERT) ? "https" : "http";
  const port = process.env["RTP_PORT"] ?? "5173";
  for (const line of phoneUrls(scheme, port)) console.log(line);
}

/** One line per address: the likely one first, the rest marked as spares. */
export function phoneUrls(scheme = "https", port = "5173") {
  return localAddresses().map((address, index) =>
    index === 0
      ? `${scheme}://${address}:${port}`
      : `${scheme}://${address}:${port}   (spare - try if the first will not load)`,
  );
}


/** Is there a certificate on disk at all? */
export function certExists() {
  return existsSync(KEY) && existsSync(CERT);
}

/**
 * Which network addresses the certificate on disk actually covers.
 *
 * Read back from the certificate itself, not from what we think we wrote. The
 * whole failure this guards against is the file being older than the network.
 */
export function certAddresses() {
  if (!existsSync(CERT)) return [];
  try {
    const text = execFileSync(
      "openssl",
      ["x509", "-in", CERT, "-noout", "-ext", "subjectAltName"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    // Dotted quad only: the certificate also lists ::1, which a loose
    // pattern picks up as a stray "0".
    return [...text.matchAll(/IP Address:(\d+\.\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  } catch {
    // openssl is missing, or too old to know `-ext`. Fall back to the note the
    // generator leaves beside the certificate.
    try {
      const note = readFileSync(join(CERT_DIR, "README.txt"), "utf8");
      const line = note.split("\n").find((l) => l.startsWith("Covers:")) ?? "";
      return [...line.matchAll(/IP:(\d+\.\d+\.\d+\.\d+)/g)].map((m) => m[1]);
    } catch {
      return [];
    }
  }
}

/** Does the certificate cover the address a phone would be typing today? */
export function certCovers(address) {
  return certAddresses().includes(address);
}

/**
 * Write a fresh certificate covering every address this machine has right now.
 *
 * Returns what happened rather than printing it, so the dev server can report it
 * in its own voice.
 */
export function generateCert() {
  if (!haveOpenssl()) return { ok: false, reason: "no-openssl", addresses: [], sans: "" };

  const addresses = localAddresses();
  const sans = [
    "DNS:localhost",
    "IP:127.0.0.1",
    "IP:::1",
    ...addresses.map((address) => `IP:${address}`),
  ].join(",");

  mkdirSync(CERT_DIR, { recursive: true });
  execFileSync(
    "openssl",
    [
      "req", "-x509",
      "-newkey", "rsa:2048",
      "-sha256",
      "-days", "365",
      "-nodes",
      "-keyout", KEY,
      "-out", CERT,
      "-subj", "/CN=Pitch Rehab dev server",
      "-addext", `subjectAltName=${sans}`,
      "-addext", "basicConstraints=critical,CA:false",
      "-addext", "keyUsage=digitalSignature,keyEncipherment",
      "-addext", "extendedKeyUsage=serverAuth",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  writeFileSync(
    join(CERT_DIR, "README.txt"),
    [
      "Self-signed certificate for the Pitch Rehab dev server.",
      "",
      "Generated by web/scripts/make-cert.mjs. Not in git, not for production,",
      "and safe to delete -- re-running the script makes another.",
      "",
      "Covers: " + sans,
      "",
      "The dev server checks this on every start and rewrites it if this",
      "machine's address has changed, so you should not need to touch it.",
      "",
    ].join("\n"),
    "utf8",
  );

  return { ok: true, reason: "written", addresses, sans };
}

/**
 * Make sure the certificate on disk matches the network we are on now.
 *
 * This is the fix for the one thing that broke the demo repeatedly: a laptop
 * gets a new DHCP lease, the certificate still names yesterday's address, and
 * the phone refuses the connection with an error that says nothing about why.
 * Cheap to check -- one openssl call -- and the alternative is remembering to
 * pass `--force` at exactly the right moment.
 *
 * Returns `{ status }`: "ok" if nothing needed doing, "renewed" if the address
 * moved, "created" for a first run, "no-openssl" if we cannot make one at all.
 */
export function ensureCert() {
  const addresses = localAddresses();
  const wanted = addresses[0];

  if (!certExists()) {
    const made = generateCert();
    return { status: made.ok ? "created" : "no-openssl", addresses, was: [] };
  }
  if (!wanted || certCovers(wanted)) return { status: "ok", addresses, was: [] };

  const was = certAddresses();
  const made = generateCert();
  return { status: made.ok ? "renewed" : "no-openssl", addresses, was };
}

function main() {
  if (process.argv.includes("--urls")) return printUrls();

  const force = process.argv.includes("--force");
  if (!force && certExists()) {
    const stale = localAddresses().filter((a) => !certCovers(a));
    console.log(`Certificate already present in ${CERT_DIR}`);
    console.log(`Covers: ${certAddresses().join(", ") || "(could not read)"}`);
    if (stale.length) {
      console.log(`\nIt does NOT cover ${stale.join(", ")} -- this machine has moved.`);
      console.log("The dev server fixes that itself on the next start, or run:");
      console.log("  node scripts/make-cert.mjs --force");
    }
    return;
  }

  if (!haveOpenssl()) {
    console.warn(
      [
        "",
        "openssl was not found, so the dev server will stay on plain http.",
        "The app still works on this machine at http://localhost:5173.",
        "",
        "What you lose: the camera on a phone. Browsers only allow it on a",
        "secure origin, and a plain http:// network address is not one.",
        "",
        "On Windows, openssl ships with Git for Windows -- it lives in",
        "  C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
        "Add that folder to PATH and run this again.",
      ].join("\n"),
    );
    return;
  }

  const { addresses, sans } = generateCert();
  console.log(`Certificate written to ${CERT_DIR}`);
  console.log(`Covers: ${sans}`);
  if (addresses.length === 0) {
    console.warn(
      "\nNo local network address found - this machine may be offline.\n" +
        "A phone will not be able to reach the dev server until it is on the\n" +
        "same wifi. Re-run with --force once it is.",
    );
  } else {
    console.log("\nOpen on your phone (same wifi):");
    for (const line of phoneUrls()) console.log(`  ${line}`);
    console.log("\nOr run `npm run phone` for a QR code to scan instead.");
  }
}

// Only run when invoked directly, so vite.config.ts can import the helpers.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main();
}
