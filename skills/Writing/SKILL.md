---
name: Writing
description: "Generate or review text in Aaron's voice, per channel. Loads the measured channel profile (email / slack / documents / directing-work), drafts or audits against it, and runs a deterministic VoiceCheck for the countable features — hedge rate, banned closers, bullet ratio, dash style, greeting and sign-off shape. USE WHEN write this as me, draft an email, draft a slack message, write this post, review my draft, does this sound like me, make this sound like me, check my voice, scrub the AI tells, rewrite in my voice, is this on-voice. NOT FOR writing as Ndeko (that is the default and needs no skill), and NOT FOR deciding what to say — this skill governs how it sounds, never what position to take."
---

# Writing

Generate or review text **in Aaron's voice**, which is not my voice and is not one voice.

## The two jobs, kept separate

| Job | What it means | Workflow |
|---|---|---|
| **Draft as him** | Producing text that will go out under his name | `Workflows/Draft.md` |
| **Review a draft** | Auditing text against the profile — his own, or my imitation | `Workflows/Review.md` |

**Writing as myself is neither of these and needs no skill.** My voice is deliberately different from his; the divergence and its rationale live in `~/.claude/assistant.md`. Conflating the two is how a voice gets laundered — if I drift toward his register in ordinary work, anything I draft under his name stops being distinguishable from what he wrote.

## Pick the channel first

There is no single "Aaron's voice." The channels differ enough that an averaged profile sounds like none of them.

| Channel | Profile |
|---|---|
| `email` | `~/.config/ndeko-os/identity/voice/email.md` |
| `slack` | `~/.config/ndeko-os/identity/voice/slack.md` |
| `documents` | `~/.config/ndeko-os/identity/voice/documents.md` |
| `directing-work` | `~/.config/ndeko-os/identity/voice/directing-work.md` |

**Read the profile before drafting. Do not work from a summary of it, including one in this repo.** Profiles and the numeric bands (`identity/voice/thresholds.json`) live in the **data tree**; the measurements are the fingerprint and never enter this repo. This skill is the method, and the method is useless without the profile — if the data tree is missing, say so rather than improvising a voice.

**If the channel is ambiguous, ask.** Drafting a Slack message in his email register is a worse failure than one extra question.

## The organizing principle

**His formality tracks audience size and permanence, not seniority.** A company-wide broadcast is his most formal register; an exec peer reads almost the same as an IC. He is *tersest* with his own team and with tools, and *warmest* with outsiders.

So the routing question is never "how senior is the reader." It is **how many people will see this, and how long will it persist.**

## Tool

```bash
bun ${NDEKO_DIR}/skills/Writing/Tools/VoiceCheck.ts --channel <channel> <file|->
```

Measures the countable features against the channel's band and exits non-zero on a defect. Run it on every draft before showing it to him — including drafts he wrote, when he has asked for a review.

It handles what is countable. It cannot judge whether an argument lands or whether a disagreement is phrased the way he phrases one. That is the workflows' job.

## Gotchas

- **Bands are descriptive, not targets.** They describe how he has written, not how he must. A flag means look, never automatically fix. Optimizing a draft toward the median produces something that reads like an average of him.
- **Never edit his prose toward conformity unless he asked.** Reviewing *his* draft is a different job from auditing *my imitation* of him — see `Workflows/Review.md`. Silently normalizing his writing to his own average is the worst possible outcome of this skill.
- **Profiles carry `review_after` dates, and so does `thresholds.json`.** Voice drifts. A profile past its review date is evidence, not law — VoiceCheck says so in its footer when that happens.
- **Not every register is profiled.** The profiles name their own gaps. Do not extrapolate a channel that has no profile; say it is unprofiled instead.
- **A corpus can contain generated text.** If you ever re-derive a profile from a source that mixes authored and pasted LLM output, filter first, or the profile learns to imitate a model imitating him.
- **His written and spoken registers differ, and the profiles say how.** Never carry a spoken-register habit into written text under his name on the assumption they match.
