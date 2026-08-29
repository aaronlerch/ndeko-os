# Where a new rule belongs

> Load when encoding a rule, a preference, or a learning. The system prompt carries the resident summary; this is the full routing table.

## First, name the diagnosis

When something goes wrong, **"the system failed" and "I failed" are different diagnoses, and only the first takes a patch.**

If the rule was already encoded, already loaded, and simply not consulted — the correct remediation is **nothing.** Read it, and don't repeat it.

This matters because getting caught creates pressure to produce a visible artifact as proof of remediation, and a hook is the most legible artifact available. Resist that. **A lapse is not a missing mechanism.** Building a gate to catch yourself disobeying doctrine you already hold adds scaffolding without adding capability, and every unnecessary rule competes for attention with the rules that matter.

The test: *would a more capable model make this addition unnecessary?* If yes, the rule belongs in doctrine — and the lapse belongs nowhere.

## The routing table

| What you're encoding | Where it goes |
|---|---|
| Operational preference — tool choice, convention, naming | `~/.claude/CLAUDE.md` § Operational rules |
| A checkable property of an **artifact**, or a gate on an **irreversible act** | `~/.claude/hooks/*.hook.ts` — **only these two classes** |
| Permissions: allowed or denied tools, paths, hosts | `~/.claude/settings.json` → `permissions`, `autoMode` |
| Domain behavior — how to do a class of work | The relevant `~/.claude/skills/<Name>/SKILL.md` |
| The loop itself — claims, teeth, evidence rules | `~/.claude/algorithm/v{VERSION}.md` |
| A verification rule earned from an incident | `~/.claude/doctrine/verification.md` (dated) |
| Voice, personality, autonomy | `~/.claude/assistant.md` |
| Who Aaron is, what he's driving at | data tree: `~/.config/ndeko-os/identity/`, `~/.config/ndeko-os/goals.md` |
| A durable fact about the world worth recalling later | **harness memory** — see below |
| Per-task claims and evidence | the task's artifact, and `git log` |

**On the hooks row.** A hook must not encode *how I work* — which tool I reach for, which language, which style. That fails the test above, because a model reading its own doctrine makes such a hook pointless. Hooks are for properties you can check mechanically and for acts you cannot undo.

## Harness memory is the store

**This reverses the predecessor's rule, deliberately.**

The old rule said to ignore the harness's auto-memory and route every learning into custom files, on the reasoning that a memo treats the symptom while a system patch treats the cause. That was written when harness memory had no index and no consolidation pass.

It has both now: a `MEMORY.md` index injected into context, a real recall index, and a background consolidation pass. Meanwhile the custom alternative was measured on disk — hundreds of captured failures produced a single distillation, and an open-coding pass later showed a large share of them were capture artifacts rather than failures. The custom store lost.

So: **world-state facts and learnings go to harness memory.** Doctrine is the exception and lives in the files above. The test is unchanged, only the destination:

- *"Does this describe how I should behave, what rule to follow, what convention applies?"* → doctrine. Not memory, and not a hook.
- *"Does this describe a state of the world I should recall later — someone's role, a project's pending state, a one-time fact?"* → harness memory.

Every memory write carries provenance (`source:`), because a learning derived from a fetched page is not the same trust tier as one derived from a verified run.

## Why this works

When you patch the infrastructure, every future session starts with the rule already in effect. There is nothing to remember to consult, because the rule is structurally in force. That is the whole mechanism — and it is also why adding a rule that *isn't* structurally enforced is worse than adding nothing.
