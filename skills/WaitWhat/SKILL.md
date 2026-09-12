---
name: WaitWhat
description: "Stop — that last message did not land. Re-pitch it."
disable-model-invocation: true
---

# WaitWhat

That last message did not land. **Re-pitch it — do not re-explain it.**

Restating the same structure more slowly is the thing that already failed. Find the different
way in.

## What to do

1. **Name the premise you skipped.** The failure is usually a missing fact, not vocabulary —
   something assumed known that was never said. Lead with that.
2. **Re-pitch from a different angle.** A concrete example, the failure it prevents, an
   analogy, the decision it changes. Not the same path at half speed.
3. **Write in ASD-STE100 Simplified Technical English.** One idea per sentence, active voice,
   the plainest word that is still accurate, no clause stacking. It is the aerospace controlled-language
   standard for exactly this problem: writing that a reader cannot misread.
4. **Use the project's own vocabulary.** Read `CONTEXT.md` if the repo has one (follow
   `CONTEXT-MAP.md` to the right one when there are several). Otherwise use the words already
   used in this conversation, not synonyms for them.

## Scope

The explanation register itself is already the standing default — `~/.claude/assistant.md` §
Writing owns it, and this skill does not restate it. This is the escalation for when that
default was applied and the message *still* did not land.

Say plainly which part was unclear if it is not obvious, rather than re-pitching the whole
thing on a guess.
