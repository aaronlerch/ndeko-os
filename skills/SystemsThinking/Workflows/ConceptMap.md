# ConceptMap Workflow — SystemsThinking

## Purpose

Build a **concept map** — a visual network of entities and their labeled relationships — to understand a domain's structure. Unlike causal loop diagrams (which model *dynamics*), concept maps model *relationships* and *semantics*. Use them when you're trying to understand "what are the things, and how are they connected?"

Concept maps come from Joseph Novak's work on meaningful learning (Cornell, 1972). The key invariant: every link is a **labeled proposition**, not just an arrow.

## Invocation

- "Concept map"
- "Map the entities"
- "Relationship map"
- "Novak-style mapping"
- Early-stage domain exploration, onboarding docs, architecture overviews, knowledge capture

**Not for:** dynamic behavior (use CausalLoop), incident causation (use RootCauseAnalysis), hierarchical decomposition (use an outline or tree).

## The Structure

```
[CONCEPT A]  ──"contains"──▶  [CONCEPT B]
    │
    │"interacts with"
    ▼
[CONCEPT C]  ──"depends on"──▶  [CONCEPT D]
```

**Components:**
- **Concepts** — nodes, usually nouns or noun phrases, enclosed in boxes
- **Links** — labeled edges, describing the relationship between concepts
- **Propositions** — concept + link + concept reads as a short statement: "Concept A contains Concept B"
- **Cross-links** — links between concepts in different parts of the map, revealing non-obvious connections (these are often the most valuable insights)
- **Hierarchy** — most general concepts at top, specifics at bottom (not strictly required but helpful)

## Execution

### Step 1: Define the Focus Question

Every concept map answers a question. Without the question, the map becomes a disorganized bag of concepts.

```
FOCUS QUESTION: [Specific question the map should answer]
```

Good examples:
- "How does authentication flow through our platform?"
- "What are the components of the Algorithm, and how do they relate?"
- "What does H3 consist of, and how do the pieces depend on each other?"

Bad examples:
- "What is authentication?" (too broad)
- "Show me the auth architecture" (not a question)

### Step 2: List Key Concepts

Extract 10-30 concepts from the domain. Order by generality — most general first, most specific last.

Concepts should be:
- **Nouns or noun phrases** — "User session," "JWT token," "OAuth provider"
- **At roughly similar levels of abstraction** — don't mix "cloud computing" with "HTTP header"
- **Concrete enough to have relationships** — "good architecture" is too vague to map

### Step 3: Draft the Hierarchy

Arrange concepts from general (top) to specific (bottom). This is the **conceptual hierarchy** — it gives the map spatial structure.

If no hierarchy emerges, that's a signal: either the concepts are all at the same level (flat map, no hierarchy needed), or you're missing organizing concepts (add them).

### Step 4: Draw Labeled Links

For each pair of related concepts, draw a link labeled with the relationship. Common link types:

```
"contains", "has", "is a", "is part of"
"uses", "depends on", "requires"
"produces", "creates", "results in"
"triggers", "responds to", "listens for"
"reads from", "writes to"
"authenticates", "authorizes", "validates"
"owns", "manages", "monitors"
"extends", "overrides", "implements"
"precedes", "follows", "parallels"
```

**Every link must form a valid proposition when read concept-link-concept.** If "User session [uses] JWT token" is true, the link is valid.

### Step 5: Find Cross-Links

Cross-links connect concepts in different regions of the map — relationships that aren't obvious from the hierarchy.

Cross-links are **the highest-value output** of concept mapping. They reveal non-obvious relationships, hidden dependencies, and unexpected interactions.

Example cross-link in a software architecture map: between "database connection pool" (bottom of data layer) and "request timeout policy" (middle of application layer). The cross-link "feeds back into" reveals that pool exhaustion affects timeout behavior — non-obvious unless the map is drawn.

### Step 6: Review for Completeness

Check:
- **Focus question answered?** Walk through the map trying to answer the focus question aloud.
- **Propositions make sense?** Read each link triplet; they should form grammatically valid statements.
- **No orphan concepts?** Every concept should have at least one link. Orphans suggest missing relationships.
- **Cross-links present?** If none, you may be missing the valuable non-obvious connections.
- **Appropriate granularity?** 10-30 concepts for most maps. Under 5 is too thin; over 50 is unreadable.

### Step 7: Render

Concept maps benefit enormously from visual rendering. Render as Mermaid (Artifacts draw ```mermaid fences natively; see `artifact-diagramming`): the focus question as the title, one node per concept, every link labeled, cross-links visually distinct.

Mermaid or graphviz both work. Mermaid renders inline in most editors; graphviz produces higher-quality static images.

## Output

```
📊 CONCEPT MAP: [topic]

FOCUS QUESTION: [...]

CONCEPTS (general → specific):
- [C1], [C2], ..., [Cn]

HIERARCHY:
  [C1]
    ├─ [C2]
    │   └─ [C5]
    └─ [C3]
        └─ [C6]

PROPOSITIONS (concept → [link] → concept):
- [C1] → [contains] → [C2]
- [C2] → [uses] → [C5]
- ...

CROSS-LINKS:
- [C5] → [feeds back into] → [C3] — reveals non-obvious dependency
- [C6] → [validates through] → [C2] — hidden validation path

KEY INSIGHTS:
- [Insight from cross-link 1]
- [Insight from cross-link 2]
```

## Worked Example — the Algorithm's evidence loop

```
FOCUS QUESTION: How does the Algorithm turn a goal into proof that the goal was met?

CONCEPTS (general → specific):
- Run (root)
- Goal, Claims, Evidence, Teeth
- Claim, Anti-claim, Probe
- HOOK, CHECK, VerificationGate, [DEFERRED]

PROPOSITIONS:
- Run → [starts from] → Goal (recorded verbatim)
- Goal → [is defined by] → Claims
- Claims → [include] → {Claim, Anti-claim}
- Claim → [names] → Probe (the tool check that would falsify it)
- Probe → [produces] → Evidence
- Evidence → [closes] → Claim
- Teeth → [come in two kinds] → {HOOK, CHECK}
- VerificationGate → [is the HOOK on] → closing a claim without evidence

CROSS-LINKS:
- Probe → [must match the modality of] → Claim (a curl cannot close a browser claim)
- [DEFERRED] → [holds] → Claim (when the probe cannot run yet, with a named follow-up)

INSIGHTS:
- The probe is the hinge: a claim with no probe has no gradient, so the run cannot tell progress from drift.
- There is no self-attestation tier — every claim's teeth are external to the model's own judgment.
```

## Common Mistakes

- **Unlabeled arrows.** An unlabeled arrow is just "somehow related." The label is the entire value.
- **Too many concepts.** Over 30-50 and the map is unreadable. Split into sub-maps by region.
- **Mixed abstraction levels.** "System" and "semicolon" in the same map is confusing. Keep concepts roughly homogeneous in scale.
- **Missing cross-links.** The hierarchy is the scaffolding; cross-links are the insight. A map without cross-links usually missed the interesting relationships.
- **Trying to show causation.** If arrows mean "causes," you want a CausalLoop diagram, not a concept map.
- **Concepts that are verbs.** "Running," "processing," "deploying" are activities, not concepts. Re-noun them: "Deployment," "Processing step."

## When to Use vs. Other Diagrams

| Goal | Diagram |
|------|---------|
| Understand *what things are* and *how they relate* | **Concept Map** |
| Understand *how behavior is generated over time* | CausalLoop |
| Understand *why something happened* | RCA (Fishbone, 5 Whys) |
| Model *hierarchical decomposition* | Tree / outline |
| Model *sequential steps* | Flowchart |
| Model *state transitions* | State diagram |

## Integration

- Feeds **Iceberg** — Layer 3 (structure) often benefits from a concept map of the actors and relationships
- Feeds **CausalLoop** — concepts and relationships from the map inform variables and arrows
- Rendered as Mermaid, Graphviz, or d2 (see Step 7)

## Attribution

Joseph D. Novak, concept map methodology developed at Cornell University (1972), building on David Ausubel's theory of meaningful learning. Canonical reference: *Learning How to Learn* (Novak & Gowin, 1984). Modern software: CmapTools (IHMC), Miro, d2, Mermaid.
