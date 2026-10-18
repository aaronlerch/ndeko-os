---
name: RedTeam
description: "Adversarial analysis that attacks an idea, strategy, or plan from many independent expert lenses in parallel (technical rigor, structural, adversarial, fresh eyes) — not systems or infrastructure. Two workflows: ParallelAnalysis (decompose into atomic claims → parallel lens attack → convergence → steelman → counter-argument) and AdversarialValidation (competing proposals synthesized into the best solution). Context files: Philosophy.md (core principles, success criteria), Integration.md (how to combine with FirstPrinciples, Forge and Science). Findings ranked by convergence and severity; goal is to strengthen, not destroy — weaknesses delivered with remediation paths. NOT FOR AI instruction set auditing (use BitterPillEngineering). NOT FOR network/system vulnerability testing (use a security assessment skill). USE WHEN red team, attack idea, counterarguments, critique, stress test, devil's advocate, find weaknesses, break this, poke holes, what could go wrong, strongest objection, adversarial validation, battle of bots."
effort: high
---

# RedTeam Skill

Adversarial analysis using parallel agents. Breaks an argument into atomic claims, attacks it from the independent lenses it is most exposed to, measures where the attacks converge, and delivers both the steelman and the strongest counter-argument.

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| Red team analysis (stress-test existing content) | `Workflows/ParallelAnalysis.md` |
| Adversarial validation (produce new content via competition) | `Workflows/AdversarialValidation.md` |

| Workflow | Purpose | Output |
|----------|---------|--------|
| **ParallelAnalysis** | Stress-test existing content | Steelman + counter-argument + ranked findings with remediations |
| **AdversarialValidation** | Produce new content via competition | Synthesized solution from competing proposals |

## Context Files

- `Philosophy.md` - Core philosophy and success criteria
- `Integration.md` - Skill integration and FirstPrinciples usage

## Examples

**Attack an architecture proposal:**
```
User: "red team this microservices migration plan"
--> Workflows/ParallelAnalysis.md
--> Returns steelman + counter-argument + the findings that converged
```

**Devil's advocate on a business decision:**
```
User: "poke holes in my plan to raise prices 20%"
--> Workflows/ParallelAnalysis.md
--> Surfaces the ONE core issue that could collapse the plan
```

**Adversarial validation for content:**
```
User: "battle of bots - which approach is better for this feature?"
--> Workflows/AdversarialValidation.md
--> Synthesizes best solution from competing ideas
```

## Gotchas

- **RedTeam is for attacking IDEAS, not systems.** It finds flaws in arguments, strategies, and plans — not network vulnerabilities.
- **More attackers is not better attackers.** Distinct lenses catch failure modes; duplicates of one skeptic add volume and noise. Rank by convergence and severity, discard noise.
- **The goal is to strengthen, not destroy.** Present weaknesses constructively with remediation paths.
