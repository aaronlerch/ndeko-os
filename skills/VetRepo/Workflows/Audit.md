# Audit Workflow

Decide whether a cloned third-party repo is safe to adopt. Output: an evidence-backed verdict — **SAFE / SUSPICIOUS / DANGEROUS** — with a recommendation to **use / reject / report**.

## Step 0 — Locate the repo, confirm it is a clone (not yet installed)

- Get the absolute path. Confirm it exists and is a directory.
- `git -C <repo> remote -v` and `git -C <repo> log --oneline -5` — note the origin and recency. A repo with one giant commit, no history, or an origin that doesn't match where the user "heard about it" is a yellow flag (not a verdict).
- **Do NOT run `npm install`, `pip install`, `make`, build, or test.** If `node_modules/` already exists, note it — the user may have already installed (meaning lifecycle scripts already ran). Flag that prominently.

## Step 1 — Run the scanner (gather evidence)

```bash
bun run ${NDEKO_DIR}/skills/VetRepo/Tools/Scan.ts <repo-path> --json > /tmp/vetrepo-scan.json
bun run ${NDEKO_DIR}/skills/VetRepo/Tools/Scan.ts <repo-path>        # human view alongside
```

Optionally `--online` for a dependency vuln advisory (osv-scanner / npm audit), and `--include-deps` if the repo vendors dependencies you want covered.

The scanner emits findings tagged by the 7 primitives (A–G) with `path:line`. It over-reports by design — your job is triage, not transcription.

## Step 2 — Triage each primitive (model judgment)

Read the actual files behind the findings. For each primitive, decide: **benign / suspicious / malicious**, and cite `file:line`. Reason like an attacker and a skeptic — see `References/ThreatModel.md` for what each primitive means and the tells that separate benign from hostile.

| Primitive | Benign looks like | Malicious looks like |
|-----------|-------------------|----------------------|
| **A** automatic-execution | `postinstall` runs a local build script in-repo | `postinstall` curls a remote script and pipes to `sh`; `node -e` with encoded payload |
| **B** dynamic execution | a sandboxed plugin loader, a template engine | `eval`/`Function` fed a decoded/concatenated string; `exec` of a downloaded file |
| **C** egress | documented API base URL, telemetry you can opt out of | hardcoded IP, webhook.site/pastebin/discord/ngrok sink, exfil after reading env |
| **D** sensitive access | reads its own config in repo | enumerates all `process.env`, reads `~/.ssh`, `.aws/credentials`, browser cookies, wallets |
| **E** host mutation | writes to a cache dir under the repo/XDG | appends to `~/.zshrc`, installs a cron/launchd job, writes ssh `authorized_keys` |
| **F** obfuscation | minified file under `dist/`/`build/` | base64/hex blob in *source*, char-code assembly, packed code shipped as source |
| **G** inherited trust | pinned deps + lockfile, well-known packages | unpinned `*`, `git+`/url deps, typosquat names, committed `.env`/keys, no lockfile |

**The combination that = malware:** D (read secrets/env) + C (egress to a non-obvious endpoint) in the same module, or A/B (auto/dynamic exec) + F (obfuscation). Either pairing is DANGEROUS until proven otherwise.

## Step 3 — Render the verdict

| Verdict | Criteria |
|---------|----------|
| **🟢 SAFE** | No malicious pattern after triage. Egress/exec all explained by legitimate function. Deps reasonable. At most low-severity hygiene issues. → proceed to `LocalUsage.md`. |
| **🟡 SUSPICIOUS** | Real ambiguity: obfuscation present, broad env access, undocumented egress, risky deps, or thin/odd provenance — but no confirmed payload. → do not adopt yet; list exactly what to inspect or what would clear it. |
| **🔴 DANGEROUS** | A confirmed hostile pattern: install-time remote-code-exec, secret-harvest-then-exfil, obfuscated payload that decodes to exec, destructive host mutation. → reject; consider reporting. |

A clean scan is "no signal found," not "proven safe" — say so. Heavy obfuscation caps the best achievable verdict at SUSPICIOUS regardless of what decoded.

## Step 4 — Report (template)

```markdown
## VetRepo Audit — <repo name>
**Verdict: 🟢/🟡/🔴 <SAFE|SUSPICIOUS|DANGEROUS>**
**Recommendation: <use locally | reject | reject + report>**

Repo: <path> · origin: <git remote> · ecosystems: <node/python/...> · already-installed: <yes/no>

### Findings (by threat primitive)
- **A — automatic execution:** <verdict + file:line evidence, or "none">
- **B — dynamic execution:** <…>
- **C — egress / C2:** <…>
- **D — sensitive access:** <…>
- **E — host mutation:** <…>
- **F — obfuscation:** <…>
- **G — inherited trust (deps/secrets):** <…>

### Why this verdict
<2–4 sentences tying the evidence to the verdict. Name the single most important finding.>

### If you proceed
<for SAFE: "→ run LocalUsage workflow"; for SUSPICIOUS: exactly what to inspect/clear; for DANGEROUS: how/where to report — npm security, GitHub advisory, the registry's abuse contact.>
```

## Rules

- **Every reported finding cites `file:line`.** No "it seems to" — point at the line.
- **Never recommend running the target's scripts** as part of vetting. Static only.
- **Triage before reporting.** Raw scanner output is evidence, not findings. Don't dump it on the user.
- **When provenance is thin and signal is ambiguous, round down,** not up. SUSPICIOUS is a fine answer.
