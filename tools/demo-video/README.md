# demo-video

Turns a storyboard into a narrated mp4 by driving a real browser. No
screen-recording permission, no third-party service, nothing bought.

```bash
demo-video doctor                  # what is ready, what is not
demo-video voice                   # once per machine — do this first
demo-video record my-demo
```

## Install

This directory is synced from an upstream copy that lives inside a product
repo. To finish a fresh install:

```bash
cd ~/.claude/tools/demo-video
bun install
bunx playwright install chromium
ln -s ~/.claude/tools/demo-video/demo-video ~/.local/bin/demo-video
demo-video doctor
```

`product.ts` is this install's own — it is seeded once and never overwritten by
a later sync, so anything configured here survives.

## Where things live

| | Path |
|---|---|
| Storyboards | `${XDG_CONFIG_HOME:-~/.config}/demo-video/storyboards/<name>.json` |
| Rendered output | `${XDG_CONFIG_HOME:-~/.config}/demo-video/out/<name>/` |
| Voice config | `${XDG_CONFIG_HOME:-~/.config}/demo-video/voice.json` |
| Saved sessions | `${XDG_CONFIG_HOME:-~/.config}/demo-video/sessions/<name>.json` |

That config directory is **shared with the repo install**, deliberately: a voice
configured once works from both front doors.

## The pipeline

```
storyboards/<name>.json
        │
        ├─ narration ──► out/<name>/audio/*.wav + timings.json
        │                          │
        │                          ▼
        ├─ take 1 ──────────► video-1/*.webm + marks-1.json
        │                          │
        └─ assemble ─────────► out/<name>/<name>.mp4 + manifest.json
```

**Narration runs first, and that ordering is the whole sync design.** Each
clip's duration is measured before the walk starts; the walk then holds each
screen for at least that long and records the wall-clock offset at which the
segment actually began. ffmpeg lays each clip at its observed mark. Sync is
arithmetic, so a slow route transition pushes the rest of the demo along with it
instead of desyncing.

Clips are cached by a hash of their text and voice, so editing one line of
narration regenerates one clip, not all of them.

## Authoring a storyboard

```json
{
  "name": "my-demo",
  "title": "My demo",
  "baseUrl": "https://example.com",
  "takes": [
    {
      "preflight": [
        {
          "url": "/",
          "expectText": "Example Domain",
          "because": "the narration says the page names itself"
        }
      ],
      "segments": [
        {
          "id": "s01-land",
          "say": "This is the thing, and here is what it does.",
          "do": [
            { "goto": "/" },
            { "awaitText": "text=Example Domain" },
            { "wait": 1 }
          ]
        }
      ]
    }
  ]
}
```

**Actions:** `goto` `click` `hover` `type` `press` `scroll` `scrollTo`
`awaitUrl` `awaitText` `wait`. Exactly one verb key per object.

**Targets** address elements with `kind=value`, chained with `>>` to scope:

```
button=Continue
text=Your properties
css=[data-slot="card"] >> has=Acme >> button=Get started
button=/Get started|Continue/          slashes make it a regular expression
```

Kinds: `button` `link` `heading` `tab` `checkbox` `radio` `textbox` `option`
`role` `text` `label` `placeholder` `title` `testid` `css`. When chaining, also
`has` `hasNot` `nth` `first` `last`.

Semantics are Playwright's own, so a target can match more than one element and
strict mode will say exactly what matched. **Fix that by scoping with `>>`, not
by writing a cleverer regex.**

**Scrolling is eased, and mostly implicit.** Clicking, hovering or typing into
anything below the fold scrolls there smoothly on its own. Reach for an explicit
`scrollTo` only when the scroll is the point — when the shot is "look at what is
further down", not "go press that button".

**Assert every fact you narrate.** If a sentence says "including the two new
fields", add a preflight check that those fields have values. A `url` +
`expectText` check covers any site; the `sql` form needs a `DATABASE_URL`.

## Voice

Three tiers, resolved in this order: `--voice` → the storyboard's `voice` field
→ the machine's configured default → the OS synthesiser.

| Tier | What | Setup |
|---|---|---|
| local custom | any TTS binary you have — a cloned voice, say | `demo-video voice --add <name> --command <path> --args '… {{text}} … {{out}}'` |
| cloud | hosted TTS | stubbed — see `lib/voice.ts` |
| system | `say` (macOS) / `espeak-ng` (Linux) | nothing |

A voice that is *asked for* and missing is an error. The pipeline never silently
falls back to the robot voice, because a demo that quietly stopped sounding like
you is worse than one that refused to render. But a machine with **nothing**
configured does render in the system voice — which is why `demo-video doctor`
calls that out specifically.

The config is a file rather than environment variables because a file survives
every shell and every worktree, and belongs to the machine rather than to any
checkout.

## Sessions: demoing a site you have to log into

```bash
demo-video login acme --url https://app.acme.com/login   # sign in by hand
demo-video login acme --from-browser app.acme.com        # borrow a live session
demo-video login --list
demo-video login acme --remove
```

```json
{ "session": "acme", "segments": [ … ] }
```

A visible browser opens, you sign in — SSO, MFA, a device prompt, whatever the
site asks — and pressing Enter saves Playwright's `storageState`. **Sign into
several sites in the one window before pressing Enter**: `storageState` is
per-origin, so one session file carries all of them.

`--from-browser` skips the sign-in by reading the cookies your real browser
already holds. It is the only option when the sign-in needs something a
throwaway profile cannot have — a passkey in a password-manager extension, for
instance. Cookies only, deliberately: a site that keeps auth in localStorage
fails at a sign-in screen rather than half-working.

**Why a human does the signing in** and not a scripted credential: the scripted
version fails exactly where it would be needed — an SSO redirect, an MFA step, a
bot check. Fifteen seconds of attention handles every one, and the credential
never leaves the password manager.

A session file is a bearer token. It is written `0600` and lives in the config
dir; nothing can point one somewhere committable.

**An expired session is a hard error, not a warning.** Replayed dead cookies do
not announce themselves — the walk lands on a sign-in page and dies later on a
selector that looks wrong, which is the most expensive way to find out a cookie
lapsed.

## Engines

| | `playwright` (default) | `interceptor` |
|---|---|---|
| Browser | headless Chromium, fresh context | your own signed-in Chrome/Brave, recorded as a window |
| Login | `demo-video login` session, or none | already signed in, everywhere |
| Bot detection | a CDP fingerprint sites can see | none |
| Runs headless | **yes** — record while you work | no; a real window must be open |
| Platform | macOS, Linux | macOS only (ScreenCaptureKit) |
| Permissions | none | Screen Recording, granted to interceptor-bridge |

**Use `playwright` unless you specifically need the real profile.** It is
headless, portable, and its strict mode names exactly what an ambiguous target
matched instead of picking one.

A strict-CSP site blocks the interceptor resolver in both worlds. The take can
opt in with `"allowCspStrip": true` — a real trade, since for the length of the
take a site you are signed into runs without its own XSS defenses, which is why
it lives in the storyboard rather than a CLI flag.

## Prerequisites

`bun install` covers the Playwright *library*. Two things it does not: the
browser binary, and ffmpeg.

```bash
demo-video deps            # install what is missing
demo-video deps --check    # report only; exits 1 if anything is missing
demo-video deps --yes      # no prompts
```

Idempotent, prompts before anything needing `sudo`, and re-probes at the end
rather than trusting the package manager's exit code.

## Gotchas

Each of these cost a take or an afternoon.

- **The tape starts before the walk does.** Playwright records from page
  creation — a white `about:blank` — not from the first `goto`. The recorder
  pre-navigates, reports that head time, and the assembler trims it per take.
- **`amix` normalises to 1/N by default.** With a dozen clips the narration is
  nearly inaudible. `assemble.ts` passes `normalize=0`; the clips never overlap,
  so unity is correct.
- **The browser's top layer stacks by entry order, not z-index.** A `<dialog>`
  opened after the cursor overlay paints straight over it and no z-index can
  help. `cursor.ts` re-enters the top layer whenever the set of open dialogs
  changes.
- **Compositing a cursor in post does not work.** There is no clean `t=0`
  handshake between Playwright's video clock and Node's wall clock, and the
  pointer lags the action by seconds. The in-page overlay cannot desync because
  there is only one clock.
- **No `wheel` events are dispatched**, so a component that listens for `wheel`
  specifically — a virtualised list, a scroll hijacker — will not react.
  `scroll` events fire normally, which covers sticky headers, scroll-spy and
  `IntersectionObserver`.
- **A recorded walk is also a smoke test.** It clicks faster than a human, which
  is exactly what surfaces cache and refetch races. Read the walk's log.

## Files

| File | Role |
|---|---|
| `run.ts` | CLI: preflight → narration → takes → assemble |
| `doctor.ts` | CLI: report readiness, name every fix |
| `voice.ts` | CLI: set up and test the machine's voices |
| `login.ts` | CLI: capture and manage browser sessions |
| `product.ts` | This install's own config — never overwritten by a sync |
| `lib/storyboard.ts` | Types, loading, validation |
| `lib/selector.ts` | The `kind=value >> kind=value` target grammar |
| `lib/voice.ts` | Tier resolution and clip synthesis |
| `lib/cursor.ts` | The injected pointer and click ripple |
| `lib/preflight.ts` | Tooling, stack reachability, data assertions, reset |
| `lib/record.ts` | The storyboard interpreter |
| `lib/assemble.ts` | The ffmpeg mux |
