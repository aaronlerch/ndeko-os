# docs

The seven research reports this system was designed from. Not doctrine — doctrine lives in `algorithm/`, `doctrine/`, `system-prompt.md`, and `CLAUDE.md`, and those files win on conflict.

They are kept because they answer *why a decision was made*, which the doctrine files deliberately do not: those state the rule and move on. When a rule here looks arbitrary, the reasoning is usually in one of these.

## The reports

All seven were produced 2026-08-16 → 2026-08-17 by parallel research agents, each on one topic, each instructed to carry a URL for every substantive claim.

| Report | Core finding |
|---|---|
| [`guardrails-and-safety-gates.md`](research/guardrails-and-safety-gates.md) | In-band defenses (classifiers, "detect the injection") are provably breakable under adaptive attack; out-of-band ones (deterministic reference monitors, taint, sandboxes) are the only load-bearing kind |
| [`memory-systems.md`](research/memory-systems.md) | Both major coding-agent vendors converged on files-on-a-filesystem; the real attacks on that design are provenance, concurrency, and semantic recall — not whether files work |
| [`self-improving-systems.md`](research/self-improving-systems.md) | Evolve the context, not the weights, and gate every change on an external verifier. Reflection without a verifier does nothing on its own |
| [`eval-methodology.md`](research/eval-methodology.md) | Harness effects are large, but they live in plumbing rather than prose — and a solo operator running <100 tasks once per arm learns essentially nothing |
| [`observability-and-evaluation.md`](research/observability-and-evaluation.md) | The 2026 stack is OTLP spans + evals attached to spans + cost as a first-class attribute; almost nothing commercial is priced or designed for n=1 |
| [`harness-landscape.md`](research/harness-landscape.md) | Star counts, licensing traps, and the two criticisms of the predecessor that drove the rebuild: maintenance burden, and subscription-as-unmetered-backend |
| [`harness-native-capabilities.md`](research/harness-native-capabilities.md) | What Claude Code ships natively, read out of the binary rather than the docs — 31 hook events, not the 10 the embedded doc table claims |

## How to read these

**They are dated, not maintained.** Every number, star count, price, and version is as-of mid-August 2026 and is now stale by construction. `harness-native-capabilities.md` was read against Claude Code 2.1.233 and the binary has moved since. Treat the whole directory as a primary source with a timestamp: good for *why a decision was made*, never as current fact.

**Sourcing tiers were declared by the authors** and are preserved: `[P]` peer-reviewed · `[PP]` preprint · `[B]` blog/vendor · `[V]` verified directly this session · `[S]` search snippet · `[K]` prior knowledge · `[M]` vendor marketing. Claims are agent-sourced with URLs and were not independently re-verified. Spot-check before acting on any specific number.

**Personal data was scrubbed on capture** — absolute home paths, employer and customer identifiers, scratchpad paths. The reports are method and market landscape, which is why they belong in this tree at all; anything that identified a person or a client was removed rather than carried across the privacy boundary.
