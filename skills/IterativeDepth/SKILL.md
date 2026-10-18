---
name: IterativeDepth
description: "Structured multi-angle exploration that runs 2-8 sequential passes through the same problem, each from a systematically different scientific lens, to surface requirements and edge cases invisible from any single angle. Grounded in 20 established techniques across cognitive science (Hermeneutic Circle, Triangulation), AI/ML (Self-Consistency, Ensemble Methods), requirements engineering (Viewpoint-Oriented RE), and design thinking (Six Thinking Hats, Causal Layered Analysis). Each pass outputs new requirements or edge cases; passes stop when yields repeat. A 4-lens pass routinely discovers 30-50% more criteria than direct analysis. Single workflow: Workflows/Explore.md (supports Fast mode with 2 lenses for quick depth). Reference files: ScientificFoundation.md (research grounding for all 20 techniques), TheLenses.md (full definitions for all 8 lenses). BPE-fragile — quarterly test recommended. NOT FOR scope/zoom analysis (use ApertureOscillation) or hypothesis-test cycles (use Science). USE WHEN iterative depth, explore deeper, multi-angle analysis, multiple perspectives, surface hidden requirements, all angles, blind spot check, deep dive before building, what am I missing, quick depth, fast angles."
effort: high
---

# IterativeDepth

**Structured multi-angle exploration of the same problem, so the claims that define done are complete before building starts.**

Grounded in 20 established scientific techniques across cognitive science (Hermeneutic Circle, Triangulation), AI/ML (Self-Consistency, Ensemble Methods), requirements engineering (Viewpoint-Oriented RE), and design thinking (Six Thinking Hats, Causal Layered Analysis).

## Core Concept

Instead of analyzing a problem once, run 2-8 structured passes through the same problem, each from a systematically different **lens**. Each pass surfaces requirements, edge cases, and failure modes invisible from the other angles. The combination yields a claim set no single pass could produce.

## Use / Win

**When to use:** before writing the claims for work where a missed requirement is expensive — the Algorithm's step of writing done down before building (`~/.claude/algorithm/LATEST`) is where this pays off.

Concrete triggers:
- **Deep analysis of what's actually being asked** — the request says X; what is the person trying to accomplish? Single-pass reverse engineering catches the obvious. IterativeDepth catches the rest.
- **Different angles of approach** — before committing to an approach, look from stakeholder, failure, temporal, experiential, and constraint-inversion angles. The right approach often only becomes obvious after 3-4 directions.
- **Important or critical tasks** — high blast radius makes a missed dimension far costlier than a few extra minutes of analysis.
- **Tasks never done before** — novel work has the highest density of hidden requirements.

**What you win:**
- **Claims single-pass analysis cannot produce,** including anti-claims (what must not happen). A 4-lens pass routinely discovers 30-50% more criteria than direct analysis.
- **Blind spots found before the build, not halfway through it.** Rework from a missed requirement costs far more than the upfront pass.
- **Approach clarity.** Failure, stakeholder, and constraint-inversion angles often show the obvious approach is wrong.

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| "iterative depth", "explore deeper", "multi-angle" | `Workflows/Explore.md` |
| "quick depth", "fast angles" | `Workflows/Explore.md` (Fast mode: 2 lenses) |

## Quick Reference

- **8 Lenses** available; use 2-8, scaled to how much a miss would cost
- **Each lens** is a structurally different exploration angle
- **Output** is new or refined claims per pass, each naming the probe that would falsify it

**Full Documentation:**
- Scientific grounding: `ScientificFoundation.md`
- Lens definitions: `TheLenses.md`

## Gotchas

- **2-8 lens passes, not infinite.** Diminishing returns after ~5 passes for most topics.
- **Each pass should surface genuinely NEW requirements, not restate previous findings.** If passes start repeating, stop early.
- **This is a BPE-fragile skill.** Monitor whether smarter models make it unnecessary. Quarterly test recommended.

## Examples

**Example 1: Surface hidden requirements**
```
User: "use iterative depth on this API redesign"
→ Pass 1: Functional requirements
→ Pass 2: Security implications
→ Pass 3: Performance constraints
→ Pass 4: Backward compatibility
→ Each pass surfaces new requirements missed by previous
```
