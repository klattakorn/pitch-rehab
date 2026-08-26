/**
 * Hand the APK to a phone over wifi.
 *
 *   npm run apk:send
 *
 * The alternatives are a USB cable, or uploading a 30 MB file to Drive and
 * downloading it again -- both slower than the phone simply fetching it from
 * the laptop it was built on. Scan the code, tap the file, install.
 *
 * Runs on plain http deliberately. This serves one file to one phone on one
 * wifi for about a minute, and the https route would mean the certificate
 * warning again on a download the browser already treats as suspicious.
 *
 * Stops on its own after the first completed download, or after ten minutes.
 * A file server left running on a laptop is a thing that should end by itself.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { encode, toBlocks, toTerminal } from "./qr.mjs";
import { localAddresses } from "./make-cert.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APK = join(here, "..", "..", "pitch-rehab.apk");
const PORT = Number(process.env["RTP_APK_PORT"] ?? 8765);
const MINUTES = 10;

if (!existsSync(APK)) {
  console.error(
    [
      "",
      `No package at ${APK}`,
      "",
      "Build one first:",
      "  cd web && npm run apk",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const stat = statSync(APK);
const size = stat.size;
const megabytes = (size / 1024 / 1024).toFixed(1);

/**
 * How old the package is, in words.
 *
 * The commonest mistake with a hand-installed app is sending yesterday's build
 * and wondering why the fix is not in it. The age is the cheapest possible
 * guard: if this says two days and you changed something an hour ago, you
 * forgot `npm run apk`.
 */
function builtAgo() {
  const minutes = Math.round((Date.now() - stat.mtimeMs) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
const age = builtAgo();
const [address] = localAddresses();

if (!address) {
  console.error("\nThis laptop is not on a network, so a phone cannot reach it.\n");
  process.exit(1);
}

const base = `http://${address}:${PORT}`;

const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install Pitch Rehab</title>
<style>
  body { margin:0; min-height:100vh; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:24px; padding:32px;
    background:#07080a; color:#e9edf2; text-align:center;
    font-family:"Barlow",system-ui,-apple-system,"Segoe UI",sans-serif; }
  h1 { font-size:30px; margin:0; font-weight:600; }
  p { margin:0; color:#aeb7c2; max-width:34ch; line-height:1.5; }
  a.get { display:block; padding:18px 32px; border-radius:12px; background:#d8ff3e;
    color:#131a00; font-weight:700; font-size:18px; text-decoration:none;
    letter-spacing:.02em; }
  small { color:#8a94a0; font-size:13px; max-width:34ch; line-height:1.5; }
</style></head>
<body>
  <h1>Pitch&nbsp;Rehab</h1>
  <p>Android app, ${megabytes} MB. Built ${age}.</p>
  <a class="get" href="/pitch-rehab.apk" download>Download</a>
  <small>Your phone will warn that this kind of file can harm your device, and
    ask permission to install from your browser. Both are normal for an app that
    did not come from the Play Store.</small>
</body></html>`;

let sent = false;
const server = createServer((request, response) => {
  const path = (request.url ?? "/").split("?")[0];

  if (path === "/pitch-rehab.apk") {
    response.writeHead(200, {
      // The MIME type is what makes Android offer to install it rather than
      // saving it as an unknown blob.
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(size),
      "Content-Disposition": 'attachment; filename="pitch-rehab.apk"',
    });
    const stream = createReadStream(APK);
    stream.pipe(response);
    response.on("finish", () => {
      if (sent) return;
      sent = true;
      console.log("\n  Sent. Open it from the phone's notification shade to install.");
      console.log("  Stopping the server.\n");
      // A moment for the connection to close cleanly before the process goes.
      setTimeout(() => server.close(() => process.exit(0)), 500);
    });
    return;
  }

  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(page);
});

server.listen(PORT, "0.0.0.0", () => {
  const qr = encode(base);
  const wide = (process.stdout.columns ?? 80) >= (qr.size + 8) * 2;
  const art = process.stdout.isTTY && !process.env["NO_COLOR"] ? toTerminal(qr) : toBlocks(qr);

  console.log(`\n  INSTALL ON YOUR PHONE - same wifi, point the camera at this:\n`);
  if (wide) for (const line of art.split("\n")) console.log(`  ${line}`);
  else console.log(`  (window too narrow for the code)`);
  console.log(`\n    ${base}`);
  console.log(`    pitch-rehab.apk, ${megabytes} MB, built ${age}\n`);
  console.log(`  Tap Download, then open it from the notification shade.`);
  console.log(`  Android asks permission to install from your browser -- allow it once.\n`);
  console.log(`  This server stops after the download, or in ${MINUTES} minutes.\n`);
});

setTimeout(
  () => {
    if (!sent) console.log("\n  Nobody downloaded it. Stopping.\n");
    server.close(() => process.exit(0));
  },
  MINUTES * 60_000,
).unref?.();
