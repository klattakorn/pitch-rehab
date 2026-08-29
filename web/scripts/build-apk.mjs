/**
 * Build the Android app.
 *
 *   npm run apk
 *
 * One command, because the alternative is four with three environment variables
 * between them, and the one everybody forgets is the one that decides which
 * laptop the finished app talks to.
 *
 * What it does, in order: find the JDK and the Android SDK, tell Gradle where
 * they are, build the web app with this machine's address baked in, copy that
 * into the Android project, and run Gradle. The finished package lands in the
 * repository root as `pitch-rehab.apk`.
 *
 * The baked-in address is a default, not a commitment -- the app has a screen
 * for changing it, because a DHCP lease moves and rebuilding a 30 MB package to
 * chase an address would be ridiculous.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { requireSnapshot, snapshotSummary } from "./check-snapshot.mjs";
import { localAddresses } from "./make-cert.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const repo = join(web, "..");
const android = join(web, "android");

/** Where the JDK is. Gradle needs it by path, not by PATH. */
function findJdk() {
  const fromEnv = process.env["JAVA_HOME"];
  if (fromEnv && existsSync(join(fromEnv, "bin", "java.exe"))) return fromEnv;
  const roots = ["C:/Program Files/Microsoft", "C:/Program Files/Eclipse Adoptium", "C:/Program Files/Java"];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const found = readdirSync(root)
      .filter((name) => /jdk/i.test(name))
      .sort()
      .reverse();
    for (const name of found) {
      if (existsSync(join(root, name, "bin", "java.exe"))) return join(root, name);
    }
  }
  return null;
}

/** Where the Android SDK is. */
function findSdk() {
  const candidates = [
    process.env["ANDROID_HOME"],
    process.env["ANDROID_SDK_ROOT"],
    join(process.env["LOCALAPPDATA"] ?? "", "Android", "Sdk"),
  ].filter(Boolean);
  return candidates.find((path) => existsSync(join(path, "platform-tools"))) ?? null;
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", shell: true, ...options });
}

const jdk = findJdk();
const sdk = findSdk();
if (!jdk || !sdk) {
  console.error(
    [
      "",
      "Cannot build the app -- the Android toolchain is missing.",
      jdk ? `  JDK found at ${jdk}` : "  NO JDK. Install one:  winget install Microsoft.OpenJDK.21",
      sdk ? `  SDK found at ${sdk}` : "  NO Android SDK. See docs/ANDROID.md for the four commands.",
      "",
      "The browser route needs none of this -- `npm run dev` and scan the QR code.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Gradle reads the SDK path from here rather than the environment, so writing
// it means the build works from a double-clicked script as well as a shell.
writeFileSync(
  join(android, "local.properties"),
  `# Written by scripts/build-apk.mjs. Machine-specific, so not in git.\nsdk.dir=${sdk.replace(/\\/g, "\\\\").replace(/:/g, "\\:")}\n`,
  "utf8",
);

// The package carries a snapshot of the backend so it can run on a machine that
// will not let you start a server. Shipping without one turns "carry on without
// a laptop" into a dead button -- and you find out in the room, not here. Same
// rule as the hosted build, kept in one place.
requireSnapshot({
  context: "Without it the app cannot run on a machine where the server will not start.",
});

const [address] = localAddresses();
if (!address) {
  console.warn(
    "\nThis laptop is not on a network, so there is no address to build in.\n" +
      "The app will start with no server set and ask for one on first run.\n",
  );
}
const origin = address ? `http://${address}:8000` : "";

console.log(`\nBuilding Pitch Rehab for Android`);
console.log(`  JDK       ${jdk}`);
console.log(`  SDK       ${sdk}`);
console.log(`  Server    ${origin || "(none -- set it in the app)"}`);
console.log(`  Snapshot  ${snapshotSummary()}`);

/**
 * A version that says which build this is.
 *
 * Every package used to be `1.0`, so a phone could not tell you whether it had
 * this morning's app or last week's -- and with three people and a deadline that
 * is a real question asked often. The name carries the date, the time and the
 * commit; `dirty` means it was built with changes that are not committed, which
 * is exactly the build nobody can reproduce later.
 *
 * The code is minutes since 2020, because Android needs an integer that only
 * ever goes up and will refuse to install a package numbered below the one
 * already on the phone.
 */
function version() {
  const git = (args, fallback = "") => {
    try {
      return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    } catch {
      return fallback;
    }
  };
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `.${pad(now.getHours())}${pad(now.getMinutes())}`;
  const commit = git(["rev-parse", "--short", "HEAD"]);
  const dirty = git(["status", "--porcelain"]) ? ".dirty" : "";
  const base = JSON.parse(readFileSync(join(web, "package.json"), "utf8")).version;
  return {
    code: Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 60_000),
    name: `${base}+${stamp}${commit ? `.${commit}` : ""}${dirty}`,
  };
}

const build = version();
console.log(`  Version   ${build.name}  (code ${build.code})`);

const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };

run("npx", ["vite", "build"], {
  cwd: web,
  env: { ...env, VITE_API_ORIGIN: origin, VITE_APP_VERSION: build.name },
});
run("npx", ["cap", "sync", "android"], { cwd: web, env });
run(
  join(android, "gradlew.bat"),
  [
    "assembleDebug",
    "--console=plain",
    `-PrtpVersionCode=${build.code}`,
    `-PrtpVersionName=${build.name}`,
  ],
  { cwd: android, env },
);

const built = join(android, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const out = join(repo, "pitch-rehab.apk");
copyFileSync(built, out);

console.log(
  [
    "",
    "=".repeat(64),
    `  Built: ${out}`,
    `  Version: ${build.name}`,
    "",
    "  Put it on the phone -- USB, or send it to yourself and open it.",
    "  Android asks permission to install from that app the first time.",
    "",
    `  It expects the laptop at ${origin || "an address you set on first run"},`,
    "  which means the API has to be running and reachable:",
    "",
    "    python -m uvicorn app.main:app --host 0.0.0.0 --port 8000",
    "",
    "  If the app says it cannot reach the laptop, the firewall is the",
    "  usual reason. See docs/ANDROID.md.",
    "=".repeat(64),
    "",
  ].join("\n"),
);
