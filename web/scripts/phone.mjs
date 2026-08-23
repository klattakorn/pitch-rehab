/**
 * Get the app onto a phone without typing an address.
 *
 *   npm run phone          print a QR code for the address a phone should open
 *   npm run phone -- --url https://example    a QR code for anything else
 *
 * Two problems, one script.
 *
 * **Typing.** `https://192.168.0.48:5173` is twenty-five characters of digits and
 * punctuation on a phone keyboard, and one wrong digit gives you a timeout with
 * no clue which digit. A QR code is the phone camera doing it for you.
 *
 * **Drift.** The laptop's address is a DHCP lease, so it changes on its own --
 * this machine went .46, .47, .48 in three days. The certificate names the old
 * one, the phone refuses to connect, and nothing on either screen says why. So
 * the dev server now checks the certificate against the current address every
 * time it starts, and rewrites it when they disagree.
 *
 * The same code is served at `/phone` on the running dev server, which is the
 * better one to use in front of an audience: bigger, on the projector, and it
 * re-reads the address every time you refresh.
 */
import { encode, terminalWidth, toBlocks, toSvg, toTerminal } from "./qr.mjs";
import { certAddresses, certExists, ensureCert, localAddresses } from "./make-cert.mjs";

/** The address to put in front of someone, and the ones to fall back to. */
export function phoneAddresses() {
  const [best, ...spares] = localAddresses();
  return { best, spares };
}

function url(address, scheme, port) {
  return `${scheme}://${address}:${port}`;
}

/**
 * Draw a QR code for the terminal, or explain why not.
 *
 * A QR code drawn narrower than it is tall does not scan, so rather than squash
 * one into a window that cannot hold it, say so and point at the page.
 */
export function qrLines(text, { columns = process.stdout.columns ?? 80, color = true } = {}) {
  const qr = encode(text);
  if (terminalWidth(qr) > columns) {
    return {
      fits: false,
      lines: [
        `This window is ${columns} columns; the code needs ${terminalWidth(qr)}.`,
        "Widen it, or open the /phone page below instead.",
      ],
    };
  }
  return { fits: true, lines: (color ? toTerminal(qr) : toBlocks(qr)).split("\n") };
}

const useColor = () => Boolean(process.stdout.isTTY) && !process.env["NO_COLOR"];

/**
 * The block of text the dev server prints under its own URLs.
 *
 * Deliberately plain ASCII apart from the code itself: `start.bat` opens a
 * `cmd` window whose code page mangles anything else, and a demo that prints
 * mojibake at a teacher is worse than one that prints nothing.
 */
export function phoneBanner({ scheme, port, columns, color = useColor(), cert = null }) {
  const { best, spares } = phoneAddresses();
  const out = [""];

  if (!best) {
    out.push(
      "  ON YOUR PHONE: not possible right now - this laptop is not on a network.",
      "  Join the wifi and restart, or the phone has nothing to connect to.",
      "",
    );
    return out;
  }

  const main = url(best, scheme, port);
  out.push("  ON YOUR PHONE - same wifi, point the camera at this:", "");
  const { lines } = qrLines(main, { columns, color });
  for (const line of lines) out.push(`  ${line}`);
  out.push("", `    ${main}`);
  for (const spare of spares) {
    out.push(`    ${url(spare, scheme, port)}   (spare - try if the first will not load)`);
  }
  out.push("", `  Bigger code, on this laptop:  ${scheme}://localhost:${port}/phone`);

  if (scheme === "https") {
    out.push("  The phone warns about the certificate once. Tap through it.");
    out.push("    Android: Advanced, then Proceed.   iPhone: Show Details, then visit.");
  } else {
    out.push("  NOTE: plain http, so the phone camera will not work. See README.");
  }
  if (cert === "renewed") {
    out.push("", "  (The certificate was rewritten - this laptop's address had changed.");
    out.push("   Your phone will ask about it again, once.)");
  }
  out.push("");
  return out;
}

// ------------------------------------------------------------- the page ----

const escape = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/**
 * The `/phone` page: the same QR code, big enough to scan across a room.
 *
 * Built as a string rather than a route in the app, because it is a tool for
 * getting to the app -- putting it inside the app would mean you had to already
 * be on your phone to find it.
 */
export function phonePage({ scheme, port, stale = [] }) {
  const { best, spares } = phoneAddresses();
  const main = best ? url(best, scheme, port) : null;

  const card = (link, label) => `
      <figure class="code">
        ${toSvg(encode(link), { size: label ? 200 : 340 })}
        <figcaption>
          ${label ? `<span class="tag">${escape(label)}</span>` : ""}
          <a href="${escape(link)}">${escape(link)}</a>
        </figcaption>
      </figure>`;

  const body = !main
    ? `<p class="warn">This laptop is not on a network, so a phone has nothing to
         connect to. Join the wifi and restart the server.</p>`
    : `
      <div class="codes">
        ${card(main, null)}
        ${spares.map((s) => card(url(s, scheme, port), "spare")).join("")}
      </div>
      <ol class="steps">
        <li>Put the phone on the <strong>same wifi</strong> as this laptop.</li>
        <li>Open the camera and point it at the code. Tap the link that appears.</li>
        ${
          scheme === "https"
            ? `<li>It warns that the connection is not private. That is expected —
                 this laptop signed its own certificate. Tap
                 <strong>Advanced → Proceed</strong> on Android, or
                 <strong>Show Details → visit this website</strong> on iPhone.</li>`
            : `<li class="warn">The server is on plain <code>http</code>, so the camera
                 will not work on a phone. Stop it, run
                 <code>npm run cert</code>, and start again.</li>`
        }
      </ol>
      ${
        stale.length
          ? `<p class="warn"><strong>This address is newer than the running server.</strong>
             The laptop moved to ${escape(stale.join(", "))} after the server started, so
             the code above may not connect. Restart the dev server.</p>`
          : ""
      }
      ${spares.length ? `<p class="note">More than one code because this laptop has more
         than one network adapter — a virtual machine or VPN adds its own. The big one is
         almost always right; try a spare if it will not load.</p>` : ""}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pitch Rehab — open on your phone</title>
<style>
  :root {
    --page:#07080a; --card:#12151a; --edge:#2e343d;
    --ink:#e9edf2; --ink-2:#aeb7c2; --ink-3:#8a94a0;
    --volt:#d8ff3e; --fix:#ffb020;
    --sans: "Barlow", system-ui, -apple-system, "Segoe UI", sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin:0; padding:40px 24px 64px; background:var(--page); color:var(--ink);
    font-family:var(--sans); font-size:16px; line-height:1.5;
    display:flex; flex-direction:column; align-items:center;
  }
  header { text-align:center; margin-bottom:32px; }
  .brand {
    font-family:var(--mono); font-size:11px; letter-spacing:.18em;
    text-transform:uppercase; color:var(--ink-3); margin:0 0 8px;
  }
  h1 { font-size:34px; line-height:1.1; margin:0; font-weight:600; }
  h1 .accent { color:var(--volt); }
  .codes { display:flex; flex-wrap:wrap; gap:24px; align-items:flex-start; justify-content:center; }
  .code {
    margin:0; padding:20px; background:var(--card);
    border:1px solid var(--edge); border-radius:14px; text-align:center;
  }
  .code svg { display:block; border-radius:6px; }
  figcaption { margin-top:14px; font-family:var(--mono); font-size:13px; }
  figcaption a { color:var(--ink-2); text-decoration:none; word-break:break-all; }
  .tag {
    display:block; font-size:10px; letter-spacing:.16em; text-transform:uppercase;
    color:var(--ink-3); margin-bottom:6px;
  }
  .steps { max-width:46ch; margin:36px 0 0; padding-left:22px; color:var(--ink-2); }
  .steps li { margin-bottom:12px; }
  .steps strong { color:var(--ink); font-weight:600; }
  .note, .warn { max-width:46ch; margin:24px 0 0; font-size:14px; color:var(--ink-3); }
  .warn { color:var(--fix); }
  code { font-family:var(--mono); font-size:.9em; }
  footer { margin-top:40px; font-family:var(--mono); font-size:11px; color:var(--ink-3); }
</style>
</head>
<body>
  <header>
    <p class="brand">Pitch Rehab</p>
    <h1>Open this on your <span class="accent">phone</span></h1>
  </header>
  ${body}
  <footer>Refresh this page if the laptop changes network.</footer>
</body>
</html>`;
}

// ----------------------------------------------------------- vite plugin ----

/**
 * Serve `/phone`, and print a QR code once the dev server is listening.
 *
 * Printing happens by wrapping Vite's own `printUrls`, so the code lands
 * directly under the addresses it belongs to rather than scrolling past before
 * the server is ready.
 */
export function phonePlugin({ cert = null } = {}) {
  const details = (server) => {
    const bound = server.httpServer?.address();
    const port =
      bound && typeof bound === "object" ? bound.port : (server.config.server.port ?? 5173);
    return { scheme: server.config.server.https ? "https" : "http", port };
  };

  const serve = (server) => {
    server.middlewares.use("/phone", (_req, res) => {
      const { scheme, port } = details(server);
      // The certificate the server is actually holding was read at startup; if
      // the machine has moved since, say so rather than showing a code that
      // leads to a refused connection.
      const covered = certAddresses();
      const stale =
        scheme === "https" && covered.length
          ? localAddresses().filter((a) => !covered.includes(a))
          : [];
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store"); // addresses change under us
      res.end(phonePage({ scheme, port, stale }));
    });
  };

  return {
    name: "pitch-rehab-phone",
    configureServer(server) {
      serve(server);
      const original = server.printUrls.bind(server);
      server.printUrls = () => {
        original();
        const { scheme, port } = details(server);
        for (const line of phoneBanner({ scheme, port, cert })) console.log(line);
      };
    },
    configurePreviewServer(server) {
      serve(server);
    },
  };
}

// ------------------------------------------------------------------ cli ----

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };

  if (flag("--help")) {
    console.log(
      [
        "Print a QR code for opening the app on a phone.",
        "",
        "  npm run phone                  the address a phone should open",
        "  npm run phone -- --url <url>   a code for any other address",
        "  npm run phone -- --port 4173   a different port",
        "  npm run phone -- --plain       block characters instead of colour",
        "  npm run phone -- --http        assume plain http, no certificate",
        "  npm run phone -- --no-cert     skip the certificate check",
        "",
      ].join("\n"),
    );
    return;
  }

  const color = !flag("--plain") && useColor();
  const custom = value("--url");
  if (custom) {
    const { lines } = qrLines(custom, { color });
    console.log("");
    for (const line of lines) console.log(`  ${line}`);
    console.log(`\n    ${custom}\n`);
    return;
  }

  let cert = null;
  if (!flag("--no-cert")) {
    const result = ensureCert();
    cert = result.status;
    if (result.status === "renewed") {
      console.log(
        `\n  This laptop's address changed (${result.was.join(", ")} -> ` +
          `${result.addresses.join(", ")}), so the certificate was rewritten.` +
          "\n  Restart the dev server if it is already running, or it will keep" +
          "\n  serving the old one.",
      );
    }
  }

  // Read the scheme off the disk rather than off what we just did, so the
  // banner is right whoever called us and whether or not the check was skipped.
  const forcedHttp = flag("--http") || process.env["RTP_HTTPS"] === "0";
  const scheme = !forcedHttp && certExists() ? "https" : "http";
  const port = value("--port") ?? process.env["RTP_PORT"] ?? "5173";
  for (const line of phoneBanner({ scheme, port, color, cert })) console.log(line);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main();
}
