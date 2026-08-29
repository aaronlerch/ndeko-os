# Review a draft

**Two different jobs share this workflow, and confusing them is the main failure mode.**

| Whose draft | What review means | Default posture |
|---|---|---|
| **Mine, written as him** | Audit the imitation. Did I hit the voice? | Conform to the profile |
| **His own** | Does this do what he wants it to do? | **Do not conform it to the profile** |

## Reviewing his own draft — read this first

**He is the authority on his voice. The profile is a description of his past writing, not a standard he is failing to meet.**

Normalizing his prose toward his own measured average is the worst possible outcome of this skill. It would strip exactly the variation that makes writing good, and it would do so with the false authority of a number.

So when he hands you something he wrote:

- **Only flag voice at all if he asked about voice.** "Review this" usually means *does this land*, not *does this match your median*.
- **Deviation from a band is information, not a defect.** A 400-word email is outside the band; it may also be exactly right. Report it as an observation and move on.
- **The scrub list is the exception.** P0/P1 AI tells and corporate filler are worth flagging unprompted, because they usually mean text was drafted by a model somewhere upstream. That is a real finding, not a style opinion.
- **Argument and consequence come first.** Does it land on a recommendation? Is the "no" findable? Will the reader know what to do? Those matter more than any measurement.

## Reviewing my own imitation

Here conformity is the point — I am trying to sound like him, and the profile is the target.

Run the tool, fix every defect, and justify every flag you leave standing.

## Procedure

**1. Measure.**

```bash
bun ${NDEKO_DIR}/skills/Writing/Tools/VoiceCheck.ts --channel <channel> <file>
```

Deterministic, cheap, and falsifiable. Do this before forming any opinion, so the opinion is anchored to something.

**2. Judge what the tool cannot.**

- **Does it land?** Every channel of his ends on a pick. A draft that surveys options and stops is off-voice regardless of what it measures.
- **How does disagreement arrive?** His move is restate-the-system-then-ask-why, or "I have a big concern," or concede-then-pivot. A flat "that's wrong" is not his register — across four corpora he has essentially never written it.
- **Where does sharpness point?** At artifacts, always. Anything aimed at a person is out of voice *and* usually wrong on the merits.
- **Is the "no" front-loaded?** The profile carries the measured runway. If a decline is buried in paragraph three, that is the highest-value fix available.
- **Is ownership present?** If something went wrong, he says so early and plainly. A draft that routes around a failure reads as evasive in his voice specifically, because owning it is so consistent.
- **Third person in documents.** Internal memos refer to him in third person. First-person-heavy internal prose is a tell.

**3. Report in three buckets.**

- **Defects** — scrub-list hits and outright wrong-channel moves. Name and fix.
- **Flags** — measured deviations. Name, give the number, recommend, do not fix unilaterally.
- **Judgment** — argument, landing, disagreement shape. This is where the real value is; say what you would change and why.

**Never silently rewrite his prose.** Show the change and the reason. A diff he can reject is useful; a rewrite he has to reverse-engineer is not.

## Detecting model-written text

Worth a named pass, because it recurs:

- **The scrub list is the fast signal** — P0 closers and "Here's the thing" almost never survive human editing.
- **Sentence-length uniformity.** His short-punch rate is stable across internal and published writing — the profile has the figure. Uniformly medium-length sentences are a strong tell.
- **Structural absence.** Two documents in the source corpus were caught this way: 61.6-word mean sentences and zero header structure, in a corpus where he uses headers, tables and status lines constantly.
- **Hedging without a position.** He hedges about what is true, never about what he wants. Text that hedges the *recommendation* was written by something that did not have one.
