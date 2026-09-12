# Authoring mechanics — skills in this harness

The harness-specific branch of `~/.claude/doctrine/authoring.md`: what changes when the
document is a skill. Everything about *writing* it is in `authoring.md`, which is portable;
this file is Claude Code mechanics and does not travel.

Provenance: adapted 2026-09-11 from `writing-for-agents/SKILL-MECHANICS.md` in the
`mattpocock/skills` repo (MIT).

## Invocation

Two choices, trading the two loads.

**Model-invoked** keeps a `description`, so the agent can fire it autonomously and other skills
can reach it. The name can still be typed: model-invocation always *includes* user reach — a
description only ever adds agent discovery, never removes the human's. The description is the
skill's top-level context pointer, forced to stay loaded at all times: permanent context load in
exchange for discoverability. A model-invoked skill whose content is all reference is also a home
for shared reference, since another skill can invoke it, so reference several skills need lives in
one place. Mechanics: omit `disable-model-invocation`, and write a model-facing description
carrying the trigger branches — the pointer-writing rules in `authoring.md` apply in full.

**User-invoked** strips the description from the agent's reach: only Aaron typing the name can
invoke it, and no other skill can. Zero context load, but it spends cognitive load — he is the
index that must remember it exists. Mechanics: set `disable-model-invocation: true`; the
`description` becomes human-facing, a one-line summary with trigger lists stripped.

Pick model-invocation only when the agent must reach the skill on its own, or another skill must.
If it only ever fires by hand, make it user-invoked and pay no context load.

Shared reference that two user-invoked skills both need can live in neither: with no
descriptions, neither can fire the other. Push it to a plain file outside the skill system —
external reference any skill can point at. In this harness that usually means `~/.claude/doctrine/`.

## Splitting by invocation

The invocation cut of splitting (the sequence cut is in `authoring.md`): split off a
model-invoked skill when there is a distinct leading word that should trigger it on its own — a
trigger word actually used in prompts — or another skill must reach it. You pay context load for
the new always-loaded description, so that independent reach has to be worth it.

## Router skills

When user-invoked skills multiply past what Aaron can remember, that piled-up cognitive load is
cured by a **router skill**: one user-invoked skill naming the others and when to reach for each,
so there is one skill to remember instead of many. It can only hint, never fire them — user-invoked
skills have no description, so nothing but the human can reach them.

**This harness needs one.** ~30 personal skills, and personal skills shadow same-named project
skills, so the failure mode is a name collision rather than a forgotten skill. A router is the fix;
renaming into a collision is not.

## Naming in this harness

- Personal skill directories are `PascalCase` (`RedTeam`, `WaitWhat`). A leading `_` marks a
  service-integration skill (`_Gong`, `_LinearSync`).
- The Codex tree at `~/.agents/skills/` uses `kebab-case` and symlinks back to its own source
  tree. The two trees are linked separately; a skill written here does not appear there.
- **The volume is case-insensitive.** `research` and `Research` are the same path, so a new skill
  name collides with an existing one that differs only in case. Check before creating.

## Frontmatter that this harness reads

- `name` — must match the directory name.
- `description` — the context pointer. Model-facing when model-invoked, human-facing when not.
- `disable-model-invocation: true` — user-invoked only.
- `effort` — optional; some skills set `medium`.

Anything else is inert here. A key that changes nothing is a no-op paying load; cut it.
