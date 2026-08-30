/**
 * Get this ready to go live — which now means: make sure a push is safe.
 *
 *   npm run deploy              check the snapshot, then build
 *   npm run deploy -- --folder  build only, and open it to upload by hand
 *
 * **Publishing is `git push` now.** The repository is connected to Cloudflare
 * Pages, which clones it, runs `npm run build` in `web/`, and serves `dist/` at
 * the same address every time. No CLI, no account to log into, and nothing that
 * depends on this laptop being the one that does it — which was the whole
 * problem with deploying from a machine at school.
 *
 * So this script does not upload anything. It does the two things that are
 * still worth doing before you push, and then gets out of the way:
 *
 *   1. Refuses if there is no snapshot. The hosted site has no backend, so
 *      `demo/snapshot.json` is not a fallback there — it is the entire content.
 *   2. Runs the real build, so a mistake surfaces here rather than in a build
 *      log five minutes after you have walked away.
 *
 * `--folder` is the escape hatch for the day Cloudflare's build fails and the
 * demo is in an hour: it builds, then opens `dist/` so it can be dropped
 * straight onto the Pages project in the dashboard, bypassing git entirely.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { requireSnapshot, snapshotSummary } from "./check-snapshot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const DIST = join(web, "dist");

const args = process.argv.slice(2);
const wants = (flag) => args.includes(flag);

const run = (command, commandArgs, options = {}) => {
  console.log(`\n> ${command} ${commandArgs.join(" ")}`);
  execFileSync(command, commandArgs, { stdio: "inherit", shell: true, cwd: web, ...options });
};

/** What git thinks, or nothing at all if this is not a checkout. */
function gitState() {
  const git = (gitArgs) =>
    execFileSync("git", gitArgs, { cwd: web, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    // Only what the hosted build actually reads. A dirty Python file does not
    // change the site, and warning about it would train people to ignore this.
    const dirty = git(["status", "--porcelain", "--", "."]).split("\n").filter(Boolean).length;
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    let ahead = null;
    try {
      ahead = Number(git(["rev-list", "--count", "@{upstream}..HEAD"]));
    } catch {
      // No upstream yet, which is its own kind of "not pushed".
    }
    return { dirty, branch, ahead };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ main ----

requireSnapshot({
  context:
    "The hosted site has no backend at all, so the snapshot is not a\n" +
    "fallback there -- it is everything the site shows.",
});

console.log("\nChecking Pitch Rehab is ready to publish");
console.log(`  Snapshot  ${snapshotSummary()}`);

run("npm", ["run", "build"]);

if (wants("--folder")) {
  console.log(
    [
      "",
      "=".repeat(68),
      "  Built, not uploaded. To publish this folder by hand:",
      "",
      "    1. Open the Pages project in the Cloudflare dashboard",
      "    2. Create deployment -> Upload assets",
      "    3. Drag this folder onto it:",
      "",
      `         ${DIST}`,
      "",
      "  Use this only when the automatic build is broken and you are short of",
      "  time. It publishes to the same address, but the repository no longer",
      "  matches what is live -- so push afterwards.",
      "=".repeat(68),
      "",
    ].join("\n"),
  );
  try {
    execFileSync("explorer", [DIST], { stdio: "ignore" });
  } catch {
    // `explorer` exits non-zero even when it worked, and this is a convenience.
  }
  process.exit(0);
}

const git = gitState();
const lines = [
  "",
  "=".repeat(68),
  "  The build is good. Publishing is a push:",
  "",
  "    git push",
  "",
  "  Cloudflare Pages rebuilds from the repository and swaps it in, usually",
  "  inside a minute. The address does not change, so a link you have already",
  "  sent keeps working and starts serving this.",
];

if (git?.dirty) {
  lines.push(
    "",
    `  ${git.dirty} uncommitted file${git.dirty === 1 ? "" : "s"} under web/ — commit them first,`,
    "  or what goes live will not be what you just built.",
  );
}
if (git?.ahead) {
  lines.push("", `  ${git.ahead} commit${git.ahead === 1 ? "" : "s"} not pushed yet.`);
}
if (git && !git.dirty && git.ahead === 0) {
  lines.push("", "  Nothing to push — what is live already matches this.");
}

lines.push("=".repeat(68), "");
console.log(lines.join("\n"));
