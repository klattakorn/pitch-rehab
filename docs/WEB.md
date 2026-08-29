# Putting it on the web

For anyone the Android package cannot reach: iPhones, and anyone not on your wifi.

The app already runs with no backend — that is what **Carry on without a laptop**
does, replaying a recording of the real API from
[`web/src/demo/snapshot.json`](../web/src/demo/snapshot.json). So the built `dist/`
folder is a complete, self-contained app. Put it on any static host and it works.

```bash
cd web && npm run deploy
```

You get a `https://pitch-rehab.pages.dev` address; send that to anyone.

**Two things once, before the first deploy.** Sign in:

```bash
cd web && npx wrangler login
```

Then tell it which account to publish to.

Wrangler normally works this out itself by asking which accounts you belong to.
If that call fails — a 500 on `GET /memberships`, which wrangler reports as
*"Internal authentication error"* — the usual reason is that **there are none to
list**. A Cloudflare login and a Cloudflare account are separate things, and
signing up does not always create the second. The message points at
authentication, which is misleading: `npx wrangler whoami` will happily confirm
the login is good.

Open <https://dash.cloudflare.com>. If the Accounts page is empty, press
**Create Account** — any name, the free plan covers Pages and asks for no card.
Then copy **Account ID** from the right of the account's overview page; it is
also the long string in the address bar. Put it on its own line in:

```
web/.cloudflare-account
```

That file is not in git. The id is not a secret — it is in every dashboard URL
and is useless without a token — but it belongs to whoever is deploying, so each
person sets their own. `CLOUDFLARE_ACCOUNT_ID` in the environment works too and
takes precedence.

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
| Opening the app — every screen except the camera | **105 KB** |
| The first time the camera is opened, on a phone | 8 MB (3.3 MB runtime + 4.7 MB lite model) |
| The first time the camera is opened, on a laptop | 11 MB (the full model is larger) |

The `dist/` folder is about 50 MB, but nobody downloads 50 MB: a static host
serves files on request, and the app fetches exactly one pose runtime and one
model, chosen for the device. `public/_headers` marks both immutable, so it
happens once and never again.

## Updating it

Same command. It rebuilds and uploads, and the URL stays the same — so the link
you have already sent people keeps working and starts serving the new version.

```bash
cd web && npm run deploy
```

Visitors get it on their next load. The JavaScript and CSS are named by content
hash, so a new build cannot be served from an old cache; only the pose runtime
and the models are pinned for a year, and those are a vendored release that does
not change.

**Re-run `python scripts/make_snapshot.py` first if anything the site shows has
changed** — protocols, exit criteria, the demo player. The hosted site has no
backend, so the snapshot is not a fallback there, it is the entire content: a
stale one is a site quietly showing last week's data to everyone you sent the
link to. `npm run deploy` refuses outright if the snapshot is missing and prints
its age if it is not, but it cannot know whether the recording still matches the
code. That call is yours.

Changing the app usually means updating both things you have handed out:

| | Command |
|---|---|
| The hosted link | `npm run deploy` |
| The Android package | `npm run apk`, then `send-to-phone.bat` |

## If you would rather use a different host

Nothing here is Cloudflare-specific except `_headers` and that one command. The
build is plain static files with no server-side anything, and the app never
changes the URL path — no rewrite rules, no SPA fallback needed. Netlify reads
the same `_headers` format; GitHub Pages ignores it and simply re-downloads the
runtime more often.

One thing to check on any host: `/healthz` must **not** return a page. The app
asks for it to find out whether a real backend is there, and hosts that answer
unknown paths with `index.html` used to fool it into a 200. It now requires the
API's own JSON reply, so a 404 is the correct and expected answer here.
