---
name: VetRepo
description: Audit a locally-cloned third-party repo for safety BEFORE adopting it — malicious code, automatic-execution/install hooks, data exfiltration, obfuscation, third-party egress/integrations, dependency & secret risk. Produces an evidence-backed SAFE / SUSPICIOUS / DANGEROUS verdict with file:line citations, then (only if safe) explains how to consume the repo FROM THE LOCAL CLONE instead of `npm install` from a public registry. USE WHEN is this repo safe, audit this repo, vet this codebase, check for malware, is this skill/plugin/package safe to use, scan a cloned repo, should I trust this dependency, how do I use this repo locally instead of npm install. NOT FOR reviewing your own diff for bugs/quality (use /code-review or /simplify), NOT FOR a security review of code you're writing (use /security-review), NOT FOR license compliance.
---

# VetRepo

Decide whether a freshly-cloned third-party repo is safe to adopt, then — if it is — use it from the local clone instead of trusting a registry artifact.

**Two-step flow:** `Audit` first → get a verdict → if SAFE, `LocalUsage`.

## Core principle (read once)

**Static analysis only — never detonate.** Reading untrusted code is safe; *running* it is the threat. This skill never executes the target, never runs its install/build/test scripts, never `npm install`s it. The scariest code is the code that runs *before* you read anything — package lifecycle hooks — because `npm install` *is* execution. Surface those loudest.

## The 7 threat primitives (what "unsafe" reduces to)

All harm a repo can do reduces to these. The scanner detects each; the audit reasons over them. Full teaching: `References/ThreatModel.md`.

| | Primitive | The question it answers |
|---|-----------|------------------------|
| **A** | Automatic-execution surface | Does anything run at install/build/import, before I read it? |
| **B** | Dynamic / indirect execution | Does it eval/exec/spawn hidden or fetched code? |
| **C** | Egress / C2 | Does it phone home / exfiltrate / pull a 2nd stage? |
| **D** | Sensitive-resource access | Does it read secrets, keys, env, wallets, cookies? |
| **E** | Host mutation beyond scope | Does it write outside the repo / install persistence? |
| **F** | Obfuscation / evasion | Is anything hidden from a reader (base64/hex/packed)? |
| **G** | Inherited trust | Risky deps (unpinned/git/url), no lockfile, committed secrets? |

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| "audit / vet / is this repo safe / scan for malware" | `Workflows/Audit.md` |
| "how do I use this locally / verdict was safe, now what" | `Workflows/LocalUsage.md` |

## Quick reference — the scanner

```bash
# Human report, offline, ordered by threat primitive:
bun run ${NDEKO_DIR}/skills/VetRepo/Tools/Scan.ts <repo-path>

# Structured JSON for triage:
bun run ${NDEKO_DIR}/skills/VetRepo/Tools/Scan.ts <repo-path> --json | jq .

# Also run dependency vuln check (opt-in network, uses osv-scanner/npm audit if installed):
bun run ${NDEKO_DIR}/skills/VetRepo/Tools/Scan.ts <repo-path> --online

# Also scan vendored deps (node_modules/vendor) — off by default:
bun run ${NDEKO_DIR}/skills/VetRepo/Tools/Scan.ts <repo-path> --include-deps
```

The scanner gathers **evidence**, not a verdict. It emits findings tagged A–G with `path:line` and severity. The verdict is the model's job in `Audit.md`.

## Gotchas

- **The scanner does not run the target — keep it that way.** If you ever feel the urge to "just `npm install` to see what happens," stop. Installing *is* the attack. The audit is complete without ever executing the code.
- **A clean scan is not proof of safety, only absence of cheap signal.** Obfuscation defeats pattern-matching by design. A repo with heavy obfuscation (primitive F) should *lower* trust even if no payload is decoded — it flips the burden of proof. Say "no signal found" not "safe."
- **Lifecycle scripts (primitive A) outrank everything.** A `postinstall` that curls a script and pipes to bash is critical even if the rest of the repo is pristine. Read those first, always.
- **The registry artifact ≠ the repo.** A repo can look clean while the published npm/PyPI package ships extra files (or a different `postinstall`). That's *why* LocalUsage consumes from the clone, not the registry. Never tell the user to `npm install <name>` to use a repo they cloned to vet.
- **`--online` shells out** to `osv-scanner` or `npm audit` if present. That's the only network/subprocess the skill does, and only on that flag. Treat its results as advisory, not authoritative.
- **High false-positive tolerance by design.** The scanner over-reports (e.g. every `fetch` is flagged). The model's triage job is to separate "legitimate HTTP client" from "exfil to a hardcoded IP." Don't pass raw scanner output to the user as findings — triage first.
- **Empty/unknown ecosystem is valid.** A repo with no manifest still gets scanned for B–F patterns. Don't assume node.
