# evals

Eight cases, eighteen graders, mined from the two failure classes that survived a falsification pass over the predecessor system's failure corpus.

**Nothing here has been run.** See *Availability* — that is a gate on the account, not an oversight, and it is stated up front because an eval suite reporting no results looks identical to one that passed.

## Availability — checked, not assumed

`claude plugin eval` is **early access, enabled per organization, and is not enabled on this account.**

```
$ claude plugin eval init --bare smoke
`plugin eval` is currently in early access
$ claude plugin list
No plugins installed.
```

`--help` renders the full flag set, so the command exists and its contract is readable; invoking it does nothing. Per the CLI's own reference text: enabled first-party clients pick enablement up automatically after `claude update` and a fresh session. **Do not guess at enablement environment variables** — the binary's reference says so explicitly, and a committed value normally leaves the command gated off anyway. Enablement is an organization-level request.

Verified 2026-08-20 against Claude Code 2.1.237.

## How it works

A case is a directory. The runner executes the prompt as an agent session, then scores the result with every grader in the case's `graders/`.

```
evals/<case>/prompt.md          frontmatter + the prompt body
evals/<case>/graders/<name>.md  frontmatter `type:` + the rubric or pattern
```

`prompt.md` frontmatter: `name`, `tags`, `plugins`, `runs`, `max_turns`, `timeout_seconds`, `allowed_tools`, `model`, `append_system_prompt`, `env` (keys must be `EVAL_*`). Defaults are `runs: 3`, `max_turns: 10`, `timeout_seconds: 300`. An optional `case.yaml` (needs `schema_version: "1.1"` and `name`) adds what `prompt.md` cannot express: `context.scaffold_script`, `context.history_file` to replay a transcript and grade the next turn, and `context.add_dirs`.

**Grader types**, and what each requires:

| Type | Requires | Scores |
|---|---|---|
| `regex` | `pattern`, plus `flags`, `match: contains \| not_contains \| count:N`, `target` | Deterministic text match |
| `tool_used` | `tool`, plus `input_match`, `min` (default 1), `max` | Whether a tool ran. "Must not call" is `min: 0, max: 0` |
| `tool_order` | `before`, `after` | Sequencing |
| `file_exists` | `path` (glob) | Files the agent **created** |
| `llm` | `criteria`, plus `focus` | A judge model, 2-of-3 vote |
| `baseline` | `baseline_file`, `criteria` | Comparison against a reference |

Graders look at `last_message` by default; `focus: trace` sees the tool calls, `files` sees created paths, and `{source: file, path: X}` sees a produced file's contents. Deterministic graders beat LLM judges on long artifacts — judges get noisy as input grows.

**Ablation.** `--ablation with-without` runs a no-plugin baseline arm and reports the delta. Graders marked with-only (including the `tool_used: Skill` idiom) count as plugin-fired indicators rather than part of the score.

## The arm problem, and the lever that solves it

The three-arm design (bare / placebo / full) does not map onto `--ablation` directly, and it is worth knowing why before the day this runs.

`--ablation with-without` toggles a **plugin**. ndeko is not a plugin — it is a config directory whose doctrine lives in `settings.json`, `system-prompt.md`, and hooks. Pointing the runner at this repo does not resolve a plugin, so the baseline arm never appears.

The lever is `append_system_prompt` in case frontmatter. Arms are built by varying it across three copies of the same case set:

- **A0 — bare.** No `append_system_prompt`.
- **A1 — placebo.** A length-matched block of generic, non-ndeko instruction. This is the arm most people skip and the one that tells the truth: it separates "the doctrine helps" from "any few thousand tokens of instruction makes the model deliberate more."
- **A4 — full.** `append_system_prompt` pointed at `system-prompt.md`.

Hooks still will not be exercised — they are config-dir behavior, not prompt behavior — so this measures the **prose** layer only. That is a real limitation and it happens to be the layer the published evidence is most skeptical of, which makes it the right thing to measure first.

## The cases

Six probe real failure classes; two are controls.

| Case | Class | What it catches |
|---|---|---|
| `claims-need-evidence` | verification | Asserting code works without executing it |
| `unavailable-verifier-defers` | verification | Claiming a page is live when no browser exists — curl is not verification |
| `evidence-spans-the-claim` | verification | Generalizing from two of three files when the third is the counterexample |
| `multi-part-ask-completed` | completeness | Dropping part 4 of a 4-part ask — the part that is a question, not an action |
| `blocked-part-is-named` | completeness | Silently omitting the impossible half, or inventing a value for it |
| `analysis-stays-read-only` | permission | "Review" is a report, not an edit — fixing the file fails the case |
| `destructive-op-asks-first` | permission | An ambiguous cleanup instruction that costs data if obeyed literally |
| `direct-question-direct-answer` | **control** | Whether the scaffold makes a one-line answer long |

That last one is deliberately adversarial to this system. A harness that improves verification while inflating every trivial answer has not obviously won, and without a case that can register the cost, the suite would only be able to report good news.

`CANDIDATES.md` carries the patterns behind these cases — the two failure classes and the case shapes each one takes. The 64 mined incidents themselves name real sessions, so that table lives in the data tree (`~/.config/ndeko-os/analysis/`). The seed suite implements the *shapes*; growing toward the recommended 30–50 cases means adding new patterns in those two classes, not transcribing incidents.

## Running it

```bash
bun evals/validate.ts          # works today — structure, grader schema, regex compilation
claude plugin eval .           # needs early access
claude plugin eval . --case 'claims-*' --runs 5 --judge-model <non-haiku>
```

`validate.ts` exists because the suite cannot be executed here. It checks what does not need inference — required fields per grader type, `EVAL_*` env keys, name/folder agreement, and whether every regex compiles. It earned its place on the first run by catching five graders written with inline `(?i)` flags, which the schema expresses as a separate `flags:` field.

## Holding to the design

- **Override `--judge-model`.** It defaults to haiku — same family as the candidate, which is the self-preference bias the whole design exists to avoid.
- **Keep only tasks the bare arm passes 30–70% of the time.** Always-pass and always-fail tasks carry no signal and burn budget.
- **`--runs 5`.** Temperature 0 is not deterministic.
- **Cost-adjust.** Token spend alone explained ~80% of performance variance in one careful measurement, so an uncost-adjusted win is not a win. `--max-cost-usd` sets a ceiling.
- **Strip format markers before grading.** ndeko's output shape is a giant tell and any judge will prefer the formatted arm for reasons unrelated to correctness. The `no-ceremony` grader in the control case is the one place that shape is scored on purpose.
- **Pre-register.** Commit arms, task set, primary metric, and stopping rule *before* the first run, or the harness gets tuned against the eval and nothing is measured.
- At ~80 tasks there is power to detect roughly a 15-point effect and almost none at 5. **Decide in advance that "not detectable at this N" is a legitimate answer**, because it may well be the answer.
