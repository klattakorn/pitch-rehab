/**
 * Publish the built app to a static host.
 *
 *   npm run deploy                    Netlify
 *   npm run deploy -- --cloudflare    Cloudflare Pages
 *   npm run deploy -- --folder        build only, and open it to drag by hand
 *
 * The app has no backend, so "deploying" is copying a folder of files to
 * somewhere with a domain and https. Any static host does it; which one is a
 * question of whose signup lets you in today.
 *
 * Netlify is the default because it reads the same `web/public/_headers` file
 * Cloudflare does -- the caching rules that stop a phone re-fetching 8 MB of
 * pose runtime on every visit travel with the build, unchanged, between them.
 *
 * Cloudflare Pages stays supported and needs one extra thing: an account id, in
 * `web/.cloudflare-account`. Wrangler normally discovers that by asking which
 * accounts you belong to, and reports a 500 from that call as an authentication
 * error -- which is misleading twice over, because the login is fine and the
 * usual cause is having no account at all. A Cloudflare login and a Cloudflare
 * account are separate things.
 *
 * `--folder` is the escape hatch: no CLI, no account, no npx download. It
 * builds, then opens the folder so it can be dropped on app.netlify.com/drop,
 * which wants no signup for a first upload.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { requireSnapshot, snapshotSummary } from "./check-snapshot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const DIST = join(web, "dist");
const ACCOUNT_FILE = join(web, ".cloudflare-account");
const PROJECT = "pitch-rehab";

const args = process.argv.slice(2);
const wants = (flag) => args.includes(flag);

const env = { ...process.env };
const run = (command, commandArgs, options = {}) => {
  console.log(`\n> ${command} ${commandArgs.join(" ")}`);
  execFileSync(command, commandArgs, { stdio: "inherit", shell: true, cwd: web, env, ...options });
};

// ------------------------------------------------------------ cloudflare ----

/** Reads like a Cloudflare account id: 32 hex characters. */
const looksLikeAccountId = (value) => /^[0-9a-f]{32}$/i.test(value);

function cloudflareAccount() {
  const fromEnv = (process.env["CLOUDFLARE_ACCOUNT_ID"] ?? "").trim();
  if (fromEnv) return fromEnv;
  if (!existsSync(ACCOUNT_FILE)) return null;
  // Ignore comment lines, so the file can explain itself.
  return (
    readFileSync(ACCOUNT_FILE, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ?? null
  );
}

function deployToCloudflare() {
  const account = cloudflareAccount();
  if (!account) {
    console.error(
      [
        "",
        "Which Cloudflare account should this go to?",
        "",
        "Wrangler usually works this out itself by asking which accounts you",
        "belong to. If that call fails -- a 500 on /memberships, reported as an",
        "authentication error -- the usual reason is that there are none to list.",
        "A Cloudflare login and a Cloudflare account are separate things, and",
        "signing up does not always create the second.",
        "",
        "  1. Open https://dash.cloudflare.com and sign in.",
        "  2. If the Accounts page is empty, press Create Account.",
        "  3. Copy Account ID from the account's overview page.",
        "  4. Put it in this file, on its own line:",
        "",
        `       ${ACCOUNT_FILE}`,
        "",
        "New Cloudflare accounts are sometimes held for a few days before they",
        "can be created. If that is where you are, `npm run deploy` goes to",
        "Netlify instead and needs none of this.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  if (!looksLikeAccountId(account)) {
    console.error(
      [
        "",
        `That does not look like an account id: ${account}`,
        "",
        "It should be 32 characters of hex, with no spaces -- the long string in",
        "the dashboard address, not the email or the account name.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  env["CLOUDFLARE_ACCOUNT_ID"] = account;
  console.log(`  Host      Cloudflare Pages`);
  console.log(`  Account   ${account.slice(0, 6)}…`);
  return () => run("npx", ["wrangler", "pages", "deploy", "dist", `--project-name=${PROJECT}`]);
}

// --------------------------------------------------------------- netlify ----

function deployToNetlify() {
  console.log(`  Host      Netlify`);
  console.log(`  Site      ${PROJECT}`);
  return () =>
    // --prod publishes to the site's real address rather than a preview one, so
    // a link already handed out keeps working. The first run asks which site,
    // or offers to make one, and remembers the answer in web/.netlify/.
    // --package spelled out: the package is `netlify-cli` but the command it
    // installs is `netlify`, and leaving npx to work that out is a coin toss
    // that costs a confusing failure. --yes skips the "install it?" prompt.
    run("npx", [
      "--yes",
      "--package=netlify-cli",
      "netlify",
      "deploy",
      "--prod",
      "--dir=dist",
      "--message=pitch-rehab",
    ]);
}

// ------------------------------------------------------------------ main ----

requireSnapshot({
  context:
    "The hosted site has no backend at all, so the snapshot is not a\n" +
    "fallback there -- it is everything the site shows.",
});

console.log(`\nDeploying Pitch Rehab`);
const publish = wants("--folder")
  ? null
  : wants("--cloudflare")
    ? deployToCloudflare()
    : deployToNetlify();
console.log(`  Snapshot  ${snapshotSummary()}`);

run("npm", ["run", "build"]);

if (!publish) {
  console.log(
    [
      "",
      "=".repeat(64),
      "  Built, not uploaded. To publish it by hand:",
      "",
      "    1. Open https://app.netlify.com/drop",
      "    2. Drag this folder onto the page:",
      "",
      `         ${DIST}`,
      "",
      "  It gives you an address straight away. Nothing to install, and no",
      "  account needed for the first upload -- though making one keeps the",
      "  address and lets you replace the files later.",
      "=".repeat(64),
      "",
    ].join("\n"),
  );
  // Opening the folder saves hunting for it. Harmless if it fails.
  try {
    execFileSync("explorer", [DIST], { stdio: "ignore" });
  } catch {
    // `explorer` exits non-zero even when it worked, and this is a convenience.
  }
  process.exit(0);
}

publish();

console.log(
  [
    "",
    "=".repeat(64),
    "  Live. The address is printed above, and it does not change between",
    "  deploys -- a link you have already sent keeps working.",
    "",
    "  Your laptop plays no part from here: the files are on the host.",
    "=".repeat(64),
    "",
  ].join("\n"),
);
