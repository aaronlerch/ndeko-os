# Update Workflow

## When to Use

- After pulling new commits from Hacker-Valley-Media/Interceptor repo
- If interceptor commands fail unexpectedly
- Periodic capability check

## Remote layout — read this before any git command here

The remotes are **inverted from the usual convention**, and getting it backwards
is destructive:

| Remote | Points at | Holds |
|---|---|---|
| `origin` | `aaronlerch/Interceptor` (our fork) | `origin/my-install` — our real work. `origin/main` is frozen at the 2026-06 fork point. |
| `upstream` | `Hacker-Valley-Media/Interceptor` | upstream releases. Push is `DISABLED`. |

Working branch is **`my-install`**. There is no `valid/main` branch — the name
appears in `docs/FORK-DELTA.md` as a label for this line of work, not as a ref.

**Never `git reset --hard origin/main`.** That resets to the fork point and
destroys every fork delta. If a working tree needs cleaning, reset to
`origin/my-install`.

## Steps

### 1. Fetch upstream, review, merge

```bash
cd ~/src/valid/interceptor && git fetch upstream && git status -uno
git log --oneline --no-merges my-install..upstream/main     # what's new upstream
```

A merge is a **reviewed** operation, not a fast-forward. The 2.1.3 merge
(2026-10-16) is the template:

1. **Security-review the upstream diff in slices** before merging — daemon/shared,
   extension, bridge, scripts/CI, CLI + agent skills — read-only, via
   `git diff <merge-base> upstream/main -- <paths>`. Ask each slice two questions:
   is anything malicious or egress-y, and **does any new code path reach the bridge
   without passing the surface gate?** Upstream adds those routinely (2.1.3 added
   four). The Swift Router is the backstop, but every new route gets a guard too.
2. **Merge in a separate worktree** (`git worktree add -b merge/upstream-<v> ../Interceptor-merge-<v> my-install`),
   resolve, and work the merge checklist at the bottom of `docs/FORK-DELTA.md`.
   Cut surfaces stay cut on every modify/delete conflict: iOS, sudo, authdialog, the
   keychain vault, browser saved-login fill.
3. **Building in that worktree produces a launchable `dist/interceptor-bridge.app`.**
   Keep `~/.interceptor/mode` at `browser-only` while it exists, and
   `git worktree remove` it once merged.
4. Gate the merge:

```bash
bun run typecheck && bun test ./test/ ./extension/src
bash scripts/audit-capability-blind.sh
git grep -n 'runSudo\|macos_sudo\|BunSecretsVault\|secrets.json\|browser-creds' -- cli daemon shared   # must be empty
git ls-files | grep -E '(^|/)ios(/|-)|interceptor-ios'                                              # must be empty
```

Swift XCTest needs full Xcode, which this Mac does not have: prove the bridge gate
live instead (step 6d).

### 2. Install New Dependencies

```bash
cd ~/src/valid/interceptor && bun install
```

Always run before build — upstream may add deps (e.g. `ocrad.js` for canvas OCR
arrived in v0.8.0). Build will fail with "Could not resolve" otherwise.

### 3. Build

```bash
cd ~/src/valid/interceptor && bash scripts/build.sh
```

Produces:
- `dist/interceptor` — CLI
- `daemon/interceptor-daemon` — native messaging host
- `extension/dist/` — Chrome extension (manifest reflects upstream version)
- `dist/interceptor-bridge.app` — the bridge, signed with the local identity (installed by step 5)
- `dist/skills/` — this Mac's generated agent skills (`~/.claude/skills/interceptor-*` link here)

### 4. Install Binaries — nothing to do

**There is no copy step.** This install runs the build products in place:

- `~/.local/bin/interceptor` is a **symlink** to `~/src/valid/interceptor/dist/interceptor`,
  so the new CLI is live the moment `build.sh` finishes.
- `interceptor-daemon` is never installed to a PATH directory. Chrome launches it
  from the repo via the native-messaging manifest, which hardcodes the repo path.

Do **not** `cp` either binary into `/opt/homebrew/bin` — that creates a stale
duplicate that shadows the symlink and silently pins you to an old build.

Verify the running CLI is the one you just built:

```bash
ls -l ~/.local/bin/interceptor          # → …/src/valid/interceptor/dist/interceptor
interceptor --version --no-skills-hint
```

### 5. Install (native messaging + bridge)

```bash
cd ~/src/valid/interceptor && bash scripts/install.sh --full --chrome --skip-extension
```

- `--full` installs the bridge app to `~/.local/share/interceptor/interceptor-bridge.app`
  with a LaunchAgent, no sudo. Whether native control is *on* is the surface switch
  (step 6), not the install mode.
- `--skip-extension` is required on current Chrome: the installer cannot read the
  Developer-mode setting and reports it OFF when it is on. The extension is already
  loaded unpacked from `extension/dist`; reload it in step 7.
- The script regenerates the native-messaging manifest with the repo's daemon path —
  re-run it after moving the repo.

### 6. Computer-use mode — signing, switch, allowlist, grants

#### 6a. Signing (once per certificate)

`scripts/build-bridge.sh` signs with the local self-signed identity
**"Interceptor Local Signing"** when it exists (`--timestamp=none`). The bridge's
designated requirement is then `identifier "com.interceptor.bridge" and certificate
leaf = H"…"`, stable across rebuilds, so privacy grants survive them.

- Healthy build output: `Codesigning bundle with: Interceptor Local Signing (--timestamp=none)`.
  `ad-hoc sign` instead means the identity was not found — every grant resets.
- Check: `codesign -d -r- ~/.local/share/interceptor/interceptor-bridge.app`.
- The certificate expires a year after creation. Recreating it (Keychain Access →
  Certificate Assistant → Create a Certificate: that exact name, Self Signed Root,
  Code Signing) changes the leaf hash, so the grants are given once more.

#### 6b. Switch and allowlist

```bash
interceptor surface status
interceptor surface allow recommended        # before enabling; the standing default
interceptor surface full                     # or: browser-only
interceptor surface allow add click,type,keys    # only when Aaron asks
```

Mode and allowlist changes are Aaron's decisions. `allow <domains>` replaces the
list; `allow add|remove` edit it.

#### 6c. Grants — Aaron's step

Stop and give the exact clicks; do not proceed on an assumed grant.

1. **System Settings → Privacy & Security → Device Control and Data Access** (macOS 27's
   name for Accessibility). Remove stale `interceptor-bridge` rows (−), then **+**,
   ⌘⇧G, `~/.local/share/interceptor/interceptor-bridge.app`, Open, toggle on.
2. **Privacy & Security → Screen & System Audio Recording** — same app, toggle on.

Then `launchctl kickstart -k gui/$(id -u)/com.interceptor.bridge` and
`interceptor macos trust` must show both `granted`.

#### 6d. Verify the gates live

```bash
interceptor macos apps                       # allowlisted read → app list
interceptor macos click 5,5                  # → domain_not_allowed (until click is added)
interceptor macos tree --pid <pid>           # AX read; `--app X --depth 2` can return empty
interceptor macos screenshot --pid <pid> --save
```

In browser-only mode, a direct write to the bridge socket must come back
`surface_disabled` for every domain but `trust` — that is the bridge-side proof the
unit tests cannot give on this Mac.

#### 6e. Security model

- The bridge socket (`$TMPDIR/interceptor-bridge.sock`, per-user 0700 directory)
  **authenticates no caller**: anything running as Aaron can use every allowlisted
  domain with the bridge's grants. The allowlist is the control.
- The switch and allowlist are enforced in the Swift Router after every route is
  normalized, and again in the daemon and CLI. In browser-only mode no daemon
  launches a bridge.
- Sparkle auto-check is off. **Never press Install Update** — it installs the vendor
  build over this one.

#### 6f. Uninstall

```bash
interceptor surface browser-only
launchctl bootout "gui/$(id -u)/com.interceptor.bridge"
rm ~/Library/LaunchAgents/com.interceptor.bridge.plist
rm -rf ~/.local/share/interceptor/interceptor-bridge.app ~/.local/bin/interceptor-bridge
```

Then remove the `interceptor-bridge` rows from both Privacy & Security panes.

### 7. Extension reload and skills refresh

```bash
interceptor contexts                         # context id
interceptor reload --context <id>
interceptor diagnose | grep 'extension:'     # → unpacked extension <version> via ws
interceptor skills adopt --into claude --force   # relink the generated dist/skills
```

`reload` picks up rebuilt files in `extension/dist`. Only a changed manifest `key`
needs the card deleted and re-loaded by hand (the extension ID changes).

### 8. Verify

```bash
interceptor status                           # mode + daemon + bridge
interceptor open "https://example.com"       # tree + text from a background tab
```

`status` healthy does not prove the browser leg — the `open` round-trip does.

## Notes

- Native messaging manifest's `allowed_origins` is regenerated by `install.sh` —
  it allows the keyed `hkjbaciefhhgekldhncknbjkofbpenng`, which is **this fork's own**
  extension ID (`extension/manifest.json`'s `key`), not a stale dev copy.
- Force-push from upstream is normal — `Hacker-Valley-Media/Interceptor` rewrites main on releases
  (v0.5.0 → v0.8.0 was a single force-push touching 155 files).
- `extension/src/content/data/extract.ts` extract limits now default to
  200K/200K/50K (text/HTML/element) upstream — healthy, no patch needed. (An
  older note here described patching a 10K default to 10M; that default no longer
  exists. Only revisit if you hit truncation on very large pages.)
