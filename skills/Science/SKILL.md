---
name: Science
description: Hypothesis-driven investigation — generate at least three competing explanations, name what would falsify each, then test cheapest-and-likeliest first. USE WHEN why is this happening, figure out why, form a hypothesis, what might be causing, how do we test this, I've been stuck on this, tried the obvious fix and it didn't work, about to try random stuff, experiment design, what would prove this wrong. NOT FOR tracing the causal chain of a specific incident (use RootCauseAnalysis), surfacing requirements from multiple angles before building (use IterativeDepth), or structural feedback loops and recurring behavior (use SystemsThinking).
---

# Science

Investigation discipline for when you do not know the answer yet. The Algorithm already handles goal-first work and evidence gates — this skill adds the part it does not: **you are probably wrong about which cause it is, so hold several and let a cheap test choose.**

## The trigger

Reach for this the moment any of these is true:

- You tried the obvious fix and it did not work.
- You are about to try things and see what happens.
- You are reasoning from "it's probably…" with no evidence for the "probably".
- You have been at it 15 minutes longer than you expected.

**Anti-triggers** — skip it when the fix is obvious and small, when you have solved this exact shape many times before, or when trying is genuinely cheaper than thinking. Investigation ceremony on a one-line fix is waste.

## Ideal state

An investigation is done when:

- At least **three** competing explanations were written down before any was tested.
- Each one names **what would prove it wrong** — not what would confirm it.
- The tests ran in order of cheapest-to-verify × most-likely, and each result actually eliminated something.
- The conclusion rests on an observation, not on the explanation having felt right.
- What was eliminated is stated too. "It is not X or Y" is a real finding and saves the next person.

## Plurality — the load-bearing rule

**Never test one hypothesis.** A single explanation is not a hypothesis, it is a hunch you are about to spend an afternoon confirming. One idea produces confirmation bias (you will find supporting evidence, because you are looking for it), sunk cost, and a narrow frame that hides the orthogonal answer.

**Minimum three. Five to ten when the problem matters.** If three do not come, you have not understood the system well enough to be debugging it yet — go read the code path.

Ways to break out of a single frame when the count is stuck at one:

- Invert it — what would have to be true for this to be *working*?
- Move layers — if you assumed application code, ask the same question of config, network, cache, data, and clock.
- Assume the report is accurate and your model is wrong, rather than the reverse.
- Ask what changed. Something that used to work and now does not has a diff behind it.

## The falsification question

For every hypothesis: **what observation would kill this?**

If nothing would, it is not a hypothesis and it cannot be tested — rewrite it until it is refutable. "The cache is stale" is refutable. "Something's off with caching" is not.

This is the same move `~/.claude/doctrine/verification.md` makes for claims, applied to causes. The probe must be able to come back negative.

## Test order

Rank by **cheapest to verify × most likely**, and run in that order. A 30-second check that eliminates the second-most-likely cause beats a 20-minute check on the favorite.

State the result plainly, including when it eliminates your favorite. A hypothesis that survives one weak test is not confirmed — it is merely not yet dead.

## Anti-patterns

| Instead of | Do |
|---|---|
| "Make it better" | "Cut p95 from 3s to 1s" |
| "I think it's the cache" | "Three candidates: cache, clock skew, stale build. Here's what kills each." |
| A test that confirms your hunch | A test that could refute it |
| Quietly dropping the failed idea | "H2 is dead — the timestamps matched" |
| Testing the most interesting cause | Testing the cheapest informative one |
| Investigating until certain | Shipping the fix and watching production |

## Boundaries

- **A specific incident with a causal chain to trace** → `RootCauseAnalysis`, which has 5 Whys, fishbone, and blameless postmortem. Science generates candidate causes; RootCauseAnalysis structures the walk once you have one.
- **Requirements and edge cases before building** → `IterativeDepth`. That is multi-lens exploration, not hypothesis elimination.
- **"Why does this keep happening"** → `SystemsThinking`. Recurring behavior is usually structural, and no single hypothesis explains a loop.
- **Attacking a plan or an argument** → `RedTeam`.
- **Challenging whether a constraint is real** → `FirstPrinciples`.
