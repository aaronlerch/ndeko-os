---
name: Interceptor
description: "Real Chrome browser automation via Interceptor extension — controls the actual browser from inside (zero CDP fingerprint, passes all major bot detection checks including BrowserScan, Pixelscan, CreepJS, Fingerprint.com). Stays logged in, uses your real sessions. Compound commands (open, read, act, inspect) collapse multi-step flows into single calls. Unique capabilities: monitor/replay system (record user actions → export replayable plan scripts for regression), network log (auto-captures all fetch/XHR), scene graph for rich editors (Google Docs, Canva, Slides). Owns this install's computer-use switch and allowlist (interceptor surface). Workflows: VerifyDeploy, Reproduce (open affected page BEFORE code analysis — mandatory per rules), RecordFlow, ReplayFlow, TestForm, Update. MANDATORY for all visual verification — never use agent-browser for deploy confirmation. USE WHEN verify deploy, confirm UI, check page, screenshot verification, interceptor, debug web, troubleshoot, visual check, authenticated page, bot detection bypass, agent-browser failing, reproduce bug, record flow, replay flow, test form, QA test, regression check, computer-use mode, surface_disabled, domain_not_allowed, allowlist. NOT FOR scraping at scale from rotating residential or geo-specific IPs — this harness has no proxy path, so say that out loud rather than substituting a weaker probe. (Batch IS supported: see `interceptor batch`.)"
version: 2.2.0
effort: medium
---

# Interceptor — Stealth Browser Automation

**Tool:** `interceptor` CLI — Chrome extension that controls the real browser from the inside.
**Upstream:** https://github.com/Hacker-Valley-Media/Interceptor
**Install:** `~/src/valid/interceptor`, branch **`my-install`**, built from source (see `Workflows/Update.md`).
Git remotes here are **inverted from the usual convention**: `origin` is *our fork*
(`aaronlerch/Interceptor`), `upstream` is Hacker-Valley-Media. `origin/main` still sits at the
2026-06 fork point, so `git reset --hard origin/main` destroys every fork delta below.

### Why Interceptor?

agent-browser uses CDP — sites can detect it, and it is not installed here in any case. Interceptor is a Chrome extension that operates through the actual browser UI. No debugger, no automation flags, no separate browser instance. You stay logged in, you pass bot detection, the agent sees what you see.

### Fork Deltas — we do NOT run upstream

We track `Hacker-Valley-Media/Interceptor` but merge deliberately after review
(last merged: upstream 2.1.3, 2026-10-16). Twelve deltas, numbered to match
`docs/FORK-DELTA.md`. All of them change what the CLI will do for you, so a
command that works upstream can fail here by design.

1. **No iOS surface.** `interceptor ios …` does not exist here; the whole device
   subsystem was removed, along with a root LaunchDaemon whose control socket was
   world-writable. Don't reach for iPhone automation with this tool.
2. **CSP-strip is opt-in.** See the `--allow-csp-strip` gotcha below. Upstream
   strips a page's CSP header automatically; we refuse unless asked.
3. **Extension Fabric fails closed.** Bridge extension dylibs won't load without
   an operator Team-ID allowlist in `~/.interceptor/extension-trust.json`.
4. **Content scripts are dormant until attached.** Local feature, not upstream —
   the four `<all_urls>` scripts activate only while a tab is being driven, so
   heavy React/chart pages don't freeze while Interceptor is idle.
5. **`interceptor macos sudo` is removed.** It ran an arbitrary command as root
   with a vault password on stdin, and needed no bridge to do it. The verb does
   not parse. There is no replacement — this is a deliberate capability cut.
6. **`interceptor macos authdialog` is removed.** Same escalation class: it filled
   the macOS admin prompt from the vault, `--submit` pressing confirm. Gone.
7. **The vault is 1Password.** All of `macos secret register|set|list|rm|unlock|
   lock|reveal` are gone; only `macos secret status` remains. `--secret` now takes
   a **1Password reference**, not a name — see "Credentials" below.
8. **`net log` exports redact credential headers by default.** `--redact-auth` was
   upstream's opt-in; here it's the default and `--no-redact-auth` is the opt-out.
9. **The daemon WebSocket is loopback-bound, peer-checked and Host-checked.** No web
   page, LAN host, or DNS-rebound page can drive it.
10. **Computer-use mode is a switch plus an allowlist, enforced inside the bridge.**
    See "Computer-use mode" below. `desktop …` and `group prune` ride the same gate
    as `macos …`; nothing reaches the bridge around it.
11. **Read verbs mask passwords, card numbers, CVVs and one-time codes** as
    `***SECURE***`, and keep a password masked after a show-password toggle.
12. **Never install an update from Sparkle's window.** It installs the vendor build
    over this one and silently reverts every delta here. `update_available` is
    something to report to Aaron, not act on. Updates are a source merge
    (`Workflows/Update.md`).

Full record: `~/src/valid/interceptor/docs/FORK-DELTA.md`. Re-read it after any
upstream merge — merging is the moment these can silently revert.

### Prerequisites

- Chrome, Brave, **or Safari** running with the Interceptor extension loaded
- `interceptor` CLI in PATH — `~/.local/bin/interceptor`, a **symlink** into
  `~/src/valid/interceptor/dist/interceptor`. Nothing is copied to
  `/opt/homebrew/bin`; a rebuild is live the moment it lands in `dist/`.
- `interceptor-daemon` is **not on PATH and is not supposed to be.** Chrome launches
  it in place from the repo via the native-messaging manifest
  (`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.interceptor.host.json`,
  which hardcodes the repo path). `which interceptor-daemon` returning nothing is
  the healthy state — check `pgrep -fl interceptor-daemon` instead. **Moving or
  renaming the repo breaks the browser leg** until step 5 of Update.md re-runs.
- Native messaging manifest registered (`Workflows/Update.md` step 5)
- For native-app work: the bridge installed and computer-use mode on — see below

### Computer-use mode — the bridge, the switch, and the allowlist

The bridge (`interceptor-bridge.app`, a LaunchAgent) is the Swift helper that holds
macOS privacy grants and drives native apps: accessibility trees, window capture,
OS-level and background input, clipboard, files, scripting. **It is installed and
on here, narrowed to read-only work.** For the native command set, load the
`interceptor-macos` skill; this section owns only what is specific to this install.

**Check the state first:** `interceptor surface status` prints the mode, whether a
bridge is present, and the allowlist. `interceptor status` shows `mode:` and the
bridge pid.

| Control | Effect |
|---|---|
| `interceptor surface browser-only` | All native control off. The bridge refuses everything but `trust`, and no daemon will launch one. |
| `interceptor surface full` | Native control on, limited by the allowlist. |
| `interceptor surface allow recommended` | **The default here.** Reads, window capture, on-device vision/NLP/AI only. |
| `interceptor surface allow add click,type,keys` | Adds input, keeping what is already allowed. `allow remove …` takes it back. |
| `interceptor surface allow <domains>` | **Replaces** the whole list — reach for `add`/`remove` instead. |
| `interceptor surface allow none` / `all` | Deny every domain / permit every domain. |

The `recommended` set: `tree find inspect value focused windows text apps app
frontmost screenshot capture display vision nlp ai sounds sensitive health translate
detect thumbnail pdf log trust tcc`. Note `app` is in it, so `macos app activate`
works, and that **moves focus** — it is one of the two explicit opt-in focus verbs.

- **Changing the mode or the allowlist is Aaron's call, not yours.** When a command
  fails with `surface_disabled` or `domain_not_allowed`, stop and tell him the exact
  `surface` command the error names. Do not enable it yourself to get unblocked,
  and never reach for `allow all`. Narrow beats broad: name the domains the task
  needs.
- **`bginput` is full input to any window in any app, invisibly** — the cursor does
  not move and the app does not come forward. It is what `--trusted` uses on an
  unfocused browser window. Ask for it only alongside `click,type,keys`, and say what
  it means when you do.
- **`mouse` moves Aaron's real pointer** (fork-local, for demo recordings):
  `macos mouse move X,Y|<ref> [--ms 700] [--ease in-out|linear]` glides it and
  returns the read-back position (`reached: true`); `macos click|drag … --glide`
  travels there first and needs `mouse` *and* `click`. `mouse position` reads it.
  `mouse hide|show` are refused — a background app cannot hide the pointer.
  Recording a glide: **ffmpeg avfoundation does not draw the pointer on macOS 27
  even with `-capture_cursor 1`**; `screencapture -v -C -V <s> out.mov` does.
  *(2026-10-16)*
- Domains this install deliberately keeps off: `intent` / `script` (arbitrary
  automation), `fs`, `vm`, `update`, and the personal-data stores.
- **Enforcement is inside the bridge**, after every route has been normalized — the
  CLI, the daemon, background input, a direct socket write, and App Intents all
  stop at the same check. A refusal is the design working; there is no flag
  around it (`--all-surfaces` and `INTERCEPTOR_ALL_SURFACES` do not beat the
  bridge).
- **The bridge socket has no caller authentication.** Anything running as Aaron can
  use every allowlisted domain with the bridge's grants. That is why the allowlist is
  narrow and why it, not the grants, is the control.
- **macOS 27 renamed the Accessibility pane** to Privacy & Security → **Device
  Control and Data Access**. Screen Recording is still **Screen & System Audio
  Recording**. `interceptor macos trust` reports both grants; giving a grant is
  Aaron's step — stop and give him the exact clicks.
- **The bridge is signed with a local self-signed identity**, so grants survive
  rebuilds. If grants ever reset after a rebuild, the build fell back to ad-hoc
  signing — see `Workflows/Update.md` step 6.

Install, signing, grants, verification and uninstall: `Workflows/Update.md` step 6.

---

## Compound Commands (Preferred)

These collapse multi-step patterns into single invocations — fewer tool calls, fewer tokens:

```bash
interceptor open "https://example.com"              # Open URL, wait, return tree + text
interceptor open <url> --tree-only|--text-only|--full|--no-wait
interceptor read                                     # Tree + text for active tab
interceptor read <ref>                               # Tree + text for element subtree
interceptor read --include-style|--include-frames
interceptor act <ref>                                # Click + wait + return updated tree + diff
interceptor act <ref> "value"                        # Type + wait + return updated tree
interceptor act <ref> --trusted                      # OS-level trusted input via the bridge (needs click/type/keys allowed; bginput for an unfocused window)
interceptor act <ref> --keys "Enter"                 # Send keyboard shortcut
interceptor inspect                                  # Tree + text + network log + headers
interceptor inspect --net-only                       # Network only
```

## Core Commands

```bash
# State + discovery
interceptor state [--full]              # DOM tree + metadata
interceptor tree [--filter all] [--depth N] [--max-chars N]
interceptor diff                         # Changes since last state/tree read
interceptor find "query" [--role button] # Find elements by name
interceptor text [<index|ref>]
interceptor html <index|ref>

# Element interaction
interceptor click <ref>                  # Click by ref (eN)
interceptor click <ref> --at X,Y         # Click at coordinates
interceptor dblclick <ref> --at X,Y
interceptor rightclick <ref> --at X,Y
interceptor type <ref> <text> [--append]
interceptor type "role:name" <text>      # Semantic selector
interceptor select <ref> <value>         # Dropdown
interceptor focus|hover <ref>
interceptor drag <ref> --from X,Y --to X,Y [--steps N] [--duration MS]
interceptor keys "<combo>"               # e.g. "Control+A"

# Navigation + tabs
interceptor navigate <url>
interceptor back | forward
interceptor scroll <up|down|top|bottom>
interceptor wait <ms> | wait-stable [--ms N] [--timeout N]
interceptor tabs
interceptor tab new [url] | tab close [id] | tab switch <id>

# Capture
interceptor screenshot [--save] [--format png|jpeg] [--full] [--clip X,Y,W,H] [--element N]
interceptor eval <code> [--main]         # JS in isolated or main world
interceptor eval <code> --main --allow-csp-strip   # opt in to stripping the page CSP (see Gotchas)
interceptor capture start | frame | stop # tabCapture stream
interceptor ocr "<css>"                  # OCR an element's pixels (bundled Tesseract, offline)
interceptor canvas ocr <n>               # Canvas text via aria/semantic model (no pixel OCR)

# Binary sink — page bytes straight to disk (no downloads shelf, no Save dialog, no CDP)
interceptor save --out /abs/path/file.bin "window.someBlobOrUint8Array"
interceptor save --out /abs/path/f.png  "blob:https://example.com/..."
interceptor save --out /abs/path/f.txt  "new Blob([text], {type:'text/plain'})"
#   → {path, bytes, sha256}, integrity-checked. <expr> must be self-contained.

# File upload (any size — chunked automatically; dropzones and pickers)
interceptor upload <ref> /abs/path/file [--json]

# Idle / power
interceptor idle                         # Is the user idle? (for unattended runs)
interceptor keepawake on|off             # Hold a power-save block while driving

# Style injection (test redesigns live)
interceptor style inject --css "<rules>" [--top-only]
interceptor style remove <handle>

# Cookies
interceptor cookies <domain>
interceptor cookies set <json>
interceptor cookies delete <url> <name>
```

## Credentials — 1Password references (fork delta §7)

Never put a password in a literal `type` call, never ask Aaron to paste one into
chat, and never read one into your own context. Type it by **reference**: the value
is resolved inside the daemon and never enters the CLI process, the transcript, or
the monitor recording (which logs `***SECURE***`).

```bash
interceptor type <ref> --secret op://<vault>/<item>/<field>     # browser field
interceptor macos type [<ref>] --secret op://<vault>/<item>/<field> --op-any-target [--app X]
interceptor macos secret status                                 # op binary + signed-in accounts
```

- **`--secret` takes `op://<vault>/<item>/<field>` — a reference, never a name.**
  A bare name is an upstream-era form and is rejected. Vault and item may each be
  a name or a UUID. Section-qualified refs (`op://v/i/section/field`) are rejected.
  In 1Password: right-click the field → **Copy Secret Reference**.
- **The allowlist is the 1Password item's own website URLs.** The daemon derives the
  tab's real host and matches it host-or-subdomain **before** `op read` runs, so a
  wrong destination never causes a read. An item with no URLs fails closed — fix it
  by adding the site to the item, not by reaching for the override.
- **`--op-any-target` bypasses that check and is required for `macos type`** — an
  item URL cannot describe a native app. On a browser field, needing it means the
  item is missing the site; prefer fixing the item.
- **`--op-account <shorthand>` is required when more than one 1Password account is
  signed in** (or `INTERCEPTOR_OP_ACCOUNT`). Without it the daemon refuses rather
  than letting `op` silently pick one.
- **The gate is 1Password's own** — Touch ID, unlock timeout, lock-on-sleep. No
  bridge needed. `OP_SERVICE_ACCOUNT_TOKEN` is deliberately unsupported: it bypasses
  biometrics and recreates the unattended-credential-store the fork removed.
- **A 12s stall means an authorization prompt, not a browser problem.** Every `op`
  call carries a deadline (`INTERCEPTOR_OP_TIMEOUT_MS`). If it fires, bring 1Password
  to the front and approve — do not go debugging the extension leg.


## Network

```bash
# Passive capture (always-on, no CDP fingerprint)
interceptor net log [--filter <pat>] [--limit N] [--since <ts>]
interceptor net log --format har --out <path>          # Authorization headers REDACTED (fork default)
interceptor net log --format har --out <path> --no-redact-auth   # keeps credential headers — opt in deliberately
interceptor net headers [--filter <pat>]   # CSRF, auth headers
interceptor net clear

# Request override (passive, no CDP). Set it after the page loads — it lives in that page.
interceptor override "*pattern*" key=value                       # rewrite query params
interceptor override "*pattern*" --status 500 [--body <text>] [--content-type <t>] [--delay <ms>]   # answer locally, no request sent
interceptor override clear

# CDP-attached interception (explicit opt-in — leaves debugger banner)
interceptor network on [patterns...]
interceptor network off
interceptor network log
interceptor network override on '<json>'
interceptor network override off

# SSE streams (LLM responses, live feeds)
interceptor sse log [--filter <pat>] [--limit N]
interceptor sse streams
interceptor sse tail [--filter <pat>]

# Header rewriting
interceptor headers add <name> <value>
interceptor headers remove <name>
interceptor headers clear
```

## Recording (Session Monitor)

Record real user actions on the active tab, replay as a deterministic plan script.

```bash
interceptor monitor start ["instruction"]   # Start recording
interceptor monitor pause | resume
interceptor monitor stop                     # End + emit summary
interceptor monitor status [--all]
interceptor monitor list                     # All sessions
interceptor monitor tail [--current] [--raw] # Live tail
interceptor monitor export <sessionId>       # Aligned text
interceptor monitor export <sessionId> --plan # Replay script
interceptor monitor export <sessionId> --json
```

## Canvas (Rich Web Apps)

For apps that render to `<canvas>` (Figma, Excalidraw, in-house editors):

```bash
interceptor canvas list | status
interceptor canvas log [N] [--kind fillText]
interceptor canvas objects [N] [--kind text]
interceptor canvas model | routes
interceptor canvas ocr N [--region X,Y,W,H]
interceptor canvas read N [--format png] [--region X,Y,W,H] [--webgl]
interceptor canvas diff <url1> <url2> [--threshold 10] [--image]
```

## Scene Graph (Rich Editors — Google Docs/Slides, Canva)

```bash
interceptor scene profile [--verbose]
interceptor scene list [--type shape|text|image|page|embed|slide]
interceptor scene click <id> | dblclick <id> | select <id>
interceptor scene hit <x> <y>                # ID object at coordinates
interceptor scene selected | text [--with-html]
interceptor scene insert "<text>"
interceptor scene cursor-to <x> <y>
interceptor scene slide list | current | goto <index> | notes [--slide N]
interceptor scene render <id> [--save]
interceptor scene zoom
interceptor scene ... --profile <name>       # Force profile, bypass detection
```

## LinkedIn

```bash
interceptor linkedin event [url]             # Event + post data via DOM + network
interceptor linkedin attendees [url]         # Attendees with override + enrichment
```

## ChatGPT Agentic Bridge

Drive chatgpt.com from CLI without an API key:

```bash
interceptor chatgpt send "<prompt>" [--stream]
interceptor chatgpt read | status
interceptor chatgpt conversations | switch <id>
interceptor chatgpt model [name]
interceptor chatgpt stop
```

## Tab Groups — Per-Agent Isolation

Use this whenever more than one agent drives the browser at once. Each agent
gets its own named group; the auto-target is per-group, so concurrent agents
never clobber each other's working tab.

```bash
interceptor open <url> --group <label>   # Work inside a named group
interceptor read --group <label>         # Every verb takes --group
interceptor group list                   # All live groups: label, title, color, tab count
interceptor group close <label>          # Atomically close one group; others untouched
```

Agent shells get a soft per-session group automatically; concurrent lanes still
need a unique `--group` or `INTERCEPTOR_SESSION_ID`.

**Stay out of Aaron's window.** He is working on the same Mac in the same browser.
Rendering problems in a hidden tab have background answers — reach for them before
any focus move:

```bash
interceptor tab keepalive <id>           # hidden tab reads as visible, runs animation frames
interceptor window new [url]             # your group moves into its own background window
interceptor tab switch <prior-id>        # allowed once, only to put back the tab he was on
```

`interceptor group prune [--dry-run] [<label>…]` deletes closed saved groups
Interceptor left on the bookmarks bar by clicking through the browser's own UI. A
delete **syncs to every device and cannot be undone**: run `--dry-run` first, and run
the real thing only when Aaron asks. It needs computer-use mode with `tree`, `click`
and `action` allowed.

## Batch + Meta

```bash
interceptor batch '<json_array>' [--stop-on-error] [--timeout MS]
interceptor status                    # Daemon + bridge state (local check)
interceptor manifest                  # Machine-readable: every verb + exact return shape
interceptor diagnose [--json]         # Post-failure snapshot (run this before guessing)
interceptor contexts                  # Connected browser contexts
interceptor help [<command>]
```

## Key Rules

- **Requires Chrome running** — it's an extension, not a standalone binary.
- **Refs use eN syntax** — `e12` not `@e12`. No `@` prefix.
- **Cross-frame refs** — `read --include-frames` returns refs like `e<frameId>_<n>` for non-top frames.
- **Plain text output is the default and the one to read.** `--json` is for piping
  into a script; it costs more tokens and reads worse.
- **Daemon auto-starts** — first command launches it; no manual start needed.
- **Synthetic input is the default** for page content and needs no bridge. `--trusted`
  is the escalation, and it rides the bridge's allowlist.

## Delegating to Agents

When spawning agents for Interceptor work:

```
Agent(subagent_type="general-purpose", prompt="
  Use interceptor CLI for all browser work; load the interceptor-browser skill
  (and interceptor-macos for native apps).
  Commands: open <url>, read, act eN, act eN 'text', inspect, screenshot.
  Compound commands preferred — they return tree + text in one call.
  Refs use eN syntax (no @ prefix) from tree output. Read plain-text output.
  Use --group <your-label> so you never touch another lane's tabs.
  If a command returns surface_disabled or domain_not_allowed, stop and report
  the surface command it names — do not change the mode or allowlist.
  [your specific task instructions here]
")
```

## Gotchas

- **The `interceptor-browser`, `interceptor-macos` and `interceptor-research` skills are the fork's own, generated for macOS.** `scripts/build.sh` writes them to `dist/skills`; `~/.claude/skills/interceptor-*` link there. They are the command reference — this skill carries the house rules on top. The repo's `.agents/skills/` are *sources* with Windows/Linux lines and OS markers: never link those directly. After a build, `interceptor skills adopt --into claude --force` refreshes the links. `claude/interceptor: name-collision` in `skills status` is expected — this `Interceptor` skill holds that name. *(2026-10-16; supersedes the 2026-09-06 "never adopt" rule, written when those skills still taught the removed credential verbs.)*
- **Screenshot ignores scroll position.** `interceptor screenshot` (with or without `--full`) captures from y=0 of the document — it does not honor `window.scrollTo`, `scrollIntoView`, `scroll bottom`, or `keys End`. For tall pages, content below the fold is unreachable through screenshot. Workaround: render the section of interest at its own short URL (`/problems.html`, `/section-3.html`) and screenshot that page directly. The `--clip "x,y,w,h"` flag returns "Cannot read properties of undefined" — broken in the current build. *(2026-04-27)*
- **`--clip` is broken but `--region` and `--selector` are NOT — reach for those instead.** `interceptor help screenshot` lists `--clip` as a deprecated alias for `--region`; the alias is what's broken, the real flag works. `--region X,Y,W,H` crops any band of a tall page (coordinates are full-page document pixels — the same space `--full` captures in), and `--selector "figure.foo"` / `--element N` capture one element directly, off-screen ones included. `--scale 2` gets retina detail for inspecting type and 1px strokes. Don't fall back to re-rendering sections at separate URLs — that workaround predates these flags. *(2026-08-06)*
- **An element screenshot composites without the page background.** `--selector` returns the element over a transparent/white backdrop, so a dark-theme capture shows correct element fills against a *light* surround — and any `paint-order` knockout or background-colored halo renders as a visible dark blob that does not exist on the real page. Judge theme correctness from `--region` (which includes `body`), never from `--selector`. *(2026-08-06)*
- **A published Artifact's own content does NOT paint into a screenshot of its claude.ai page.** Capturing `claude.ai/code/artifact/<id>` returns the page chrome (title bar, Share button) over a blank body — the artifact renders in a cross-origin iframe the extension can't composite. Verifying a published artifact this way looks like "the page is empty" and is not evidence about the artifact. Instead open the **source file** via `file:///abs/path.html` and probe that — same HTML, same CSS, no iframe. Only the publish step itself needs the URL. *(2026-08-06)*
- **Verifying an artifact via `file://` renders it in QUIRKS MODE — theme bugs you see there may not exist on the published page.** Artifact source files carry no `<!doctype html>` (the publish pipeline wraps one on), so a raw `file://` open puts Chrome in quirks mode, where the legacy table-color quirk stops `<table>` inheriting `color` from its parent. Every cell silently paints in the *light*-theme ink, which on a dark ground reads as a genuine contrast bug and burns a debug cycle. Confirm with `document.compatMode` — `BackCompat` is quirks, `CSS1Compat` is standards — and re-probe against a doctype-wrapped copy (`{ printf '<!doctype html>\n<html><head><meta charset="utf-8"></head><body>\n'; cat src.html; printf '\n</body></html>\n'; } > sim.html`) before changing any CSS. Reading `getComputedStyle(el).color` up the ancestor chain localizes it in one call; the screenshot alone cannot distinguish this from a real token bug. *(2026-08-06)*
- **`sips -c H W --cropOffset Y X` silently ignores the offset and center-crops.** Slicing a tall screenshot into sections with a loop over `--cropOffset` returns the same middle band every time, so "the top of the page" is actually the middle — which reads as missing content rather than a bad crop. macOS ships no ImageMagick and often no PIL, so don't plan on shell-side cropping at all: crop at capture time with `--region`/`--selector`. *(2026-08-06)*
- **Multiple tabs at the same URL confuse routing.** When two tabs both load `localhost:5180/`, `tab switch <id>` reports `ok` but the visually-active Chrome tab may not change, and `screenshot` captures whatever Chrome is showing — not what `interceptor text` and `interceptor navigate` are routing to. Close duplicate tabs before screenshotting, or always work from a freshly-opened single tab.
- **`interceptor status` reporting a healthy daemon does NOT mean the browser is reachable.** `status` only checks the local daemon/socket; the extension side is unverified. With Chrome running and the daemon up, every real command can still fail with `error: no extensions connected`. Probe with a cheap `interceptor tabs` before building a verification plan around Interceptor — and never treat a green `status` as evidence the browser leg works. *(2026-07-28)*
- **`eval` is CSP-blocked on most sites.** Use `eval --main` to run in the page's main world instead of the isolated extension world. Interceptor automatically escalates *within* the page's policy first (userScripts world, then an ISOLATED retry), which clears most strict-CSP and Trusted-Types sites on its own. Pass small expressions only and avoid `Function`-constructor patterns.
- **`error: … Stripping the page's CSP header would disable the site's own XSS defenses` is a deliberate refusal, not a bug.** When a page defeats every in-policy path, the last resort is removing its `content-security-policy` response header for the tab and reloading. Our fork does **not** do that automatically (upstream does). Re-run with `--allow-csp-strip` if you genuinely intend it — and understand what it costs: the site loses its own XSS protection on that tab for as long as the session rule lives, which matters most on exactly the pages you're logged into. Prefer restructuring the expression first. Applies to `interceptor save` too. *(fork delta — see `docs/FORK-DELTA.md`)*
- **Heavy-DOM pages can wedge the extension leg.** On pages with very large trees (admin inspectors with accordions + wide data tables), `extract_text`/`find_element`/`evaluate` can time out repeatedly and the extension may drop to `no extensions connected`; light pages on the same origin keep working. Verify heavy pages with a targeted `find` right after a fresh navigate, and if 2-3 calls time out, stop — the extension usually reconnects after ~30s idle; don't loop retries. *(2026-07-30)*
- **Zombie daemons cause a persistent `no extensions connected` split-brain that never self-heals.** Daemon exit handlers unlink the runtime pid + socket files (`$TMPDIR/interceptor.{pid,sock}` since 2.x; `/tmp/` before) unconditionally — even when a NEWER daemon owns them — and relay election is pid-file-only, so kills and races accumulate stale `--standalone` daemons. A zombie that still answers the extension's pings keeps its keepalive green, so the extension NEVER reconnects to the live daemon, no matter how long you wait. **Diagnosis:** `pgrep -fl interceptor-daemon` — healthy is exactly 2 processes (one `--standalone`, one `chrome-extension://…` relay); 3+ means split-brain. **Recovery (no Chrome restart needed):** (1) `pkill -f "daemon/interceptor-daemon"`, (2) `sleep 2` to let exit handlers finish unlinking, (3) immediately run `interceptor status` so the CLI spawns the singleton and writes the pid file BEFORE the extension's backoff reconnect lands, (4) poll `interceptor tabs` — the respawned relay reads the pid file and attaches instead of spawning a competitor. Do NOT `rm` the socket/pid files after a delay (the reconnected pair may already own them) and do NOT kill only some daemons (any dying daemon deletes the survivor's runtime files). *(2026-08-02)*
- **A screenshot's pixel width is NOT its viewport width.** Headless Chrome's `--window-size=390,1600` produced a 390x1600 PNG whose actual `document.documentElement.clientWidth` was **500** — so the capture was a 390-wide *crop* of a 500-wide layout, showing clipped text on every line and reading as a genuine horizontal-overflow bug. Never conclude "the mobile layout overflows" from a narrow screenshot alone. Assert the viewport (`Emulation.setDeviceMetricsOverride` with `{width, height, deviceScaleFactor, mobile:true}` over CDP), then read `clientWidth`/`scrollWidth` back before trusting any layout conclusion. *(2026-08-03)*
- **When the extension leg wedges, CDP is the fallback — don't defer the criterion.** After ~6 consecutive `evaluate`/`navigate`/`screenshot` timeouts (extension alive enough to answer `tabs`), launching Chrome with `--headless=new --remote-debugging-port=N --user-data-dir=/tmp/...` and driving `Runtime.evaluate` / `Page.captureScreenshot` / `Runtime.consoleAPICalled` over a raw WebSocket from bun gave full measurement, screenshots, and console capture with no extension involved. A wedged tool is evidence about the tool, never about the thing being verified. *(2026-08-03)*

## Stealth Verification

Passes all major bot detection:

| Check | Result |
|-------|--------|
| BrowserScan | Normal |
| Pixelscan | Definitely Human |
| Sannysoft | All pass |
| CreepJS | 0% headless |
| Fingerprint.com | notDetected |
| AreyouHeadless | Not headless |

---

## Workflow Routing

| Trigger Words | Workflow | What It Does |
|--------------|----------|-------------|
| "verify deploy", "check deploy", "confirm deploy", "deploy verification" | `Workflows/VerifyDeploy.md` | Open URL in real Chrome, check for errors, capture screenshot evidence |
| "reproduce", "reproduce bug", "debug page", "check page", "blank screen" | `Workflows/Reproduce.md` | Open affected page BEFORE code analysis, capture console errors and network 404s |
| "record flow", "record workflow", "capture flow", "monitor start" | `Workflows/RecordFlow.md` | Record user actions via monitor system, export replayable plan script |
| "replay flow", "replay", "regression check", "run flow" | `Workflows/ReplayFlow.md` | Execute a recorded plan script step-by-step, verify each step, report regressions |
| "test form", "fill form", "form test", "check form" | `Workflows/TestForm.md` | Discover form fields, fill with test data, submit, verify result |
| "update", "check version", "rebuild" | `Workflows/Update.md` | Rebuild interceptor from source and verify |

---

## Execution Log

After completing any workflow, append a single JSONL entry:

```bash
echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","skill":"Interceptor","workflow":"WORKFLOW_USED","input":"8_WORD_SUMMARY","status":"ok|error","duration_s":SECONDS}' >> ${NDEKO_DATA_DIR}/memory/SKILLS/execution.jsonl
```
