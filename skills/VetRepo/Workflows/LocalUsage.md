# LocalUsage Workflow

How to consume a repo **from the local clone you just vetted** — not from `npm install <name>` / PyPI / a registry. This fires only after `Audit.md` returned **SAFE** (or SUSPICIOUS that the user explicitly accepts).

The point: the registry artifact can differ from the source you read. You vetted the *clone*. So run the *clone*.

## Gate

> **Do not run this if the verdict was DANGEROUS, or SUSPICIOUS without the user explicitly accepting the risk.** Confirm the verdict first.

## Step 1 — Classify what kind of thing it is

Look at the repo to decide consumption mode:
- **A Claude skill / plugin** (has `SKILL.md`, or a `.claude-plugin/` / `plugin.json`)
- **A library/package** meant to be imported (has `package.json` `main`/`exports`, or `pyproject.toml`, etc.)
- **A CLI / app** meant to be run (has a `bin` entry, a `main()`, a Dockerfile, a `cmd/`)

## Step 2 — Wire it up locally (by ecosystem)

### Claude skill
```bash
# Copy the vetted skill into your skills dir (rename to TitleCase or _ALLCAPS per convention):
cp -R <repo> ${NDEKO_DIR}/skills/<SkillName>
# Then read its SKILL.md frontmatter; it self-activates on triggers. Verify with /<skillname> or a trigger phrase.
```
Prefer copy over symlink so a later upstream change can't silently alter what you vetted. Re-vet before pulling updates.

### Claude plugin
```bash
# If it ships a marketplace manifest, add the LOCAL path (not a remote marketplace):
claude plugin marketplace add <repo>      # local directory path
claude plugin install <name>@<local-marketplace>
# Or for a bare local plugin dir, point your plugin config at the local path.
```

### Node / TypeScript (bun-first)
Pick by use case — all consume the clone, none hit the registry:
```bash
# 1. file: dependency (most reproducible — pins to the local path in package.json):
#    in your project's package.json:  "dependencies": { "<pkg>": "file:../path/to/<repo>" }
bun add file:../path/to/<repo>          # bun
npm install ../path/to/<repo>           # npm equivalent, installs from local dir

# 2. link (good for active development against the clone):
cd <repo> && bun link                   # register the clone
cd <your-project> && bun link <pkg>     # consume it
#    (npm: `npm link` in repo, then `npm link <pkg>` in project)

# 3. tarball (closest to "what a publish would ship" — and you can re-inspect it):
cd <repo> && npm pack                    # produces <pkg>-<version>.tgz from the repo
tar -tzf <pkg>-<version>.tgz             # INSPECT the file list — does it match the repo?
cd <your-project> && bun add ../path/to/<pkg>-<version>.tgz

# 4. build from source if it has a build step:
cd <repo> && cat package.json           # read the scripts FIRST (you already vetted them)
bun install && bun run build            # only now, having vetted, build it
```
> Re-confirm lifecycle scripts before any `install`/`build` — `bun install`/`npm install` run them. You vetted them in the audit; this is the moment they execute.

### Python
```bash
# editable install from the local clone (dev):
pip install -e /path/to/<repo>
# or a plain local install (no registry):
pip install /path/to/<repo>
# uv equivalent:
uv pip install -e /path/to/<repo>
```

### Go
```bash
# add a replace directive so your module uses the LOCAL clone, not the proxy:
go mod edit -replace github.com/<owner>/<repo>=/path/to/<repo>
go mod tidy
```

### Rust
```toml
# in your Cargo.toml — path dependency, not crates.io:
[dependencies]
<crate> = { path = "../path/to/<repo>" }
```

### Ruby
```ruby
# in your Gemfile — local path, not rubygems:
gem "<name>", path: "/path/to/<repo>"
```

## Step 3 — Tell the user the trade-off

State plainly:
- **What they gain:** they run exactly the bytes they vetted; no registry substitution; easy to re-inspect and modify.
- **What they lose:** no automatic version updates — they own re-vetting before pulling upstream changes (`git pull` then re-run `Audit`).
- **The recurring rule:** any `install`/`build` step runs the lifecycle scripts you vetted. Re-vet after every upstream pull, because a future commit can add a `postinstall` that wasn't there when you cleared it.

## Rules

- **Never default to `npm install <name>` / `pip install <name>` from the registry** for a repo the user cloned to vet. That throws away the vetting.
- Prefer `file:`/path deps and tarball-with-inspection over global `link` when reproducibility matters; prefer `link` for active development.
- Copy, don't symlink, vetted skills — so upstream can't silently change what you approved.
