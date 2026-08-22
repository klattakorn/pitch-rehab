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
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
export const CERT_DIR = join(web, ".cert");
const KEY = join(CERT_DIR, "key.pem");
const CERT = join(CERT_DIR, "cert.pem");

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

async function main() {
  if (process.argv.includes("--urls")) return printUrls();
  const force = process.argv.includes("--force");
  if (!force && existsSync(KEY) && existsSync(CERT)) {
    console.log(`Certificate already present in ${CERT_DIR}`);
    console.log("Re-run with --force if your network address has changed.");
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

  const addresses = localAddresses();
  const sans = [
    "DNS:localhost",
    "IP:127.0.0.1",
    "IP:::1",
    ...addresses.map((address) => `IP:${address}`),
  ].join(",");

  await mkdir(CERT_DIR, { recursive: true });
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
      "-subj", "/CN=RehabFootball dev server",
      "-addext", `subjectAltName=${sans}`,
      "-addext", "basicConstraints=critical,CA:false",
      "-addext", "keyUsage=digitalSignature,keyEncipherment",
      "-addext", "extendedKeyUsage=serverAuth",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  await writeFile(
    join(CERT_DIR, "README.txt"),
    [
      "Self-signed certificate for the RehabFootball dev server.",
      "",
      "Generated by web/scripts/make-cert.mjs. Not in git, not for production,",
      "and safe to delete -- re-running the script makes another.",
      "",
      "Covers: " + sans,
      "",
      "Re-run `node scripts/make-cert.mjs --force` if this machine's network",
      "address changes, or the phone will refuse the certificate.",
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(`Certificate written to ${CERT_DIR}`);
  console.log(`Covers: ${sans}`);
  if (addresses.length === 0) {
    console.warn(
      "\nNo local network address found — this machine may be offline.\n" +
        "A phone will not be able to reach the dev server until it is on the\n" +
        "same wifi. Re-run with --force once it is.",
    );
  } else {
    console.log("\nOpen on your phone (same wifi):");
    for (const line of phoneUrls()) console.log(`  ${line}`);
    console.log("\nIt will warn about the certificate once. Tap through it.");
  }
}

// Only run when invoked directly, so vite.config.ts can import the helpers.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  await main();
}
