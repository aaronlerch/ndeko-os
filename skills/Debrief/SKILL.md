---
name: debrief
description: Interrogate a finished non-trivial implementation and produce the full account of it — what it is and how it works in plain English, the decisions made, what was deferred, what is still open, how it holds up against the repo's own stated invariants, what you would otherwise never think to ask, and what the repo's docs and instructions should learn from the build. Delivered as an interactive review page the reader dispositions and submits. USE WHEN debrief, recap, post-build, explain what you did, walk me through what you built, what decisions did you make, what did you defer, what's left, what did I miss, how does this hold up, retro this feature, interrogate this build. NOT FOR reviewing a diff for bugs (use /code-review) or auditing one invariant in isolation (use that invariant's own skill).
argument-hint: "[optional: PR number, git ref range, or feature name]"
---

# /debrief

Runs after a non-trivial implementation lands. Turns a build into a complete
account of it, written for someone who did **not** watch it happen — including
the reader who *did* and has already forgotten half of it.

The point is that nothing depends on the reader remembering to ask. Every
question below gets answered every time, including the ones nobody thinks of
until it is too late.

Arguments: `$ARGUMENTS`

## Step 0 — which install is this? Do this before anything else.

A repo that carries its own debrief skill is the authority inside itself: it
knows that codebase's gate runner, its architecture invariants, its audit
skills, and where follow-ups get filed.

```bash
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$ROOT" ] && [ -f "$ROOT/.claude/skills/debrief/SKILL.md" ] && echo "PROJECT: $ROOT"
```

**If that prints a path, read `$ROOT/.claude/skills/debrief/SKILL.md` and follow
it instead of the rest of this file. Stop here.** Personal skills take
precedence over project ones, so this file is what gets invoked inside such a
repo — and that precedence is backwards for this tool. Delegating is how the
project's own skill wins anyway.

Everything below applies only when there is no project install.

## The contract — what a finished debrief looks like

- **Every claim traces to evidence** — the diff, a file, a command's output, or
  a doc. Not to the conversation's memory of itself. That memory is lossy and
  systematically flattering; the tree is neither.
- **Sections 1 and 2 are plain English.** No jargon, no acronyms, no type
  names, no file paths in the prose. Detailed, but a smart non-specialist
  should follow it end to end.
- **Uncertainty is stated, never smoothed.** "I don't know whether X" is a
  valid line. A confident guess in its place is the failure this skill exists
  to prevent.
- **Nothing is invented to fill a heading.** An empty section says "none" and
  that is a real answer. A retro that always produces edits is producing noise.
- **No self-assessment.** Describe what exists; don't grade it.

## 1 — Scope it from evidence, not from memory

Resolve the target from `$ARGUMENTS`: a PR number (`gh pr diff <n>`), a ref
range, a feature name (match against the repo's plan or design-doc directory),
or nothing — in which case the default is the branch against its base:

```bash
BASE="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)"
git diff "$(git merge-base "$BASE" HEAD)"...HEAD    # committed work on this branch
git diff HEAD                                       # plus anything uncommitted
```

Then read, before writing a single line of the report:

- the **full diff** — bucket it by area (by top-level directory, by package,
  by layer) and read the buckets rather than skimming a large one;
- the **plan or design doc**, if the repo keeps them and one matches — the
  delta between what it said and what the tree contains is the richest source
  for sections 3, 4 and 5;
- the **PR body**, if there is one.

Open the report with a one-line scope statement naming the range and the file
count. If you did not build this yourself, say so — the decisions section then
becomes inference and must be marked as such.

## 2 — Run the repo's own evidence

**Find the checks the repo already runs; run those.** They are the only gates
whose result is a fact about this codebase rather than an opinion about it.
Look in this order and stop when you have the set:

- the repo's always-loaded instructions — `AGENTS.md`, `CLAUDE.md`,
  `CONTRIBUTING.md` — which usually name the runner directly;
- `package.json` scripts, `Makefile`, `justfile`, `Taskfile`, `noxfile`,
  `pyproject.toml`;
- the CI workflow (`.github/workflows/**`, `.gitlab-ci.yml`) — what CI runs on
  a pull request is the definitive list;
- the pre-commit config (`lefthook.yml`, `.pre-commit-config.yaml`, `husky`).

Run them and report each exit status as fact. Typecheck, lint, tests, and any
bespoke contract or conformance validators the repo has built for itself.

**A runner scoped to uncommitted changes is a no-op on a clean tree.** Pre-commit
style runners answer "would committing my changes pass?", and a debrief usually
runs after everything is committed — so it prints nothing and exits 0. That is
not evidence for the branch. When a runner reports no files in scope, run the
underlying checks against the committed work directly.

Never assert a conformance the gates could have proven while you skipped running
them, and name any check you could not run along with the reason.

## 3 — Scan for what you were not going to report

Grep the diff itself for the deferrals you drifted into rather than decided:

`TODO` · `FIXME` · `HACK` · `XXX` · skipped or exclusive tests (`.skip(`,
`.only(`, `@pytest.mark.skip`) · suppressions (`: any`, `@ts-expect-error`,
`eslint-disable`, `# type: ignore`, `#nosec`, `nolint`) · debug output
(`console.log`, `print(`, `dbg!`) · commented-out blocks · hardcoded ids, URLs,
paths, or tenant values · placeholder fallbacks (`?? "…"`, `or "default"`)

Every hit is a candidate for §4 or §5. The deferrals you remember are the ones
you chose deliberately; these are the other kind, and they are the ones that
surprise someone in production.

## 4 — Delegate the invariant audits the diff earns

List the repo's own skills and run the ones whose scope the diff actually
touches, read-only:

```bash
ls "$ROOT/.claude/skills/" 2>/dev/null
```

A repo that has built a skill for one of its invariants has already decided that
invariant is worth checking mechanically. Fold their findings into §6 and do not
restate their rules here. With no such skills, §6 is entirely a reading exercise.

---

# The report

Eight sections, this order, every time. They are written into the **review
page** (see "Delivering it"), not into the conversation.

### 1. What this is — plain English

What can a person do now that they could not do before, and why does that
matter? Name the user — an end user, an internal operator, a background job. No
implementation language at all.

### 2. How it works — the walk-through

Trace one real request or one real run end to end: what triggers it, what
happens in what order, where data lands, what the person sees, what happens on
failure. Still plain English — describe the moving parts by what they do, not
by what they are called. A diagram if it genuinely helps.

Then a short second pass naming the actual files and boundaries, for the reader
who wants to go look.

### 3. Decisions made

Every choice that was not explicitly specified. One item per decision, with
`data-kind="decision"`, carrying: what I chose, what I didn't, why, and
reversibility — `cheap` / `costly` / `one-way`.

Glyph `DECISION` for an ordinary one, `LOCK` for a one-way one, `WARN` for one
the reader should weigh in on. Reversibility is what tells them which rows they
actually have to rule on; surface the `one-way` ones in the section's lede too.

Include decisions that felt obvious at the time. Those are the ones nobody
remembers making and everybody later assumes were deliberate.

**Two groups, in this order, always.** The complete list is the record; the
reader's time is the constraint. So the section opens with **Needs your call**
— every `WARN` and `LOCK` row — and folds the rest under a `<details>` headed
**Ratify by default (N)**, where `Keep` is the stated default reading. The
lede names both counts and says why the total is what it is (a build that logs
every unspecified choice produces dozens; that is the method working, not
noise to apologise for). A decision goes in the first group only if the
reader's answer would change what happens next — a product call, a one-way
door, a follow-up they must own, a gap someone else has to fill. Cheap,
conventional, reversible choices stay folded however many there are.
*(2026-09-14: a 98-decision debrief shipped as one flat list and the first
question back was "how can there be 98 decisions?" — the count was right; the
ordering hid the ten that mattered.)*

### 4. Deferred

What was intentionally left out, and — for each — **the trigger that makes it
necessary**: the scale, the customer, the feature, the date. A deferral with no
trigger is an open item pretending to be a plan.

One item each, two kinds:

- **Deferred** — decided, scoped, understood. Glyph `DEFER`.
- **Drifted** — found by the §3 scan. Shortcuts, stubs, suppressions, missing
  tests, hardcoded values. Not decided, just done. Glyph `WARN`.

### 5. Open items

Things that need a decision or an owner before this is finished. One item each,
with `data-answer` so the box opens, carrying: who decides, what is blocked
until then, and whether it blocks the next release.

Glyph `LOCK` when it blocks the release, `WARN` otherwise. This is the list
their answers land on first.

### 6. Conformance — how it holds up against this repo's rules

**Derive the invariant list from the repo, not from a checklist you brought
with you.** Read its always-loaded instructions (`AGENTS.md`, `CLAUDE.md`,
`CONTRIBUTING.md`) and its architecture docs — ADRs, `docs/`, design
principles — and pull out the rules that **apply to this diff**. Then walk only
those.

Two halves:

**Gated** — answered by §2's exit status. One chip per gate in the gate strip;
report it, don't re-derive it.

**Ungated** — no validator exists, so these require reading. One table row per
applicable invariant: invariant, what the diff does, where the rule lives; an
item, when the verdict needs a disposition. **Cite the doc, never restate the
rule** — a copied rule drifts from its source and then confidently contradicts
it.

These classes are where ungated invariants usually live, as a prompt for the
read rather than a list to answer: tenancy and authorization · data migration
reversibility and destructiveness · layering and module boundaries · async work
and job patterns · configuration and secrets · logging, metrics and provenance ·
public API and backwards compatibility · query and injection safety · design
system and component boundaries · customer-facing vocabulary · test conventions.

Where the code and a documented pattern disagree, **say which one is wrong** —
the code, or the doc. That verdict is the input to §8; leaving it as "there is a
discrepancy" wastes the finding.

### 7. What you'd have to know to ask

The catch-all, and the section that most repays effort — everything a reader
would need to already suspect in order to ask about it. One item per bullet
below — glyph `WARN` for a real risk, `OK` for "none, checked", `UNKNOWN` for
unmeasured — with the detail in the item rather than in prose. Work the list:

- **Blast radius** — what existing behavior this change can reach, and what
  breaks if it is wrong in production.
- **Data risk** — is any migration destructive, is a backfill implied, is
  anything irreversible once deployed.
- **Security and access exposure** — what a user could reach that they could
  not before.
- **Cost and load** — spend, query volume, job runtime, third-party API quota.
  Name the number if you have it and say "unmeasured" if you don't.
- **Surprises** — anything found in the existing codebase while building that
  contradicts what we believed was true.
- **False assumptions** — anything a reader of the code or the docs would
  reasonably assume that is now not true.

If a bullet genuinely has nothing, write "none". Do not manufacture a risk to
look thorough, and do not write "nothing" across the whole section because it
is late — this is where the expensive misses live.

### 8. Retrospective — what the repo should learn

The feedback loop. One item per proposed edit — glyph `NOTE`, carrying bucket,
file and section, and the specific edit — across three buckets, where **naming
the right bucket matters more than producing an artifact**:

**a. Docs that are now wrong or incomplete.** The build changed the truth. Name
the file, the section, and the specific edit — not "should be updated".

**b. Rules that were right but weren't followed, or were found too late.** This
is a *placement* problem, not a content problem. The fix is moving the rule to
where it would have been seen: the always-loaded instructions if it must be in
context every time, a skill if it applies to one kind of work, a doc if it is
reference. Adding more prose to a file nobody read at the right moment fixes
nothing.

**c. Rules that should stop being prose and become gates.** The highest-value
output here. Anything caught by review in this build that a validator could
have caught mechanically — a lint rule, a structural (`ast-grep`) check, a test,
a CI step. Match whatever mechanism the repo already uses for its existing
gates rather than introducing a new one.

**The bar:** propose a change only where something concrete went wrong in *this*
build. If nothing did, say nothing warranted a change. Resist the pull to
produce a visible artifact.

---

## Delivering it — the review page

The report goes into an **interactive review page**, published as an Artifact.
The reader reads it there, dispositions every actionable row, answers the open
questions, and submits; you read the responses back and act on them. The
terminal gets the link and a header, never the report.

### Build and publish

`review-page.html` in this skill's directory is the page. Copy it to the
scratchpad and change the three things its header comment names — the command
bar and scope line, the eight sections as ordinary HTML, and one
`<div class="item">` per actionable row. The script supplies the controls,
the autosave, the progress meter and the submit.

**Every actionable row carries a stable id** — `d`/`f`/`o`/`c`/`r`/`t` by
section, numbered once and kept across every republish. The id is the join
between an answer and the row it belongs to; renumbering reattaches an answer
to a different item, silently.

Which rows become items: every §3 decision, every §4 deferral and drift, every
§5 open item (add `data-answer` so its box opens for the answer), every §6
finding that is not a clean pass, every §7 row carrying a real risk, every §8
proposed edit. §1, §2, the gate strip and the invariant tables are read rather
than dispositioned — they stay prose and tables.

`data-glyph` carries the status vocabulary, rendered as a chip and an edge
stripe: `OK` holds or conforms · `WARN` a caveat, a risk worth reading, or a
decision needed · `BAD` broken, violated, a gate failure · `DEFER` deferred
with a named trigger · `LOCK` one-way, irreversible, blocks the release ·
`UNKNOWN` unverified, "I don't know whether X" · `DECISION` a choice that was
made · `NOTE` a doc or rule edit. Reserve `BAD` and `LOCK` for what is actually
broken and actually one-way — a page of red is as unskimmable as a page of none.

Publish with `capabilities: {db: {}}` — the page cannot save a response without
it — plus a favicon and a one-sentence description.

### What the terminal gets

The link, plus what would be worse to make him open the page for: one paragraph
of what this is, the gate results as fact, the item count, and any `BAD` or
`LOCK` that should stop him before he reads anything else.

### Reading the responses back

He says when he has submitted. Then `read_db` the `responses` collection and
the `meta/submission` doc — `submittedAt` is the handoff, and rows move under
him until it appears.

| Disposition | What you do |
|---|---|
| **Do now** | Implement it in this session. Group them and start. |
| **Queue** | Batch and route — a project skill for filing follow-ups if the repo has one, otherwise the issue tracker via `/McpShim`. External writes: ask once, then report the URLs. |
| **Drop** | Closed for good. It stays out of any later debrief of this build. |
| **Discuss** | Answer in the conversation *and* write the answer back into the page. |
| **Keep** | The decision is ratified. Nothing to do. |
| **Change** | A `Do now` on the decision itself; his note says what he wants instead. |

A row carrying a note with no disposition is a question. Answer it.

### Answering in place

Republish the same file path, which keeps the URL and everything he wrote.
Under each row he asked about, add the reply inside `.item-body`:

```html
<div class="reply"><b>Ndeko</b><p>…</p></div>
```

Leave `capabilities` off the republish — it carries the stored declaration
forward. A later session reaches the page through the Artifact tool's `url`
(read it first, then publish to it) rather than starting a second one.

If the repo keeps plans or design docs and one matches, offer to write a
sibling `<plan-name>-debrief.md` next to it once he has submitted, so the
committed record carries his dispositions and not just the report. Don't write
it unasked.

## Gotchas

- **The conversation is not evidence.** Re-read the diff even when you wrote
  every line of it. What you remember doing and what is in the tree diverge, and
  catching that divergence is most of this skill's value.
- **Green gates are not conformance.** Most invariants in §6 have no validator —
  that is exactly why they are listed there.
- **Cite the doc; never copy the rule.** A copied rule drifts from its source
  and then confidently contradicts it.
- **"None" is an answer.** Padding a section to look thorough costs the reader
  their trust in the sections that matter.
- **Long diffs get bucketed, not skimmed.** Read each package or layer as a
  separate pass; a skim produces a debrief that reads complete and is not.
- **Parallel content stays dense.** Decisions, deferrals, open items, risks and
  retro edits are items with a definition list inside; invariants, gate results
  and file inventories stay tables. Bullet lists of parallel things are the
  shape Aaron asked to be rid of (2026-09-02), and the page keeps that bar.
- **A published page is not a submitted one.** The report existing at a URL
  proves nothing about his dispositions. `meta/submission.submittedAt` is the
  only evidence the round-trip closed; until it exists, act on nothing.

## The two copies of the page

`review-page.html` is byte-identical to the copy in a project install that has
one, and `diff` is the whole sync mechanism. Change one, mirror it to the other
in the same session — a template that silently forks produces two review pages
whose ids mean different things.
