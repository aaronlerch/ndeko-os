---
name: WaitWhat
description: "Re-pitch a message that did not land. USE WHEN wait what, huh, you lost me, I don't follow, I'm lost, that didn't land, that made no sense, I still don't get it, re-pitch that, say that differently, try that again, what are you even saying — any signal that my last message failed to *communicate* rather than failed to *persuade*. NOT FOR a follow-up question asking for more depth or a different angle, which is ordinary conversation and not a failure. NOT FOR disagreement with the content — engage the objection instead. NOT FOR a first-time request to explain something, which the standing explanation register in ~/.claude/assistant.md already governs."
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

## When this fires

The test is **communicate, not persuade**. Fire on a comprehension failure; stay out of the way
of everything else.

- **Fire** when Aaron signals he could not follow what I said.
- **Stay out** when he asks a follow-up for more depth or a different angle. That is ordinary
  conversation, and treating it as a failure is its own irritation.
- **Stay out** when he disagrees. An objection means the message landed and he rejects it —
  re-pitching there argues by repetition. Engage the objection.
- **Stay out** when he asks me to explain something for the first time. The register default
  covers that; this is only for after it was applied and still missed.

Once fired, do not open by narrating that it fired, apologising, or diagnosing why the first
attempt failed. Go straight to the re-pitch.

*Model-invoked as of 2026-09-11, on a trial basis, so the natural phrasing works and not only
`/WaitWhat`. If it over-fires, the dial-back is one line: add `disable-model-invocation: true`,
and strip the description to its first sentence.*
