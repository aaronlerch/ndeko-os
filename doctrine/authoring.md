# Authoring doctrine — writing documents agents consume

Loaded on demand when writing or editing any document an agent reads: a skill, `CLAUDE.md`,
`AGENTS.md`, a doctrine or algorithm file, a subagent brief, a delegate task. The packaging
differs; the writing does not. The same levers make each one predictable, because the agent
takes the same *process* every run rather than producing the same output.

This file owns the vocabulary. `~/.claude/system-prompt.md` § Ideal-state prompting carries
the leading words into always-loaded context and points here for the definitions;
`BitterPillEngineering` is the auditing counterpart and points here rather than restating.
Same vocabulary, opposite verbs: this file authors, BPE audits.

Skill-specific mechanics — frontmatter, the invocation choice, router skills — are in
`~/.claude/doctrine/authoring-mechanics.md`. They are Claude-Code-specific; everything here
is portable.

Provenance: adapted 2026-09-11 from `writing-for-agents` in the `mattpocock/skills` repo
(MIT), audited SAFE the same day. Ported for vocabulary, not wholesale.

---

## Context pointers

A **context pointer** is a reference held in the agent's context that names some
out-of-context material and encodes the condition for reaching it. A skill's description is
one; a line in `CLAUDE.md`'s routing table naming a doctrine file is the same object. The
pointer's *wording*, not its target, decides when the agent reaches the material, and how
reliably. A must-have target behind a weakly worded pointer is a variance bug: sharpen the
wording first, and inline the material only if sharpening fails.

A pointer does two jobs: state what the material is, and list the **branches** that should
trigger reaching it (a branch is a distinct case the document handles, so different runs take
different paths through it). Every word of an always-loaded pointer costs on every turn, so it
earns harder pruning than the body:

- **Front-load the leading word.** The pointer is where it does its triggering work.
- **One trigger per branch.** Synonyms that rename a single branch are one branch written
  twice; collapse them and keep only genuinely distinct branches.
- **Cut identity the body already carries.**

## The two loads

Every document and pointer added spends one of two budgets:

- **Context load** is the cost of always-loaded material on the window: a `CLAUDE.md` line, a
  skill description, anything sitting in context every turn, spending tokens and attention
  whether or not it fires.
- **Cognitive load** is the cost on Aaron: which documents exist and when to reach for each.
  He is the index. Not a cost to minimise — it is the price of human agency. Spend it where
  his judgement matters, remove it where it does not.

Material reached only through a pointer escapes context load at the price of the pointer's own
line; material with no pointer at all rides entirely on cognitive load.

This is why a router beats a name collision, and why a user-invoked skill is the cheap default:
it pays zero context load and buys it back in cognitive load, which is often the right trade.

## Information hierarchy

A document is built from two content types: **steps** (the ordered actions the agent performs)
and **reference** (definitions, rules, facts consulted on demand). The two mix freely — all
steps (a recipe), all reference (a review's rules, this file), or both. The core decision is
where each piece sits on the **information hierarchy**, a ladder ranked by how immediately the
agent needs the material:

1. **In-file step** — the primary tier: what the agent does, in order.
2. **In-file reference** — consulted on demand. Often a legitimately flat peer-set (every rule
   of a review on one rung), which is a fine arrangement, not a smell.
3. **Disclosed reference** — pushed into a separate file behind a context pointer, loaded only
   when the pointer fires. Spans a sibling file in the same folder through fully external
   reference any document can point at.

Push too little down and the top bloats; push too much and material the agent actually needs
is hidden. That tension is the whole decision.

**Progressive disclosure** is the move down the ladder so the top stays legible. Not primarily
a token optimisation — it is how the hierarchy is protected. Branching is the cleanest
disclosure test: inline what every branch needs, push behind a pointer what only some branches
reach. In a document that has steps, in-file reference that should have been disclosed buries
them and turns attending to them into a coin-flip: a variance lever, not just a legibility one.

**Co-location** is the within-file companion. Where the ladder decides *how far down* a piece
sits, co-location decides *what sits beside it* once there. Keep a concept's definition, rules,
and caveats under one heading rather than scattered, so reading one part brings its neighbours.
The test: the document should read like documentation written for the agent. Grouped material
reads that way; scattered material does not. (Distinct from duplication, which repeats one
meaning in two places; scattering fragments one meaning across many.)

**Sprawl** is the failure mode here: a document simply too long, even when every line is live
and unique. Attention thins across the excess, and every extra line is one more to keep
relevant. The cure is the ladder — disclose reference behind pointers, split by branch or
sequence so each path carries only what it needs.

## Steps and completion criteria

Every step ends on a **completion criterion**: the condition that tells the agent the work is
done. Two properties make it a lever.

**Clarity** — can the agent tell done from not-done? A vague bound ("understanding reached")
invites **premature completion**: ending the step before it is genuinely done, attention
slipping to *being done*. The visible steps still ahead (the **post-completion steps**) supply
the pull; the criterion's clarity is the resistance. Defend in order: sharpen the bound first
(local and cheap); only if it is irreducibly fuzzy *and* the rush is observed, hide the later
steps by splitting the sequence. Hiding only works across a real context boundary — a hand-off
or a subagent dispatch. An inline call leaves the later steps in context and clears nothing.

**Demand** — how much it requires. "Every modified model accounted for" forces thorough work
where "produce a change list" does not. Demand drives **legwork**: the digging the agent does
within the work, latent in the wording rather than written as its own step. It is not
step-bound — "every rule applied" binds a body of flat reference just as "every step done"
binds a sequence, which is how an all-reference document still carries an exhaustiveness bar.

The strongest criteria are both checkable and exhaustive. This is the same property the
verification doctrine demands of evidence, arriving from the authoring side: a criterion that
cannot be checked produces a done-claim that cannot be verified.

## When to split

Splitting one document into two spends one of the two loads, so split only when the cut earns it:

- **By sequence** — split a run of steps where the post-completion steps tempt the agent to
  rush the one in front of it. Keeping them out of view drives more legwork on the current
  task. Beware the reverse: merging sequences exposes each step's later steps to what follows,
  inviting premature completion.
- **By invocation** — skill-specific; see `authoring-mechanics.md`.

## Leading words

A **leading word** is a compact concept already living in the model's pretraining that the
agent thinks with while running the document (*lesson*, *fog of war*, *tracer bullet*,
*seam*). Repeated as a token, never as a sentence, it accumulates a distributed definition and
anchors a whole region of behaviour in the fewest tokens, by recruiting priors the model
already holds. Coining a new one works if it is defined clearly, but a made-up word recruits
no priors: you pay in definition tokens what a pretrained word gives free. Reach for an
existing word first.

It anchors twice. In the body, *execution*: the agent reaches for the same behaviour every time
the word appears, and inside flat reference it focuses attention on a class of thing to look
for. In a pointer, *invocation*: when the same word lives in the prompts, the docs, and the
codebase, the agent links that shared language to the material and reaches it more reliably.

Hunt for refactors into leading words. A triad spelled out at three sites, a pointer spending
a sentence to gesture at one idea — each is a passage begging to collapse into a single token:

- "fast, deterministic, low-overhead" → **tight** (a *tight* loop).
- "a loop you believe in" → **red**, turning a fuzzy gate into a binary observable state (the
  loop goes *red* on the bug, or it does not).

Two wins: fewer tokens, and a sharper hook for the agent to hang its thinking on. Assume every
document is carrying restatements that leading words retire. Go find them.

**Negation** is the failure mode beside this lever. Steering by prohibition drags the forbidden
behaviour into context and makes it *more* available, not less. *Don't think of an elephant*,
and the elephant is all there is; the negation is a weak modifier the strongly-activated
concept overruns, so the ban half-reads as an instruction to do the thing. Prompt the
**positive**: state the target behaviour ("write one-line comments") so the banned one is never
spoken. A prohibition earns its place only as a hard guardrail that cannot be phrased
positively — and even then, pair it with the positive target so attention lands on what to do.

## Pruning

- Keep each meaning in a **single source of truth**: one authoritative place, so changing the
  behaviour is a one-place edit. **Duplication** — the same meaning in more than one place —
  costs maintenance and tokens, and inflates a meaning's prominence on the ladder past its real
  rank. It is the accidental inverse of a leading word, which repeats a token on purpose, never
  the meaning.
- The **environment** is a source of truth too (`package.json` scripts, config files, the
  directory layout, `--help` output), and a document that restates it is a **cache**: a copy of
  a lookup, earning its load only when the lookup is expensive. Cache what the agent cannot find
  by looking — the unwritten convention, the reason behind a choice, the gotcha no config
  confesses. Leave one-file, one-command lookups to the environment, where they cannot go stale.
- Check every line for **relevance**: does it still bear on what the document does? A line loses
  relevance by never bearing on the task (mere exposition, or a branch that should be disclosed)
  or by going stale as the behaviour it describes changes. Shorter documents are easier to keep
  relevant. Without a pruning discipline the default fate is **sediment**: stale layers that
  settle because adding feels safe and removing feels risky, until you must core down through
  them to find what is still live.
- Hunt **no-ops** sentence by sentence: an instruction the model already obeys by default pays
  load to say nothing. The test — does it change behaviour versus the default? — is
  model-relative, not reader-relative. Two people disagreeing about a no-op disagree about the
  default, and settle it by running the document, not by debate. When a sentence fails, delete
  the whole sentence rather than trim words from it. The test also grades leading words: a word
  too weak to beat the default (*be thorough*, when the agent is already thorough-ish) is a
  no-op, and the fix is a stronger word (*relentless*), not a different technique.

**A no-op that looks like coverage is worse than an absent rule.** It reads as the rule being
handled, so nothing gets promoted and no audit flags the gap. Measured 2026-09-11: the
explanation-register rule sat in memory for three weeks while `assistant.md` carried "Plain
language over jargon" — four words with no register/depth split, no trigger words, and no scope,
which any audit would have counted as the rule already present. When a rule seems oddly absent
from always-loaded text, search for its decoy before concluding it was never written.
