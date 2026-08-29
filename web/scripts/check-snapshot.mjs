/**
 * Refuse to ship a build whose recording of the backend is missing or stale.
 *
 * Both shippable forms of this app carry `demo/snapshot.json`, and it decides
 * what they show when there is no laptop to ask. The hosted site is the harder
 * case of the two: it has *no* backend, ever, so the snapshot is not a fallback
 * there — it is the entire content. A stale one is a site quietly showing last
 * week's protocols to everybody you sent the link to.
 *
 * Neither failure announces itself. The build succeeds, the deploy succeeds, and
 * the wrong data appears on somebody else's phone. So it is checked here, where
 * there is still something to be done about it.
 *
 *   node scripts/check-snapshot.mjs          exits non-zero if it is missing
 *
 * Also importable, so the Android build can use the same rule rather than
 * keeping a second copy of it.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");

export const SNAPSHOT = join(web, "src", "demo", "snapshot.json");

/** How old the recording is, in days. `null` when there is not one. */
export function snapshotAgeDays() {
  if (!existsSync(SNAPSHOT)) return null;
  return (Date.now() - statSync(SNAPSHOT).mtimeMs) / 86_400_000;
}

/** One line for a build log: fresh, or old enough to mention. */
export function snapshotSummary() {
  const age = snapshotAgeDays();
  if (age === null) return "missing";
  if (age < 1) return "fresh";
  const days = Math.floor(age);
  return `${days} day${days === 1 ? "" : "s"} old — re-run scripts/make_snapshot.py if the data has moved on`;
}

/**
 * Stop the build if there is no snapshot at all.
 *
 * Age is only ever a warning. There is no honest threshold at which a recording
 * becomes wrong — it is wrong the moment the protocols change and right forever
 * if they do not — so the age is reported and the decision left to whoever is
 * building.
 */
export function requireSnapshot({ context }) {
  const age = snapshotAgeDays();
  if (age !== null) return age;

  console.error(
    [
      "",
      "No snapshot at web/src/demo/snapshot.json.",
      "",
      context,
      "",
      "Make one first:",
      "",
      "  python scripts/make_snapshot.py",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  requireSnapshot({
    context:
      "The hosted site has no backend at all, so the snapshot is not a\n" +
      "fallback there — it is everything the site shows.",
  });
  console.log(`Snapshot: ${snapshotSummary()}`);
}
