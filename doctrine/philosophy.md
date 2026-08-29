# Why ndeko is shaped this way

> Load when explaining the system, or **before re-adding something that was deliberately removed.** That second case is the real purpose of this file: it records what was cut and why, so a future session doesn't rebuild it from first principles and call that progress.

## The one idea

Every task is a move from a current state to the state someone actually wanted. The hard part is not the move — it is knowing you arrived. So the system is organized around **claims that name their own falsifier**: write down what done means as things a tool can check, then close each one on evidence.

Without a probe there is no gradient. You cannot tell uphill from downhill, so you cannot climb. That single sentence explains most of the design.

## What this adds over the bare harness

Two things, and it is worth being precise because the answer is small:

1. **A durable sense of what Aaron is driving at.** `~/.config/ndeko-os/goals.md` and `~/.config/ndeko-os/identity/`. The harness has per-session goal conditions but nothing persistent.
2. **An opinionated way to run work against it.** `~/.claude/algorithm/`.

Everything else — permissions, memory, observability, checkpointing, cross-machine safety, hook lifecycle — **ships in the harness.** ndeko configures those; it does not implement them. Any future addition should be checked against that list first.

## Prompting: state the outcome, not the procedure

Every prompt written here — a skill, an agent brief, a delegate task — states what done looks like as testable outcomes, names the constraints, hands over good tools, and then trusts the model to find how.

Dictating execution steps or reasoning choreography ("first analyze X, then consider Y, then decide Z") caps a capable model below its ability and rots as models improve. Precision goes *up*, not down: stating the outcome is more specific about what matters, never vaguer.

**Four classes of "how" are legitimate and never get cut:**

- **Safety gates** — confirmation, destructive-op guards, approvals.
- **Verified gotchas** — a documented non-obvious failure the model would otherwise hit. **These require dated provenance, or they are just methodology wearing a badge.**
- **Tool contracts** — exact CLI syntax, API parameters, paths, deterministic recipes.
- **Output-format contracts** — the required shape of a deliverable.

Deterministic code is exempt; it *is* the contract.

## What was cut, and the evidence

Recorded so it stays cut, or gets re-added for a better reason than "it seems useful."

**Effort tiers, mode classification, and the phase walk.** A five-tier system with per-tier floors and a prompt classifier. Cut because spend is discoverable from the work and its evidence gates, while a rubric predicts it before anything is known. The predecessor retired its own version of this after finding it added ceremony without adding judgment.

**Self-attested claims.** The predecessor's doctrine had a third teeth tier for things the model asserts about its own conduct. Its own disk measured the outcome: hundreds of captured failures yielded a single distillation — and an open-coding pass over that corpus found a large share of the captures were artifacts or not failures at all, with the largest class refuted by its own transcripts. An unverified capture pipeline is worse than none: it produces confident false data. The published literature agrees — a loop that grades itself runs, looks healthy, and at equal token cost loses to simply sampling more. Two items that would otherwise be claims (spend calibration, frame drift) live in the system prompt as guidance instead, because guidance I might fail to follow is honest and a claim I grade myself is theater.

**A custom memory engine, retrieval index, and consolidation daemon.** Cut because the harness ships all three, and because the predecessor's own policy file reads `"no-index-v1"` — a deliberate architectural decision, not a gap. Files stay the source of truth; that part was right and is where the vendors independently landed.

**An elaborate output-format contract.** Three templates with per-mode field scaffolding and a mandatory-compliance section. Cut to one shape, because format was measurably the largest confound in comparing scaffolded output to bare output — any grader prefers the formatted one for reasons unrelated to correctness.

**A dashboard daemon, voice announcements, and a custom observability transport.** Cut because the harness emits 20 native instruments over OTLP, and because notification research is blunt: 2–5% of alerts are actionable, and if a human cannot act within 15–30 minutes in a way that changes the outcome, it is a log line and a digest, not an interruption.

**Ambient/continuous capture.** Cut on market evidence rather than taste: the best-capitalized attempt in the category was acquired, its capture switched off, and its service withdrawn from several jurisdictions entirely. Ambient context comes from artifacts already produced — meeting notes, tickets, commits, calendar.

**A 23-file goal taxonomy.** Replaced by one `goals.md`. The sharpest published criticism of the predecessor was that a plain goals file gets most of the benefit for a fraction of the setup, and the live install proved the point: 21 of 23 files untouched in two and a half months, 12 still carrying unfilled placeholders.

## The honest limit

None of the above was measured on Aaron's own work. It rests on published evidence about harnesses in general, a survey of what this harness ships, and an audit of what was dead in the predecessor.

That is why the cuts are the right call anyway: **every deletion is reversible from git in minutes, and each one also removes maintenance burden.** If a cut turns out to matter, it will be felt within a week and restored. The reverse — carrying scaffolding indefinitely because removing it feels risky — has no such correction.

The proper settlement is an ablation: bare model, a length-matched placebo, and the full harness, over tasks mined from real work, cost-adjusted and blind-graded. `~/.claude/evals/` exists for that, and `claude plugin eval` runs cases against a no-plugin baseline arm natively.
