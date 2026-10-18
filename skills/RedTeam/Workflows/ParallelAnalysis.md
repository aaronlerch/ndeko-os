# Red Team Parallel Analysis Workflow

Stress-test an existing argument, plan, or decision by attacking it from many independent angles at once, then deliver the strongest case for it and the strongest case against it.

**The point is the one flaw that collapses the structure** — a false hidden assumption, a step that does not follow, a category error, an ignored precedent. Not nitpicks, not contrarianism.

## Done looks like

1. **The argument is pinned down.** Central thesis in one sentence, the supporting claims, the implicit assumptions, and the logical chain to the conclusion — decomposed into atomic claims that are self-contained, specific, and attackable. As many claims as the argument actually has; a two-paragraph proposal and a strategy doc are different sizes.
2. **Independent attackers examined it from genuinely different lenses.** Each read the full argument and the claim list, and returned the strongest point *for* it and the strongest point *against* it from its lens, citing claim numbers. Pick the lenses the argument is vulnerable to (menu below); the count follows from the lenses worth running, not a fixed roster. Run them as parallel read-only subagents in one message.
3. **Convergence was measured, not asserted.** Weaknesses several attackers reached independently are ranked above one-off hits, and each finding is tagged with how many lenses surfaced it.
4. **The steelman would satisfy a proponent** — they would read it and say "yes, that's my argument, made better."
5. **The counter-argument defeats the steelman, not a strawman.** Before writing it, the stated constraints were classified hard / soft / assumption (`FirstPrinciples` → Challenge); the strongest critiques target a "hard" constraint that is actually a choice.
6. **Every weakness carries a remediation path.** The goal is a stronger plan.

## Attack lens menu

Choose the lenses this argument is exposed to. Diversity is the value: four distinct lenses catch failure modes that twelve copies of one skeptic cannot.

| Family | Lenses |
|---|---|
| **Technical rigor** | breaks at scale · show me the data · the 1% edge case · we tried this before · harder than it sounds · assumption-dependency chain · catastrophic failure modes · hidden long-term cost |
| **Structural** | how it fits the larger system · the trade-off it hides · category error · who benefits (incentives) · second- and third-order effects · interfaces where it breaks · works for 10, not 10,000 · reversibility |
| **Adversarial** | how an attacker exploits the logic · the weakest link · what a rational opponent does · how people route around it · precedent in a new dress · whether the mitigations work · undefended surface · attacker/defender asymmetry |
| **Fresh eyes** | keep asking "what makes us assume that" · analogy from another field · the exact opposite is true · common-sense check · what happens on the ground · the simpler explanation · push it to its absurd conclusion · the uncomfortable thing nobody wants to say |

Add `Forge` as one attacker on anything publish-bound or irreversible — a different model lineage does not share Claude's blind spots.

## Attacker brief

Each attacker gets the full argument, the claim list, its lens, and this ask:

> From your lens only, give an independent balanced read. **Strongest point for** the argument (cite claim numbers; why it holds; why to take it seriously). **Strongest point against** it (cite claim numbers; the flaw; why it matters). **Verdict** in one sentence. Find real strengths, not strawmen; real weaknesses, not nitpicks.

## Output contract

```
# STEELMAN
**The position, best version:** [one sentence]
1. [one sentence per point — the strongest case for, ordered to build]
...
**Legitimate core concern:** [one sentence]

# RED TEAM VERDICT
**The position:** [one sentence on what was red-teamed]
1. [one sentence per point — the fundamental flaw first, the knockout last]
...
**Assessment:** [one sentence on the argument's soundness after analysis]

# FINDINGS
| Weakness | Lenses that reached it | Severity | Remediation |
```

Each point is self-contained, in plain language, and builds on the last; most arguments land at five to eight points a side. The verdict escalates and ends on the single strongest objection — the one that makes the reader say "I hadn't thought of that."

## Example

**Argument:** "We should delay this product launch by six months to add more features."

- **Assumptions surfaced:** more features means more success; competitors will wait; market timing is flexible.
- **Steelman, strongest point:** the features address the top three complaints from beta research, so parity is table stakes, not gold-plating.
- **Verdict, strongest point:** it treats product development as a single bet rather than an iterative learning process — only real users reveal which features matter, and lost time cannot be added back after launch.
