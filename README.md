# ndeko-os

A personal setup for [Claude Code](https://claude.com/claude-code) — the pieces that make an AI assistant work like it knows you, and prove what it says it did.

## In plain terms

Claude Code is Anthropic's AI assistant for real work: you talk to it in a terminal, and it reads files, writes code, runs commands, and does things on your behalf. Out of the box it is capable and completely generic. Every conversation starts from zero — it does not know who you are, what you are building, what you decided last week, or what you consider a good answer.

This repository is a layer of files that sits on top of it. Not a fork and not a replacement: the same tool, configured. You install it, and Claude Code starts behaving differently.

## Why bother, instead of just using Claude Code

Three things this adds that the tool does not do on its own.

**It knows what you are driving at.** Your role, how you like to work, what you are trying to get done this month, and what has been learned about your work across previous sessions — all of it loads at the start of every conversation. You stop re-explaining yourself. More usefully, the assistant can tell when a request does not actually serve what you are after, and say so.

**It has to show its work.** The expensive failure of an AI assistant is not being wrong — it is being *confidently* wrong, and you finding out later. "I fixed it" when nothing was fixed. "The page is live" when it was never deployed. This setup makes that harder by machine: certain claims are blocked outright unless there is evidence in the session that the assistant actually went and checked. It is not a promise to be careful. It is a gate that stops the message from being sent.

**It has an opinion about how work gets done.** Before starting anything substantial, write down what *done* looks like in terms a tool can actually test — then finish by testing them. That sounds obvious and almost nothing does it, which is why so much AI output looks finished and is not. Everything in here follows from that one habit.

Everything else the assistant needs — permissions, memory, running commands, editing files — already ships in Claude Code. This repository configures those. It does not rebuild them.

## Two folders, and why they are separate

The thing people usually get wrong when they share a setup like this is leaking themselves along with it. The fix here is structural rather than careful: there are two directories, and they never mix.

|  | **The machinery** | **You** |
|---|---|---|
| Where | this repository | a separate folder on your computer |
| Holds | how the assistant thinks and works | who you are, your goals, what it remembers |
| Personal content | none, ever | all of it |
| Shared publicly | yes — this is that repository | never leaves your machine |

Because the two are physically separate, *"is this safe to share?"* stops being a judgment call you make every time and becomes a question about which folder something is in. Three mechanisms keep it that way, and one of them will refuse to let a commit happen if personal content has drifted across the line.

That is also why a fresh install feels generic. You get the machinery; the second folder starts empty and is yours to fill.

## Who this was built for

One person, published because the *shape* of it is reusable — not because it is a product. It has a named principal, Aaron, and an assistant, Ndeko, who addresses him directly. Those names run through the prose and are meant to be replaced by yours; there is a guided setup that interviews you and writes your half.

There is no plugin registry, no versioned release, and no support. Read it, take what works, discard the rest. [`doctrine/philosophy.md`](doctrine/philosophy.md) records what was deliberately *cut* and why, which is usually the more useful half.

---

## The idea underneath

Every task is a move from a current state to the state someone actually wanted, and the hard part is knowing you arrived.

So the system is organized around claims that can be checked. Write down what *done* means as things a tool can test, then close each one on evidence. Without a way to check, there is no way to tell progress from motion — and no way to know when to stop. Most of what follows is that sentence, applied.

This repo installs as `~/.claude` through a symlink. It contains **no personal data** by design: identity, goals, and memory live in the separate machine-local folder described above, which never enters version control.

---

## Quick start

Three steps, in order. The second is the one people skip, and skipping it is why the harness feels empty.

```bash
# 1. Install — mounts this checkout at ~/.claude
git clone https://github.com/aaronlerch/ndeko-os.git ~/.ndeko-os
cd ~/.ndeko-os
./install.sh --check          # see the plan, change nothing
./install.sh                  # apply it

# 2. Add the launcher alias to your shell config
alias ndeko='bun ~/.claude/tools/ndeko.ts'

# 3. Populate your data tree — the harness ships with none
ndeko
> /NdekoInstall
```

`NdekoInstall` interviews you and writes `identity/principal.md`, `goals.md`, `config.toml`, `pacts.md`, and `privacy-denylist.txt` into `~/.config/ndeko-os`. Until you run it — or write those files yourself — the assistant has no idea who you are, and every reference to "Aaron" in the doctrine is describing someone else.

**Requirements:** [`bun`](https://bun.sh) (runtime for every hook and tool), the `claude` CLI, and optionally `codex` for the cross-vendor second look. A missing `bun` is a warning rather than a failure — the symlink is still correct, the hooks simply will not fire until it exists.

There is deliberately **no `bun install` step**. The harness is dependency-free at runtime, because a hook must be importable before anyone has run an install — a hook that cannot load is a gate that silently does not fire. Run `bun install` only if you want `bunx tsc --noEmit` to typecheck; the sole devDependencies are type definitions.

### Installer flags

| Flag | Effect |
|---|---|
| *(none)* | Install or repair. Idempotent. |
| `--check` / `-n` | Report what would change. Touches nothing. |
| `--force` | Proceed past the "backup path already exists" guard. |
| `--uninstall` | Remove the `~/.claude` symlink. Repo untouched. |

**What it guarantees.** It never deletes a real directory — an existing `~/.claude` that is a real directory gets moved to `~/.claude.backup-<timestamp>`. It refuses rather than guesses: a target that does not look like an ndeko-os checkout stops the script. It is idempotent. It derives the repo root from its own location, so the clone can live anywhere (`~/.ndeko-os` is convention, not a requirement). And it verifies *through the mount point* rather than the repo path, because that is the only probe that exercises the same path a real session does.

---

## For AI agents reading this repo

If you are an agent asked to understand, install, or operate this harness, read these four in order. Everything else is detail you can pull on demand.

| Read | For |
|---|---|
| [`dist/AGENTS.md`](dist/AGENTS.md) | **Start here.** A generated, self-contained rendering of the doctrine — constitutional rules, the algorithm, verification, self-healing — for tools that do not load Claude Code's config. Regenerate with `bun tools/agents-md.ts`; never hand-edit it. |
| [`system-prompt.md`](system-prompt.md) | The constitutional rules and the single output format. Five rules outrank everything else. |
| [`CLAUDE.md`](CLAUDE.md) | The routing table — where every other thing lives. |
| [`algorithm/`](algorithm/) | The loop, and the twelve completion claims with their teeth. |

Two conventions that will bite you if you miss them. **Paths in prose are `~/`-absolute on purpose**, because these files get read from inside other repos where a relative path resolves somewhere else entirely. And **no file outside `hooks/lib/paths.ts` may contain a config-root path literal** — `tools/PathGate.ts` enforces it, and an exception needs an explicit `path-gate-allow` pragma.

---

## The two trees

The specifics of the split described up top. The separation *is* the privacy enforcement — there is no scanning step that decides whether something is personal, only a rule about where it lives.

| | Harness — this repo | Data tree |
|---|---|---|
| **Path** | `~/.ndeko-os`, mounted at `~/.claude` | `~/.config/ndeko-os` |
| **Holds** | doctrine, hooks, skills, tools | identity, goals, memory, state, voice profiles |
| **Personal data** | none, ever | all of it |
| **Version control** | yes — clonable to any machine | never |
| **Located by** | self-location from `hooks/lib/paths.ts` | `NDEKO_DATA_DIR` |

The data tree sits deliberately *outside* the repo so that `git clean -xdf` cannot destroy memory. Voice profiles live there for the same reason plus a stronger one — they are reference recordings of real people's voices, exactly the category that must never reach a remote.

**Keeping the harness clean.** No employer or customer names, no internal repo or project names, no measured personal fingerprints, no financial figures, and no machine-specific absolute paths (`~/` is portable and fine; `/Users/<name>/` is not). Three mechanisms enforce it, in increasing order of finality:

1. **`.gitignore`** carries tripwires — `memory/`, `identity/`, `goals.md`, `state/`, `sessions/`, `skills/_*` — that catch anything data-shaped drifting in by accident.
2. **`PrivacyBoundary.hook.ts`** blocks a *write* carrying a denylisted term or a machine-specific home path before it lands.
3. **`tools/privacy-scan.ts`** blocks the *commit*. See below.

---

## Publishing, and staying clean

The write-time hook cannot see three things: content you wrote by hand, content already in the tree from before the hook existed, and whole-file properties like a committed binary. Git's index is where all three converge, so there is a gate there too.

```bash
bun tools/privacy-scan.ts --all       # audit every tracked file
bun tools/privacy-scan.ts --staged    # what a commit is about to record
```

Same code in both modes, deliberately — a release audit that had drifted weaker than the commit gate would still read as a pass. It checks denylisted terms, structural shapes (home paths, key blocks), credential patterns, binary content, a 256 KB size ceiling, and a forbidden-path list.

`install.sh` wires it as a pre-commit hook by setting `core.hooksPath` to the tracked `hooks/git/` directory. `.git/hooks/` is deliberately not used: it is per-clone, so a hook installed there protects exactly one machine and silently protects nothing on a fresh clone.

| | |
|---|---|
| **Bypass a commit** | `git commit --no-verify` |
| **Exempt a line** | `privacy-gate:allow` on the line or the one above it |

The exemption covers structural and credential patterns only — those describe a *shape*, and a test suite legitimately needs to write the shape down. **Denylisted terms are never exemptible.** A shape is safe to write; an identity is not.

**The denylist lives in the data tree** (`privacy-denylist.txt`), never in this repo — putting employer and customer names into the repo they must stay out of is the exact failure the gate exists to prevent. On a fresh clone with no data tree, term checks are skipped and the gap is printed loudly; the structural, path, binary and size checks still run.

---

## What's in here

### Doctrine — the part that isn't in the harness underneath

| File | Role |
|---|---|
| `system-prompt.md` | **Constitutional rules.** Loaded as the `ndeko` output style — `output-styles/ndeko.md` links to it, `settings.json` selects it — so sessions Remote Control starts carry it too. `/context` does not count output-style text under System prompt; that is expected. Five rules outrank everything: verification, analysis-means-read-only, billing path, security protocol, privacy boundary. Also carries the single output format. |
| `CLAUDE.md` | **The routing table.** Auto-loaded by Claude Code. Deliberately thin — a lookup index plus operational rules, each one a tool contract or a dated verified gotcha. |
| `assistant.md` | **Voice and personality.** `@`-imported by `CLAUDE.md`. Method only — the standing pacts are disclosures about the principal and live in the data tree. Includes a standing constraint that this voice stay *different* from his, because a mirrored voice shares his blind spots and makes anything drafted in his name untraceable. |
| `algorithm/LATEST` → `algorithm/v1.0.0.md` | **The loop.** Twelve completion claims, each carrying either `HOOK` (blocked mechanically) or `CHECK` (executed and recorded). No phases, no effort tiers, no mode to declare, and no self-attestation tier — see *Design commitments*. |
| `doctrine/verification.md` | The seven incident-derived verification rules, each dated. Loaded on demand. |
| `doctrine/self-healing.md` | Where a new rule belongs. Opens by insisting you name the diagnosis first: "the system failed" and "I failed" are different, and only the first takes a patch. |
| `doctrine/philosophy.md` | Why the system is shaped this way — and what was deliberately cut, so a future session doesn't rebuild it and call that progress. |

### `hooks/` — the mechanical gates

Hooks are reserved for exactly two things: **a checkable property of an artifact**, and **a gate on an irreversible act**. A hook must never encode *how I work* — a model reading its own doctrine makes such a hook pointless.

| Hook | Event | What it does |
|---|---|---|
| `BillingGuard` | SessionStart | Asserts the session runs on the OAuth subscription, not a metered API key. Honest about its limit: SessionStart cannot block, so this makes the problem loud rather than preventing it. Real enforcement is `permissions.deny` plus the launcher stripping carrier vars. |
| `Taint` | PreToolUse + PostToolUse | One bit per session recording that untrusted content was ingested — set by the tools that ingest it, read by the tool gate afterwards. Converts "treat this as data" from in-band advice into out-of-band state, because adaptive attacks beat in-band defenses 71–100% of the time. |
| `CatastrophicGuard` | PreToolUse (Bash) | Catches catastrophic shell shapes that prefix-matching permission rules structurally cannot see — the danger lives mid-command, behind a legitimate head like `bash`, `find`, or `psql`. |
| `PrivacyBoundary` | PreToolUse (writes) | Blocks a write into this tree carrying a denylisted term or a machine-specific home path. |
| `MemoryProvenance` | PostToolUse (writes) | Stamps provenance on every memory file. Native memory has an index and consolidation but no record of *where a claim came from* — and a learning from a verified run is not the same trust tier as one from a fetched page. |
| `MemoryReconcile` | SessionStart | Reconciles the memory index against what is actually on disk. |
| `Toolbelt` | SessionStart | Reports per-repo tool availability (e.g. whether `ast-grep` is on `PATH`) so the session picks the right search tool instead of assuming. |
| `VerificationGate` | Stop | The teeth behind the verification claim. Blocks a done-claim that has no tool evidence of the right modality. |
| `JevShadow` | Stop | Log-only. Asks TypeSafe's Jev model the gate's claim question, and the skill-routing question for each turn, and logs its answers beside the transcript's ground truth. Detached, so it adds no latency. Off unless `[typesafe] shadow = true` in the data tree's `config.toml`. `bun tools/jev.ts backfill\|report` evaluates. |

`hooks/lib/` holds the shared library: `paths.ts` (below), `hook-input.ts`, `hook-io.ts`, `transcript-evidence.ts`, `memory-records.ts`, and `catastrophic-shapes.ts`. Tests live beside the code — **224 across three files**: `hooks/hooks.test.ts`, `hooks/lib/catastrophic-shapes.test.ts`, `tools/privacy-scan.test.ts`.

### `hooks/lib/paths.ts` — the single path authority

Worth its own section, because it is the reason a rename is cheap.

The harness root is **derived from this module's own location**. The file always lives at `<root>/hooks/lib/paths.ts`, so `../..` from there *is* the root — no literal to go stale, no env var required. The predecessor system had three competing path mechanisms and ~25 hardcoded `.claude` literals across 11 files; under a renamed root those kept resolving to the *old* tree and wrote there silently. One hook imported a correct helper *and* hand-wrote three paths, so it wrote to two trees simultaneously.

**The rule:** no other file in this tree may contain a config-root path literal. `tools/PathGate.ts` enforces it. Proven in practice — a full rename of this tree moved every hook, test and tool without one path helper changing.

### `skills/` — curated capability

**23 public skills**, each a `SKILL.md` plus optional `Workflows/`, `Tools/`, and `References/`. A further **6 prefixed with `_` are private**: they encode customer or employer specifics, load normally on the owner's machine, and are gitignored so a fresh clone gets the harness without them. That leading underscore is the public/private boundary throughout the repo.

Roughly grouped:

- **Thinking** — `FirstPrinciples`, `SystemsThinking`, `RootCauseAnalysis`, `Science`, `RedTeam`, `IterativeDepth`
- **Verification & safety** — `Interceptor` (real-Chrome browser automation; mandatory for any visual claim), `VetRepo`, `Infrastructure`
- **Integrations** — `GoogleWorkspace`, `McpShim`, `Research`
- **Authoring** — `Writing` — drafts in a measured voice, per channel, with a deterministic `VoiceCheck`. The method ships here; every measurement loads from the data tree.
- **Media** — `Say`, `VoiceClone`, `ChatterboxTTS`, `AudioEditor`, `Remotion`
- **Meta** — `BitterPillEngineering` (audits instruction sets for over-prompting), `NdekoInstall` (interviews a new user and writes their data tree), `ISA`, `ApertureOscillation`, `PrivateInvestigator`

Skills reference their own files through `${NDEKO_DIR}`, which `settings.json` sets to `$HOME/.claude`.

### `agents/` — the second look

One agent: **`Forge`**. A cross-vendor reviewer running on OpenAI lineage via the `codex` CLI. It exists because of two measured facts — a builder cannot review its own build (the capability largely disappears on its own generation), and a judge favors its own family by 10–25%. It is explicitly **never a fork**, because a forked subagent inherits the build context and defends its own code.

### `tools/`

| Tool | Purpose |
|---|---|
| `ndeko.ts` | **The launcher.** Runs a session against this tree — or `ndeko rc`, Remote Control with worktree spawning, `auto` permissions, and a `<host>-<repo>` session-name prefix — and strips `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` before spawn. Refuses to pass `--bare` at all. |
| `privacy-scan.ts` | The publish gate. `--staged` for the pre-commit hook, `--all` for a pre-release audit. |
| `PathGate.ts` | The build gate for the path invariant. A script rather than a grep, because a naive `rg` flags comments and prose — and a gate with a high false-positive rate is a gate people route around. |
| `agents-md.ts` | Regenerates `dist/AGENTS.md` from the doctrine sources. |
| `memory.ts` | Memory retirement — supersede, archive, status. |
| `BillingPathAssertion.ts` | Out-of-band verification that a real session is on the subscription carrier. |
| `models.ts` | Model registry and drift scanner. |
| `statusline.sh` | Status line renderer, wired via `settings.json` → `statusLine`. |
| `chatterbox/` | Voice-clone + TTS CLI behind the `Say`, `VoiceClone`, and `ChatterboxTTS` skills. Source is tracked; the ~1.3G venv is generated by `setup.sh` on first run and gitignored. Profiles are **not** here — they are recordings of real people and live in the data tree. |

### `evals/`

**Eight cases, eighteen graders**, mined from the two failure classes that survived a falsification pass over the predecessor system's failure corpus. A case is a directory: `prompt.md` plus a `graders/` folder.

**None of them has been run.** `claude plugin eval` is early access and not enabled on this account — a gate on the org, not an oversight. It is stated up front because an eval suite reporting no results looks identical to one that passed. See [`evals/README.md`](evals/README.md) for the verification of that claim.

---

## How it fits together

**Load order at session start:**

1. `CLAUDE.md` — auto-loaded from the config dir, pulls in `assistant.md` via `@`
2. `system-prompt.md` — the `ndeko` output style, selected in `settings.json`
3. `settings.json` — env, permissions, hooks, `autoMode` policy
4. Data tree — identity, goals, memory (activated once populated)
5. Skills and agents — discovered from `skills/` and `agents/`, loaded on demand

**Path resolution:** `CLAUDE_CONFIG_DIR` if set, else self-location from `paths.ts`. Data root: `NDEKO_DATA_DIR` if set, else the first existing fallback (`~/.config/ndeko-os`), else the canonical default. Both accept a leading `~` or `$HOME`; nothing else is expanded.

**Why hook commands say `$HOME/.claude` and not `$HOME/.ndeko-os`.** Hook commands are strings the harness executes, not TypeScript, so they cannot route through `paths.ts`. `$CLAUDE_PROJECT_DIR` is the *working* directory, not the config directory — wrong variable. So this is the one place a literal is unavoidable, and `$HOME/.claude` is the right literal: it is the install contract, identical on every machine, and it fails **loudly** if wrong (the hook does not exist and the harness says so) rather than silently like the predecessor's 25.

---

## Using it

```bash
ndeko                    # session against this tree
ndeko -n                 # print the composed argv and exit
ndeko --flags            # compose from explicit flags instead of CLAUDE_CONFIG_DIR
ndeko -D <channel>       # attach a local dev MCP channel
```

Everything not consumed by the launcher is forwarded to `claude` verbatim, so `-w`, `--tmux`, `-r`, and `-c` work as normal.

### Verifying the install

```bash
cd ~/.claude
bun hooks/lib/paths.ts          # both roots + the algorithm file resolve
bun tools/PathGate.ts           # zero hardcoded config-root literals
bun tools/privacy-scan.ts --all # tracked tree carries nothing personal
bunx tsc --noEmit               # types
bun test                        # 224 tests
./install.sh --check            # re-check the mount without changing anything
```

`./install.sh` runs the first three itself as part of its verify step. Then start a real session and confirm the hooks fire — a passing test suite is not evidence that a hook is *wired*.

---

## Design commitments

These are load-bearing, and `doctrine/philosophy.md` records the evidence for each.

**Two things here are not in the harness underneath:** a durable sense of what the principal is driving at (`goals.md`, `identity/`), and an opinionated way to run work against it (`algorithm/`). Everything else is configuration, curated capability, and gates. Permissions, memory, observability, checkpointing, and hook lifecycle all ship in Claude Code — this repo configures them, it does not reimplement them. Check any proposed addition against that list first.

**No self-attestation.** Claims carry `HOOK` or `CHECK` teeth, and nothing else. The predecessor had a third tier for things the model asserts about its own conduct; its own disk measured the result — hundreds of captured failures produced a single distillation, and an open-coding pass over the corpus later found that a large share of those captures were artifacts rather than failures at all, the biggest class refuted by its own transcripts. Two items that would otherwise be claims (spend calibration, frame drift) live in `system-prompt.md` as *guidance* instead. Guidance that might be missed is honest; a claim graded by its own author is theater.

**State the outcome, not the procedure.** Every prompt here — skill, agent brief, delegated task — states what done looks like as testable outcomes, names constraints, hands over good tools, then trusts the model to find how. Scripting execution steps caps a capable model below its ability and rots as models improve. Four classes of "how" are exempt and never cut: safety gates, verified gotchas *(which require dated provenance, or they are just methodology wearing a badge)*, tool contracts, and output-format contracts.

The test for any procedural line: **would a smarter model make this unnecessary?** Yes means cut it.

**Fix the system, not the symptom** — but only when the system actually failed. If a rule was already encoded, already loaded, and simply not consulted, the correct remediation is *nothing*. Getting caught creates pressure to produce a visible artifact as proof of remediation, and a hook is the most legible artifact available. Resist that: every unnecessary rule competes for attention with the rules that matter.

---

## Repo map

```
ndeko-os/
├── install.sh              mount this checkout as ~/.claude; wires the git hook
├── README.md               this file
├── dist/AGENTS.md          generated portable doctrine — the agent entry point
├── CLAUDE.md               routing table (auto-loaded)
├── system-prompt.md        constitutional rules (the ndeko output style)
├── output-styles/ndeko.md  symlink → system-prompt.md
├── assistant.md            voice and personality (@-imported)
├── settings.json           env · permissions · hooks · autoMode policy
├── algorithm/              LATEST → v1.0.0.md — the loop and its 12 claims
├── doctrine/               verification · self-healing · philosophy (on demand)
├── hooks/                  8 gates + lib/ + tests
│   ├── git/pre-commit      the publish gate, via core.hooksPath
│   └── lib/paths.ts        THE path authority — everything else routes here
├── skills/                 23 public + 6 private (gitignored)
├── agents/Forge.md         cross-vendor second look
├── tools/                  launcher · privacy-scan · PathGate · memory · statusline
├── evals/                  8 cases, 18 graders, never run
└── docs/                   research and failure analysis (dated 2026-08, not maintained)
```

Runtime state — `projects/`, `sessions/`, `history.jsonl`, `tasks/`, `session-env/`, `file-history/`, `cache/` — is written into the config dir by Claude Code and fully gitignored. A clean `git status` in this tree during normal operation is the intended state, and any drift from it is a `.gitignore` bug.
