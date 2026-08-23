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

3. **Get `pitch-rehab.apk` onto the phone.** USB, or send it to yourself and open it
   from the notification. Android asks permission to install from whichever app it
   came through; that prompt is normal for anything not from the Play Store.

4. **Open it.** It asks for the camera the first time you start a session.

---

## When it cannot reach the laptop

The app says so on the sign-in screen — tap **Change server address**. Three things
to check, in the order they go wrong:

- **The laptop moved.** Its address is a DHCP lease; this one went `.46`, `.47`, `.48`
  in three days. The address it prints on startup is the truth. Type it in.
- **Different wifi.** Phone on mobile data, or on the 5 GHz band while the laptop is
  on 2.4 GHz and the router keeps them apart.
- **The firewall.** Step 1 above.

The address box tests the connection before saving, so it tells you which of the three
it is rather than failing later.

---

## Rebuilding

```bash
cd web && npm run apk
```

Finds the JDK and the SDK, bakes in this laptop's current address, and writes
`pitch-rehab.apk` to the repository root. First build takes a few minutes; after that
Gradle only redoes what changed.

Rebuild when the app code changes. You do **not** need to rebuild when the laptop's
address changes — use the in-app address box.

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
