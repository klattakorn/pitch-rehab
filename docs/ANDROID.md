# Pitch Rehab on Android

An installable app, built with [Capacitor](https://capacitorjs.com). It is the same
front end the browser runs — same TypeScript, same MediaPipe, same 33 landmarks —
wrapped in an Android package.

**It is a front end, not the whole system.** The 42 protocols, the criteria engine and
every session ever logged live on the laptop. The phone talks to them over the local
network. No laptop, no app.

---

## What the wrapper buys

| | Browser | Installed app |
|---|---|---|
| Getting to it | scan a QR code | it is in the app drawer |
| Certificate warning | every fresh install | **none** |
| Address to type | none (the QR carries it) | none (baked in, changeable) |
| Camera | works after tapping through the warning | works |

The certificate is the real win. In a browser the camera needs a secure origin, so the
dev server signs its own certificate and every phone warns about it — the ugliest part
of the demo. Inside the app the files are served from the package itself over
`https://localhost`, which the platform trusts outright. Nothing to warn about.

---

## Installing it

1. **Let the API through the firewall.** Once per laptop. Right-click PowerShell →
   *Run as administrator*:

   ```powershell
   New-NetFirewallRule -DisplayName "Pitch Rehab API" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Any
   ```

   Without this the app installs and opens and then cannot reach anything, because
   Windows silently drops inbound connections to Python. Node already has a rule —
   that is why the browser route works and this one would not.

2. **Start the laptop**, as usual:

   ```bash
   start.bat
   ```

3. **Get `pitch-rehab.apk` onto the phone.** Double-click **`send-to-phone.bat`**.
   It prints a QR code; scan it, tap Download, and open the file from the
   notification shade. The laptop stops serving as soon as the file has gone.

   The phone asks three things on the way, all normal for an app that did not come
   from the Play Store: that the file type can be harmful (*Download anyway*), that
   the browser wants permission to install apps (allow it once), and Play Protect
   warning it has not seen this app before (*More details -> Install anyway*).

   A USB cable works too: copy the file across and open it from the phone's Files
   app. Set the USB connection to *File transfer* first, or the phone shows an empty
   folder and looks broken.

4. **Open it.** It asks for the camera the first time you start a session.

---

## When it cannot reach the laptop

The app says so, names the address it tried, and offers three ways out: **Try again**,
**Change server address**, and **Carry on without a laptop**.

Reasons it happens, in the order they go wrong:

- **The laptop moved.** Its address is a DHCP lease; this one went `.46`, `.47`, `.48`,
  `.52` in four days. The address it prints on startup is the truth. Type it in — the
  box tests the connection before saving, so it tells you whether that was the problem
  rather than failing later.
- **Different wifi.** Phone on mobile data, or on the 5 GHz band while the laptop is
  on 2.4 GHz and the router keeps them apart.
- **Client isolation.** School and guest wifi usually stops two devices on it from
  seeing each other at all. Both have internet, neither can reach the other, and no
  firewall rule or admin right changes it. A phone hotspot with the laptop joined to
  it sidesteps the whole thing.
- **The firewall.** Step 1 above.

---

## Running with no laptop at all

Some rooms will not let you start a server: no admin, no installs, nothing. Every fix
above assumes there is something to connect to, so none of them help. For those, the
app carries the backend's answers with it.

Tap **Carry on without a laptop** and the app runs from a snapshot in the package.
Every screen works — the plan, the exit criteria, the progress charts, the body map.
A band across the top says **Demo mode** on every screen, so nobody watching can
mistake it for a live system.

### What is real in that mode

More than you would guess. `scripts/make_snapshot.py` calls every screen's endpoint
against the actual API and records the replies, so the protocols, the exercise rules,
the exit criteria and the progress figures are genuine output from the real criteria
engine. Nothing is hand-written. Regenerate the file and it changes with the code.

**And the camera is completely real.** It never needed the server: pose detection, rep
counting, the angle checks and the coaching word all run in `pose/live.ts` on the
phone, against rules that came from the backend and now sit in the snapshot. The
upload afterwards is storage, not scoring — the screen never reads its reply. So the
part of this project actually worth demonstrating behaves identically with nothing
switched on anywhere.

### What it will not do

Recompute. A set logged in this mode is kept on the phone and reported as *not yet
counted*; the phase-advance button refuses and says why. The thing that would judge
new work is a thousand lines of Python in `app/services/criteria/`, and a second copy
of the rules that decide whether someone is fit to play football would drift from the
first. An offline demo is fine. A dishonest one is not.

The progress screen stays exactly as snapshotted rather than half-updating, for the
same reason: a screen mixing fresh arithmetic with frozen judgement is harder to trust
than one that is plainly a fixed picture.

### Keeping the snapshot current

```bash
python scripts/make_snapshot.py
```

Re-seeds the demo player, records twelve endpoints, writes
`web/src/demo/snapshot.json` (~150 KB). `npm run apk` refuses to build without one and
tells you how old it is.

---

## Updating it

Two commands, about a minute, entirely yours — nothing here needs anyone else:

```bash
cd web && npm run apk
```

Then double-click **`send-to-phone.bat`** and scan the code. Install straight over the
top: **your settings survive**, including the server address and whether standalone
mode is on. Android does not ask you to uninstall first.

`npm run apk` finds the JDK and the SDK, bakes in this laptop's current address,
stamps the version, and writes `pitch-rehab.apk` to the repository root. The first
build took minutes; after that Gradle only redoes what changed, so it is ~15 seconds.

### Knowing which build is on the phone

Every package is stamped with the date, time and commit it was built from:

```
0.1.0+20260827.0027.ae8e066
```

You can read it in three places, and they should agree: the build output prints it,
`send-to-phone.bat` says how old the file is, and the app shows it under
**Profile → About → This build**. A `.dirty` on the end means it was built from
changes that were never committed — fine while you are working, worth avoiding for
anything you hand to someone else, because nobody can rebuild it later.

### When you do and do not need to rebuild

| Changed | Rebuild? |
|---|---|
| Anything in `web/src/` | **Yes** |
| The laptop's IP address | No — use the in-app address box |
| Protocols, exit criteria, backend logic | Yes, and re-run `make_snapshot.py` first |
| Seed data for the demo player | Only if you want standalone mode to show it |

The backend itself is never inside the package, so a fix to `app/` reaches the phone
the moment you restart the server — no rebuild at all, as long as the phone can reach
the laptop. It is only the offline snapshot that freezes a copy.

### If someone else builds it

Android refuses to install an update signed by a different key, and a debug build is
signed with a key generated per machine. So a package built on a teammate's laptop
will not install over yours — it fails with a flat *"App not installed"* and no
explanation. Either keep one person building, or uninstall before switching. This
also applies to you after a Windows reinstall.

### What the build needs

Already installed on this laptop. On a fresh one:

```powershell
winget install Microsoft.OpenJDK.21
```

Then the Android SDK — command-line tools only, about 400 MB, no Android Studio:

```powershell
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
Invoke-WebRequest "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" -OutFile "$env:TEMP\cmdline-tools.zip"
Expand-Archive "$env:TEMP\cmdline-tools.zip" "$sdk\cmdline-tools" -Force
Rename-Item "$sdk\cmdline-tools\cmdline-tools" "latest"
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="$sdk" --licenses
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="$sdk" "platform-tools" "platforms;android-36" "build-tools;36.0.0" "build-tools;35.0.0"
```

`sdkmanager --licenses` is interactive and needs a real terminal — it asks `y/N` about
six times. If it exits without installing anything, that prompt is why.

---

## What is in the package

| | |
|---|---|
| Application ID | `app.pitchrehab.demo` |
| Minimum Android | 7.0 (API 24) |
| Size | ~30 MB, of which 15 MB is the two pose models and 34 MB the MediaPipe runtime, compressed |
| Permissions | `CAMERA`, `INTERNET`, `WAKE_LOCK` |

Everything is bundled. The app downloads nothing at run time and works with the phone
offline apart from reaching the laptop.

### Two deliberate differences from the browser build

**Cleartext to the laptop.** `android:usesCleartextTraffic="true"`, because the backend
is plain http on the local network. Android is right to block this by default; here the
hop is a laptop on the same wifi and never touches the internet.

**The screen stays on.** The browser build uses the Screen Wake Lock API, which
Android's WebView does not reliably expose, so `MainActivity` sets
`FLAG_KEEP_SCREEN_ON` instead. Blunter — it applies while you are reading charts too —
but a rep count that silently stops because the screen slept is indistinguishable from
the pose engine failing, and that is the worse failure.

---

## What it is not

A signed release build. `assembleDebug` produces a debug-signed package: installable
by anyone you hand it to, not publishable to the Play Store. For a demo that is the
right trade — a release build needs a keystore, and a keystore needs somewhere safe to
keep it.

The browser route still works, unchanged, and is still the fallback if a phone will not
install anything: `npm run dev`, then scan the QR code.
