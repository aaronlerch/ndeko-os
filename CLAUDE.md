# ndeko

Constitutional rules, the response format, verification doctrine, security protocol, and the billing constraint all live in the system prompt (`~/.claude/system-prompt.md`, loaded as the `ndeko` output style: `output-styles/ndeko.md` links to it and `settings.json` selects it, so every session gets it, including ones Remote Control starts). **When this file and the system prompt disagree, the system prompt wins.**

This file is the routing table. Everything below is on-demand lookup.

@~/.claude/assistant.md

<!-- Identity, goals, and the standing pacts live in the data tree. Each is listed
     here rather than nested inside assistant.md: transitive imports are supported
     to four hops, but keeping every personal import at depth 1 means none of them
     depends on that. Paths are `~/`-absolute because a relative import resolves
     against the file containing it, which breaks when the mount point moves. -->
@~/.config/ndeko-os/identity/principal.md
@~/.config/ndeko-os/identity/voice.md
@~/.config/ndeko-os/identity/pacts.md
@~/.config/ndeko-os/goals.md

## Where things are

Paths are `~/`-absolute so they resolve from any working directory — these files are read on demand from inside other repos, where a relative path means something else entirely.

| Topic | Path |
|---|---|
| Constitutional rules | `~/.claude/system-prompt.md` |
| Algorithm doctrine | `~/.claude/algorithm/LATEST` → `~/.claude/algorithm/v{VERSION}.md` |
| Verification rules (7, incident-derived) | `~/.claude/doctrine/verification.md` |
| Where a new rule belongs | `~/.claude/doctrine/self-healing.md` |
| Writing any agent-facing document | `~/.claude/doctrine/authoring.md` |
| Skill mechanics — invocation, routers, naming | `~/.claude/doctrine/authoring-mechanics.md` |
| Why the system is shaped this way | `~/.claude/doctrine/philosophy.md` |
| Path resolution — the single authority | `~/.claude/hooks/lib/paths.ts` |
| Hooks | `~/.claude/hooks/*.hook.ts`, wired in `~/.claude/settings.json` → `hooks` |
| Skills | `~/.claude/skills/*/SKILL.md` |
| Second-look agents | `~/.claude/agents/` |
| Launcher | `~/.claude/tools/ndeko.ts` |
| Memory retirement — supersede, archive, status | `~/.claude/tools/memory.ts` |
| Portable doctrine artifact (generated) | `~/.claude/AGENTS.md` ← `bun ~/.claude/tools/agents-md.ts` |
| Eval cases | `~/.claude/evals/` |
| Research the system was designed from (dated 2026-08, not maintained) | `~/.claude/docs/` |

Personal content — identity, voice, goals, memory — lives in the data tree at `$NDEKO_DATA_DIR` (default `~/.config/ndeko-os`). **Nothing personal belongs in this repo.**

## Operational rules

Kept because each is a tool contract or a dated, verified gotcha. Anything a capable model would do anyway has been cut.

- **bun / bunx always.** Never npm / npx.
- **Markdown over HTML** for anything markdown supports. Never XML tags in prompts — use headers.
- **`Authorization: Bearer` header, never a token in a URL.** URLs leak to access logs, history, referrers, and CDN logs.
- **"Create a plan" means present and stop.** No execution without approval.
- **Build over ask for reversible actions.** Editing a file or running a test: just do it. Reserve questions for irreversible or high-impact calls.
- **Document and communicate your decisions.** Decisions made autonomously are documented and communicated.
- **Code comments are claims, not evidence.** Never conclude from a comment alone — read the path it describes. Highest risk is a comment describing a migration in progress: cutovers complete, the comment does not get updated, and it reads as authoritative because it is specific. Grep for the thing it names and let the tree decide.
- **Structural code queries go to `ast-grep`, textual ones to `rg`.** Not substitutes: ast-grep matches syntax trees per language, `rg` matches bytes. Every call site of a symbol, every function or JSX node of a given shape, any codemod → `ast-grep run -p '<pattern>' -l ts`, and `--rewrite` for the edit rather than `sed`. Literal strings, logs, config, prose, mixed or unknown-language trees → `rg`, which is far faster there. Spell it `ast-grep`, never the `sg` alias — only `ast-grep` is in `permissions.allow`, and `sg` is a setgid utility on non-macOS boxes. Per-repo availability arrives from `Toolbelt.hook.ts` at session start; with no such line, assume `rg`. **Zero matches usually means a malformed pattern, not absent code** — the pattern must be a complete node, so a TS declaration needs its return type (`export function $NAME($$$): $RET { $$$ }`, not `export function $NAME($$$)`). Empty output fails in the quiet direction exactly like the binary-file case below, so confirm a new pattern against a known hit before trusting an empty result. *(2026-08-25)*
- **If `rg` reports "binary file matches" on a source file, hunt the stray byte.** A control character pasted into a template literal passes biome, tsc, and vitest silently while making ripgrep skip the file — which blinds every later grep-based verification of it. The failure is invisible in the quiet direction: searches just come back empty. *(2026-07-20)*
- **`mcpshim` reports transport success, not tool success.** A failed tool call still returns `"ok": true` at the top level — the real outcome is `result.isError` plus the error text inside `result.content[0].text`. A write that 400s (bad parameter name, rejected state transition) looks identical to one that landed unless you read `isError`, so **every mcpshim write is verified by reading the target back**, never by the call's own `ok`. Caught live filing Linear issues: a state change and a comment both reported `ok: true` and neither existed. *(2026-08-18)*
- **Never respond to a duplicate task notification.** Output already consumed means zero output.
- **Delegation defaults — Aaron states the goal, not the mechanism.** Three tiers with three different activation rules; only the middle one needs a word from him.
  - **Ephemeral subagents (`Agent` with no `name`) are my call and need no instruction.** Read-only fan-out — searching, reading across files, independent research or review. They auto-return their final text as the tool result, so they need no reporting contract and no isolation.
  - **Teammates need one word: "team" (or "teammates" / "coordinate agents").** That word alone carries the whole configuration — named teammates, `isolation: "worktree"` on every writer, roster 3–5, and the reporting contract below in every brief. Aaron never restates those; if he wants something different he overrides just that piece.
  - **Workflows need explicit opt-in** — "use a workflow" or "ultracode". Never inferred, ever.

  Overrides are single words: "solo" / "no agents" means I do it myself; "one agent" or any number caps the roster. **Delegate mode is not settable in config** — `permissions.defaultMode` accepts only `default | acceptEdits | bypassPermissions | plan | dontAsk | auto`. It is a Shift+Tab runtime toggle, so on any team of 3+ I spawn, I say so and ask Aaron to press it. *(2026-08-22)*

- **One writer per tree — and `isolation: "worktree"` is how to get it.** The property that has to hold is that no two agents write into the same tree at the same time. Read-only agents skip it. **Prose ownership is not isolation:** measured 2026-08-22, 47 of 75 briefs named a directory boundary in prose and two agents still clobbered one directory for 35 minutes. A shared tree also couples every agent's turn-end to every other agent's in-flight code wherever a repo runs whole-repo checks in a Stop hook. Corollary: a teammate inherits the lead's cwd and cannot be launched elsewhere, so a worktree is the only way to place it. *(2026-08-22)*

  **Prefer the flag, but the property is the point.** Measured across 8 days ending 2026-08-27: only 12 of 62 teammate spawns passed `isolation: "worktree"` — and the property still held. Of 23 teammate sessions that wrote real files, 22 had their tree to themselves, because the missing flag had been replaced by hand-built sibling worktrees named in the brief. One overlapping pair, one file. So the residual gap is mechanism, not safety: hand-built trees get no auto-cleanup, never appear in `ListAgents`, and are torn down by hand. Reach for the flag first — a brief that spells out a tree path in prose is the tell that it was skipped. Do not escalate this to a gate: the risk it would guard against did not materialize.

  **Check worktree provisioning before trusting a pass.** The harness creates worktrees at `<repo>/.claude/worktrees/agent-<id>`; whether they get `node_modules` and env files is per-repo. Where a SessionStart provisioning hook exists they come up complete (verified 2026-08-27: 33 of 33). With no such hook, dependency-needing checks skip rather than fail — a green turn that ran nothing. *(2026-08-27: corrects an earlier blanket claim here that worktrees are always unprovisioned.)*

- **Teammate roster caps at 3–5; fan wider with sequential rounds.** Coordination overhead dominates past five — the multi-agent literature and the practitioner guides converge on the same number. Local rosters had run to 22. *(2026-08-22)*

- **A teammate's final message is discarded; only `SendMessage` delivers.** The lead receives a zero-payload `idle_notification` when a teammate stops. The binary's teammate addendum does say this, and teammates ignore it anyway — it lands once at session start and decays, so it gets restated in the brief where it is still in recent context at the moment the agent stops. Every teammate brief ends with: *your final message is not delivered; the `SendMessage(to: "team-lead")` call IS your deliverable; send it before you stop, every time, including blocked or partial; and write findings to a file as you go so an unreported stop is recoverable.* `ListAgents` reports `running`/`completed` for subagents but **only elapsed time for teammates** — there is no built-in liveness probe, which is the third reason to prefer ephemeral. *(2026-08-22: 86 zero-payload pings, 21 chase messages, 6 of 75 briefs carried the contract.)*

- **`autoMemoryDirectory` expands `~/` and nothing else.** A `$HOME/...` value is not expanded, fails the resolver's absolute-path check, and is discarded *silently* — the harness falls back to the per-project default `~/.claude/projects/<sanitized-cwd>/memory/` with no warning. Caught after memory had been scattering into per-project dirs for three days while `MemoryProvenance` gated on a directory nothing wrote to. Any path-valued harness setting gets its effective value read back, never assumed from the file. *(2026-08-20)*

## Project-specific rules

Drop a `CLAUDE.md` beside a project for rules that only apply inside it. Claude Code merges it with this file when a session starts there. Use it for invariants that bite repeatedly — "always use the X helper, never bare Y" — so the rule lives next to the code it governs.
