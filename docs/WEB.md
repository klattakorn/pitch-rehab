# Putting it on the web

For anyone the Android package cannot reach: iPhones, and anyone not on your wifi.

The app already runs with no backend — that is what **Carry on without a laptop**
does, replaying a recording of the real API from
[`web/src/demo/snapshot.json`](../web/src/demo/snapshot.json). So the built `dist/`
folder is a complete, self-contained app. Put it on any static host and it works.

## Publishing is a push

The repository is connected to **Cloudflare Pages**. Push to `main` and it clones
the repo, builds, and swaps the new version in — usually inside a minute, at the
same address as before.

```bash
git push
```

That is the whole deploy. Nothing is installed, nothing is logged into, and it
does not matter whose laptop you are on — which was the entire problem with
deploying from a school machine that blocks admin access.

Before pushing, this is worth running:

```bash
cd web && npm run deploy
```

Despite the name it uploads nothing. It refuses if the snapshot is missing, runs
the real build so a mistake surfaces here rather than in a build log you are not
watching, and then tells you whether anything is uncommitted or unpushed.

### The settings, if the project is ever rebuilt

In the Pages project, under Settings → Build:

| Setting | Value |
|---|---|
| Framework preset | None |
| **Root directory** | **`web`** |
| Build command | `npm run build` |
| Build output directory | `dist` |

**Root directory is the one that catches people.** Leave it blank and Cloudflare
runs `npm run build` at the repository root, where there is no `package.json`, and
the build fails with `ENOENT ... /opt/buildhome/repo/package.json`. It also makes
Cloudflare find `requirements.txt` at the root and spend a minute installing
mediapipe, opencv and matplotlib, none of which a static site uses.

`web/.node-version` pins Node for the build. It has to live in `web/`, not the
repository root, because Cloudflare reads it from the root directory setting.

### When the automatic build is broken and the demo is in an hour

```bash
cd web && npm run deploy -- --folder
```

Builds and opens `web/dist`. In the Pages project: **Create deployment → Upload
assets**, and drag the folder on. Same address, no git involved.

Use it only as an escape hatch: it publishes files the repository does not match,
so push afterwards or the next automatic build will quietly undo it.

---

## Why this and not the other routes

| | Works on iPhone | Needs your laptop | Camera |
|---|---|---|---|
| `pitch-rehab.apk` | **no** — Android only | no | yes |
| Same wifi + QR code | yes | yes | yes, after a warning |
| **This** | **yes** | **no** | **yes, no warning** |

The certificate warning disappears because the host serves real HTTPS. That is
also what makes the camera work: browsers only allow `getUserMedia` on a secure
origin, and this is one properly rather than by exception.

There is no backend, so nothing of yours is exposed. The alternative — tunnelling
to your laptop — would give visitors real accounts of their own, but only while
your laptop is on, and it would put the development backend on the public
internet with the demo password published in this repository.

## What a visitor gets

Everything on screen: the plan, the exit criteria, the progress charts, the body
map — one player's real programme, recorded from the real system.

And the camera, which is not a recording. MediaPipe runs on *their* phone against
*their* body, counting their reps and scoring their form live. That part never
needed a server.

What they cannot do is be themselves in it: no account, no logging their own
injury, no saved history. Those need a backend and there is not one. Every screen
says **Demo mode** rather than letting anyone assume otherwise.

On iOS, Safari's **Share → Add to Home Screen** gives it an icon and runs it
full-screen with no browser bars. `index.html` already carries the meta tags for
that.

## What it costs to load

Measured, not estimated:

| | Gzipped |
|---|---|
| Opening the app — every screen except the camera | **107 KB** |
| The first time the camera is opened, on a phone | 8 MB (3.3 MB runtime + 4.7 MB lite model) |
| The first time the camera is opened, on a laptop | 11 MB (the full model is larger) |

The `dist/` folder is about 53 MB, but nobody downloads 53 MB: a static host
serves files on request, and the app fetches exactly one pose runtime and one
model, chosen for the device. `public/_headers` marks both immutable, so it
happens once and never again.

Cloudflare Pages does not meter bandwidth on the free plan, so at demo scale this
costs nothing. It would take somewhere around twelve thousand first-time camera
users a month to trouble a metered host.

## Updating it

Push. The URL stays the same, so the link you have already sent people keeps
working and starts serving the new version. The JavaScript and CSS are named by
content hash, so a new build cannot be served from an old cache; only the pose
runtime and the models are pinned for a year, and those are a vendored release
that does not change.

**Re-run `python scripts/make_snapshot.py` first if anything the site *shows* has
changed** — protocols, exit criteria, exercises, the demo player. The hosted site
has no backend, so the snapshot is not a fallback there, it is the entire content:
a stale one is a site quietly showing last week's data to everyone you sent the
link to.

The build refuses outright if the snapshot is missing, and prints its age if it is
not. It cannot know whether the recording still matches the code. That call is
yours. The rule of thumb is: **if you touched anything under `app/`, re-record.**

Changing the app usually means updating both things you have handed out:

| | How |
|---|---|
| The hosted link | `git push` |
| The Android package | `npm run apk`, then `send-to-phone.bat` |

A push does **not** update a phone that already has the APK installed. They are
two artefacts built from the same code.

## Things the build depends on that are not in git

`web/public/mediapipe/` and `web/public/models/` are copies — of MediaPipe's wasm
from `node_modules`, and of the two `.task` files in `models/` at the repository
root. They are generated, so they are not committed.

This matters more than it sounds: a hosted build starts from a clean clone, so
without regenerating them it would produce a site that looks completely fine and
whose camera never starts. `npm run build` runs
[`scripts/vendor-assets.mjs`](../web/scripts/vendor-assets.mjs) first for exactly
that reason. If a deployment log does not show these three lines, the camera is
broken on the version you just shipped:

```
wasm    -> .../public/mediapipe/wasm
full    -> .../public/models/pose_landmarker_full.task
lite    -> .../public/models/pose_landmarker_lite.task
```

## If you would rather use a different host

Nothing here is Cloudflare-specific except `_headers` and the build settings. The
build is plain static files with no server-side anything, and the app never
changes the URL path — no rewrite rules, no SPA fallback needed. Netlify reads the
same `_headers` format; GitHub Pages ignores it and simply re-downloads the
runtime more often.

One thing to check on any host: `/healthz` must **not** return a page. The app
asks for it to find out whether a real backend is there, and hosts that answer
unknown paths with `index.html` used to fool it into a 200. It now requires the
API's own JSON reply, so a 404 is the correct and expected answer here.
