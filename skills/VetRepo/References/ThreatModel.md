# ThreatModel — what "unsafe" reduces to

Loaded on demand during `Audit.md` triage. Derived from first principles: a repo can only harm an adopter through a bounded set of machine capabilities. There are exactly seven irreducible primitives. The scanner detects each (tagged A–G); this file teaches how to tell benign from hostile.

> **Foundational asymmetry:** reading code is safe; *running* it is the threat. The most dangerous code is the code that runs *before* you read anything — install hooks, import-time side effects. That is why primitive **A** outranks all others.

---

## A — Automatic-execution surface  *(highest priority)*

**Mechanism:** code that runs without the adopter explicitly invoking it.
- npm lifecycle scripts: `preinstall`, `install`, `postinstall`, `prepare`, `preprepare`, `postprepare`. `npm install` / `bun install` runs these. This is the #1 real-world supply-chain vector.
- python: top-level statements in `setup.py`, build hooks in `pyproject.toml`, `conftest.py` at root (runs on `pytest`).
- `Makefile`/`justfile` install targets that fetch and run.
- import-time side effects (module top-level code that executes on first `import`/`require`).

**Benign:** `postinstall` that compiles native bindings or runs a local in-repo build script.
**Hostile:** `postinstall` that `curl`s a remote script and pipes to `sh`; `node -e` with an encoded payload; a "build" that downloads a binary from a non-obvious host.
**Tell:** does the script reach the network, decode something, or touch files outside the repo? Read the script body, not just its name.

## B — Dynamic / indirect execution

**Mechanism:** the engine that runs hidden or fetched code.
- JS/TS: `eval(`, `new Function(`, `child_process`, `exec(`, `execSync(`, `spawn(`, `vm.runIn*`, `process.binding`.
- python: `exec(`, `eval(`, `os.system(`, `subprocess.*`, `pty.spawn`, `__import__(`, `compile(`.
- shell: `curl … | sh`, `| bash`.

**Benign:** a template engine, a sandboxed plugin loader, a CLI shelling out to a tool it documents.
**Hostile:** `eval`/`Function` fed a *decoded or concatenated* string (pairs with F); `exec` of a freshly-downloaded file (pairs with C).
**Tell:** is the argument a literal you can read, or assembled/decoded at runtime?

## C — Egress / C2 (network)

**Mechanism:** the channel for exfiltration and second-stage payloads.
- JS/TS: `fetch(`, `axios`, `http(s).request/get`, `net.connect`, `WebSocket`, `dgram`, `dns.`.
- python: `requests`, `urllib`, `httpx`, `socket`, `http.client`.
- shell: `curl`, `wget`, `nc`, `scp`.
- hardcoded URLs, IPv4 literals, and known sinks: `webhook.site`, `pastebin`, Discord webhooks, Telegram bot API, `ngrok`, raw `*.workers.dev` POSTs.

**Benign:** a documented API base URL; opt-out telemetry.
**Hostile:** a hardcoded IP or throwaway-domain sink; a request whose body is environment variables or file contents.
**Tell:** *what* is being sent, and *where*. Egress + D (secret read) in the same module is the malware signature.

## D — Sensitive-resource access

**Mechanism:** the thing worth stealing.
- env harvesting: `Object.keys(process.env)`, `{...process.env}`, `os.environ` copy.
- credential/identity paths: `~/.ssh`, `id_rsa`, `~/.aws/credentials`, `.npmrc`, `.git-credentials`, `.netrc`, keychain (`security find-generic-password`), `~/.config/gcloud`, `~/.kube/config`, `~/.docker/config.json`.
- browser/crypto theft: browser `Login Data`/`Cookies` sqlite, `wallet.dat`, keystores, MetaMask/extension storage.
- `/etc/passwd`, `/etc/shadow`.

**Benign:** reading one specific env var the tool documents; reading its own in-repo config.
**Hostile:** enumerating *all* env vars; reading credential stores it has no functional reason to touch.
**Tell:** scope. Targeted + documented = fine. Broad + undocumented = exfil prep.

## E — Host mutation beyond scope

**Mechanism:** persistence and destruction.
- writes outside the repo: `~/.bashrc`/`~/.zshrc`/`~/.profile`, `crontab`, `launchctl`/launchd plists, systemd units, `/etc`, startup folders, appending to ssh `authorized_keys`.
- `chmod +x` then run.

**Benign:** writing to an XDG cache/config dir the tool owns.
**Hostile:** editing shell rc files, installing a scheduled job, planting an ssh key.
**Tell:** does it write where it lives (repo/cache) or where it persists (login scripts, schedulers)?

## F — Obfuscation / evasion  *(burden-flipping meta-signal)*

**Mechanism:** hiding A–E from a reader. Not harmful by itself — but benign open source has almost no reason to ship encoded executable content in *source*.
- long base64 blobs (esp. passed to `atob`/`Buffer.from(…,'base64')`/`base64 -d`).
- long hex blobs, `\x..` escape runs, `String.fromCharCode(` chains, `\u00..` runs.
- minified single-line files shipped as *source* (not under `dist/`/`build/`).
- `eval`/`Function` fed decoded/concatenated strings.

**Benign:** a minified asset under `dist/`; a legitimately encoded binary resource with a clear purpose.
**Hostile:** any of the above in hand-written source paths, especially feeding B.
**Rule:** heavy obfuscation **caps the verdict at SUSPICIOUS** even if nothing decodes to a payload. You can't clear what you can't read. Say "no signal found," never "safe."

## G — Inherited trust (dependencies + committed secrets)

**Mechanism:** the harm may live in what the repo *pulls*, not the repo itself; and the repo may *leak* secrets.
- deps: unpinned (`*`, broad ranges), `git+`/url deps, `file:` deps, typosquatted names, **missing lockfile**. python `requirements.txt` without `==`; go `replace`/git deps; Cargo git deps.
- committed secrets: `.env`/`.env.*` files, key material (`-----BEGIN … PRIVATE KEY-----`), tokens (`AKIA…`, `ghp_…`, `xox[baprs]-…`, `sk-…`, `AIza…`), high-entropy strings. **Report path:line; never echo the value.**
- (`--online`) optional `osv-scanner` / `npm audit` advisory for known-CVE deps.

**Benign:** pinned deps + lockfile + well-known packages.
**Hostile:** unpinned dep on an obscure/typosquat name, git dep to a personal fork, a committed live credential.
**Tell:** can you reproduce the exact dependency set, and do you recognize the names?

---

## Verdict composition

| Verdict | Composition |
|---------|-------------|
| 🟢 **SAFE** | No hostile pattern after triage; egress/exec explained by function; deps reproducible. At most low-severity hygiene. |
| 🟡 **SUSPICIOUS** | Obfuscation present, OR broad-undocumented D, OR undocumented C, OR risky G, OR thin provenance — without a confirmed payload. Heavy F always lands here at best. |
| 🔴 **DANGEROUS** | A confirmed chain: **A/B + remote fetch**, or **D + C** (secret read → egress), or **F decoding to B**, or destructive **E**. |

**The two killer pairings to look for first:** D+C (read secrets, send them out) and A/B+F (auto/dynamic exec of obfuscated content). Find either and the verdict is DANGEROUS until disproven.
