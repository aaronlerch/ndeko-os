# Red Team Integration Guide

## Skill Integration Order

**Use BEFORE RedTeam:**
- Web research or a read-only subagent — gather context, find precedents
- `FirstPrinciples` — decompose the claim set before attacking it

**Use DURING RedTeam:**
- The native **Agent** tool — spawn the parallel attackers directly. Give each a distinct lens rather than N identical skeptics; diversity catches failure modes redundancy cannot.
- `Forge` — a cross-vendor second look that does not share Claude's blind spots or its self-preference. Worth one slot on anything publish-bound or irreversible.

**Use AFTER RedTeam:**
- `Science` — turn each surviving objection into a hypothesis with a named falsifier

## FirstPrinciples Integration

RedTeam deeply integrates with FirstPrinciples skill:

- **Decomposition:** `FirstPrinciples/Deconstruct` breaks the argument into its fundamental parts
- **Counter-argument:** `FirstPrinciples/Challenge` classifies constraints as hard/soft/assumption
- **Core Insight:** The most devastating critiques come from challenging hidden assumptions

## Output Format

The output contract lives in `Workflows/ParallelAnalysis.md` → Output contract. Tone: direct, substantive, non-performative — real weaknesses, never nitpicks or strawmen.
