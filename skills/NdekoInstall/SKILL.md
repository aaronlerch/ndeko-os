---
name: NdekoInstall
description: "Set up a fresh ndeko installation by interviewing the person it will serve, then writing their private data tree — principal, goals, config, pacts, and the privacy denylist. The harness ships with no personal data by design; this skill is what supplies it. USE WHEN ndeko install, ndeko setup, set up ndeko, first run, new installation, personalize ndeko, onboard me, fill in my data tree, my data tree is empty, identity is missing, goals.md is empty, who am I to you. NOT FOR editing an already-populated data tree (just edit the file), NOT FOR installing the harness itself (that is ./install.sh), and NOT FOR building voice profiles from a corpus (that is a separate measurement job)."
---

# NdekoInstall

The harness is method. The data tree is the person. A fresh clone has the first and
none of the second, which is why a new installation feels capable and generic at the
same time. This skill closes that gap by talking to them.

## What done looks like

A populated data tree at `$NDEKO_DATA_DIR` (default `~/.config/ndeko-os`), with every
file below either written or explicitly deferred and named as deferred. The person
should be able to start a new session immediately afterward and have it know who they
are, what they are working toward, and what it may do without asking.

| File | Holds | Required |
|---|---|---|
| `identity/principal.md` | Who they are, how to work with them | Yes |
| `goals.md` | What they are driving at now | Yes |
| `config.toml` | Name, timezone, formats, trusted repos, review cadence | Yes |
| `privacy-denylist.txt` | Terms that must never enter the harness repo | Yes |
| `identity/pacts.md` | Standing agreements between them and me | Optional |
| `identity/voice.md` + `identity/voice/` | Measured writing voice, per channel | Defer |
| `memory/MEMORY.md` | Auto-memory index | Created by the harness |

**Voice profiles are a measurement job, not an interview.** They require a real corpus
of their writing and produce numbers. Never invent them from a conversation — a made-up
profile is worse than no profile, because the `Writing` skill will trust it. Say it is
deferred and move on.

## The one hard constraint

**Nothing personal is written into the harness tree. Ever, including during setup.**
Every file this skill creates lives under the data root. If you find yourself about to
write a name, an employer, or a project into `~/.claude/`, stop — that is the exact
boundary the whole system is built on, and `PrivacyBoundary.hook.ts` will block it
anyway.

Resolve paths through `~/.claude/hooks/lib/paths.ts` rather than hardcoding them:

```bash
bun ~/.claude/hooks/lib/paths.ts     # prints where both roots resolved
```

## How to run it

Interview, don't interrogate. This is a conversation with someone who has just installed
an assistant and does not yet know what it needs to know. A form with twenty fields gets
abandoned; a few good questions that visibly produce something get finished.

Work in passes, writing after each so nothing is lost if they stop:

1. **Identity and config first** — enough to be useful immediately. Their name, what they
   do, what they are working on, timezone and formats. Write `config.toml` and a first
   `identity/principal.md`.
2. **Goals next** — what is actually in front of them now, what they are deliberately
   *not* doing, and what good looks like. The "not doing" list is the one people skip and
   the one that most changes behavior.
3. **Working preferences** — autonomy boundaries, what I may do without asking, which
   repos are trusted for commit and push, how much explanation they want. Extend
   `principal.md` and `config.toml`.
4. **Privacy denylist** — employer, customers, internal repo and project names. Frame it
   plainly: these are the words that must never end up in a repo they might share.
5. **Pacts, if any** — standing agreements about how the two of you work together. Skip
   this without ceremony if nothing comes up; it is not a required file.

Stop when the required files exist and are substantive. Do not pad a thin answer into a
long file — a short honest `goals.md` beats a padded one, and `review` dates in
`config.toml` bring it back around.

## Questions that actually produce useful files

Ask about what they do and how they work, not about what they want an assistant to be.
People answer the first accurately and the second aspirationally.

- What are you actually working on this month? What would make it a good month?
- What are you deliberately *not* doing right now, even though you could?
- When I get something wrong, how do you want to hear about it?
- What should I be able to do without asking you first? What must I always ask about?
- Which repositories can I commit and push to without checking?
- What words — company, customers, internal projects — should never appear in a repo you
  might share with someone?
- Is there anything about how you work that I would only learn by getting it wrong?

The last one is the highest-yield question in the set. It is also the one that most often
produces a pact.

## Finishing

End with three things:

1. **What you wrote**, as file paths, so they can read and edit any of it.
2. **What was deferred**, named — voice profiles almost always, sometimes goals depth.
3. **A verification they can run themselves.** Start a new session and ask "what am I
   working on?" — if the answer is specific, the data tree loaded. `CLAUDE.md` imports
   `identity/principal.md`, `identity/voice.md`, `identity/pacts.md`, and `goals.md`
   directly, so a file that exists but stays unimported means an import line is missing
   or a filename is wrong.

Then say plainly that the profile is a starting point measured on one conversation, and
that the `review` dates in `config.toml` exist because first-day answers age badly.

## Gotchas

- **`identity/voice.md` and `identity/voice/*.md` are imported and referenced by the
  `Writing` skill.** Creating an empty or invented `voice.md` is worse than leaving it
  absent — `Writing` will load it and imitate a fiction. Leave it missing until measured.
- **`@` imports in `CLAUDE.md` are `~/`-absolute and one level deep.** A new personal file
  that should load every session needs its own line there; nesting it inside another
  imported file relies on transitive imports, which work to four hops but are one more
  thing to get wrong.
- **`config.toml` `[git] trusted_repos` widens what I may do without asking.** Read the
  entries back to them explicitly before writing. Autonomy granted in an interview is
  easy to grant too fast.
- **The denylist is a tripwire, not a guarantee.** Say so. It catches known strings and
  two structural patterns; it cannot catch a paraphrase, and it does not replace reading
  a diff before making a repo public.
- **A data tree can already be half-populated** — a re-run, a restored backup, a partial
  first attempt. Read what exists before writing, and ask before overwriting anything
  non-empty rather than merging silently.
