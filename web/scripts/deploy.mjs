/**
 * Publish the built app to Cloudflare Pages.
 *
 *   npm run deploy
 *
 * Wrangler can normally work out which Cloudflare account to deploy to by
 * asking the API which accounts you belong to. That call -- `GET /memberships`
 * -- returns a 500 from Cloudflare's side on some accounts, and when it does,
 * wrangler cannot proceed even though the login is perfectly good and the token
 * carries `pages (write)`. The error it prints talks about permissions and
 * expired authentication, which sends you off re-authenticating something that
 * was never wrong.
 *
 * Naming the account skips the call. Wrangler documents this as the workaround
 * and it costs nothing when the API is healthy, so it is simply how this
 * deploys now rather than something to remember on a bad day.
 *
 * The id lives in `web/.cloudflare-account`, one line, not in git. It is an
 * identifier rather than a secret -- it appears in every dashboard URL and is
 * useless without a token -- but it belongs to whoever is deploying, and a
 * teammate cloning this repo should be asked for their own rather than
 * inheriting one.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { requireSnapshot, snapshotSummary } from "./check-snapshot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const ACCOUNT_FILE = join(web, ".cloudflare-account");
const PROJECT = "pitch-rehab";

/** Reads like a Cloudflare account id: 32 hex characters. */
const looksRight = (value) => /^[0-9a-f]{32}$/i.test(value);

function accountId() {
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

const account = accountId();
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
      "  2. If the Accounts page is empty, press Create Account. Any name will",
      "     do. The free plan covers Pages, and it asks for no card.",
      "  3. On the account's overview page, copy Account ID from the right --",
      "     it is also the long string in the address bar.",
      "  4. Put it in this file, on its own line:",
      "",
      `       ${ACCOUNT_FILE}`,
      "",
      "It is not a secret -- it is in every dashboard URL and does nothing",
      "without a token -- but it is not in git either, so each person deploys",
      "to their own account.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (!looksRight(account)) {
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

requireSnapshot({
  context:
    "The hosted site has no backend at all, so the snapshot is not a\n" +
    "fallback there -- it is everything the site shows.",
});

console.log(`\nDeploying Pitch Rehab`);
console.log(`  Project   ${PROJECT}`);
console.log(`  Account   ${account.slice(0, 6)}… (from ${
  process.env["CLOUDFLARE_ACCOUNT_ID"] ? "CLOUDFLARE_ACCOUNT_ID" : ".cloudflare-account"
})`);
console.log(`  Snapshot  ${snapshotSummary()}`);

const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: account };
const run = (command, args) => {
  console.log(`\n> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", shell: true, cwd: web, env });
};

run("npm", ["run", "build"]);
run("npx", ["wrangler", "pages", "deploy", "dist", `--project-name=${PROJECT}`]);

console.log(
  [
    "",
    "=".repeat(64),
    "  Live. The address is printed above, and it does not change between",
    "  deploys -- a link you have already sent keeps working.",
    "",
    "  Your laptop plays no part from here: the files are on Cloudflare.",
    "=".repeat(64),
    "",
  ].join("\n"),
);
