# Explore Workflow — Iterative Depth

## Purpose

Run N structured exploration passes over the same problem, each from a different lens, to produce a richer claim set than single-pass analysis does.

## Invocation

1. **Directly**: "use iterative depth on this problem"
2. **Before writing claims** on substantial work, when a missed requirement would be expensive
3. **By other skills** that need deeper requirement extraction

## Inputs

- **Problem/Request:** the original request or problem statement, verbatim
- **Context:** conversation history, codebase state, prior work
- **Depth:** a lens count the person named, otherwise read off the work

## Execution

### Step 1: Choose depth

- **2 lenses (Fast):** Literal + Failure — a quick check on modest work.
- **4 lenses:** Literal + Stakeholder + Failure + Experiential — the usual choice for substantial work.
- **8 lenses:** all of them — high blast radius or genuinely novel work.
- A number the person gave wins (2-8).

### Step 2: Load lenses

Read `TheLenses.md` for the lens definitions used this run.

For domain-specific tasks, reorder:
- Security tasks: Failure, Stakeholder, Temporal, Constraint Inversion
- UX tasks: Experiential, Stakeholder, Literal, Analogical
- Architecture tasks: Temporal, Constraint Inversion, Analogical, Meta
- Ambiguous requests: Meta, Stakeholder, Literal, Failure

### Step 3: Run the passes

Each pass explores the problem only through its lens and records:

```
🔍 ITERATIVE DEPTH — Pass {i}/{N}: {LENS_NAME}
Lens question: "{the lens's core question}"

Findings:
- [finding — candidate claim]
- [finding — refinement of an existing claim]

Claims:
+ C{n}: [new claim] — probe: [the tool check that would falsify it]
~ C{m}: [refined claim, was X, now Y]
+ A{n}: [new anti-claim: what must not happen]
```

At 2 lenses, run both inline. At 4 or more, the later lenses can run as parallel read-only subagents; give each the problem, its lens definition, the claims found so far, and ask for 2-5 new claims or refinements from its lens only.

### Step 4: Synthesize

1. **Deduplicate** claims that are semantically identical across lenses.
2. **Merge refinements** to the same claim, keeping the most specific version.
3. **Prioritize** by how many lenses surfaced a claim (consensus = high priority).
4. **Check every claim names its probe.** A claim with no falsifying tool check is not done yet.

## Output Format

```
🔍 ITERATIVE DEPTH COMPLETE ({N} lenses applied)

Lenses used: {list}
New claims: {count} · Refined: {count} · Anti-claims: {count}

NEW CLAIMS
- C{n}: [claim] — probe: [check]

REFINED CLAIMS
- C{m}: [was → now, and why]

ANTI-CLAIMS
- A{n}: [what must not happen] — probe: [check]

💡 Key insight: [the most surprising finding — what single-pass analysis would have missed]
```

The claims feed straight into the run's done-definition (`~/.claude/algorithm/LATEST`); standalone, present them to the person.
