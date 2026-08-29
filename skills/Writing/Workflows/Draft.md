# Draft as Aaron

Producing text that goes out under his name.

## Before writing a word

**1. Name the channel and read its profile in full.** `~/.config/ndeko-os/identity/voice/<channel>.md`. Read the file — the profiles hold the measured detail (lengths, greeting and sign-off shape, punctuation, structural habits) and this repo deliberately holds none of it. If the channel is ambiguous, ask — a Slack message in his email register is a worse failure than one extra question.

**2. Answer the routing question, which is not about rank.** How many people will see this, and how long will it persist? That is what moves his formality. A company-wide note is his most formal register; an exec peer reads like an IC.

**3. Decide the position before you decide the words.** He always lands. If you do not know what the recommendation is, you are not ready to draft — go find out or ask him. A draft that hedges because the author was unsure is the most detectable failure there is, because **he hedges about what is true and never about what he wants.**

## The shared spine

These hold in every channel:

- **Lead with the answer.** The thing the reader has to act on goes first.
- **Land on a recommendation**, and make the pick explicit. `*(Recommended)*` in documents; "My recommendation would be X. My rationale would be Y." as an unsplit pair in Slack.
- **Hand control back at the end** — a bare **"Thoughts?"** on its own line, *after* the recommendation, never instead of it.
- **Sharpness attaches to artifacts, never people.** "That handshake is bananas" is in voice. Anything aimed at a person is not.
- **Own the failure if there is one**, plainly and early: "that was a miss on my part." Apologize for *latency*, not for positions.
- **`--`, not `—`**, outside documents.
- **Emphasis carries structure** — `*asterisk*` on the one pivotal word, **bold** on the reader's own question used as a heading, and on the concession itself.

## Delivering a "no"

This is where imitation usually fails, and his pattern is measured and specific.

**Front-load it.** The great majority of his declines reach the negative clause in the opening lines, and a large minority put it in the first sentence — the profiles carry the exact rates. **Do not sandwich it.** The order is: one beat of genuine appreciation → the no, bolded → the reason → a path forward. The cushion is replaced by the alternative.

In documents the equivalent is the **symmetric ledger**: the rejected option gets a real "Why someone might want this" before it gets killed — and gets the most generous framing of any option on the page.

## Channel moves

**These live in the profiles, not here.** Each channel has its own measured length, greeting and sign-off shape, punctuation habits, emphasis devices, emoji grammar, and structural openings — and getting them from a summary is how imitation goes flat. Read `~/.config/ndeko-os/identity/voice/<channel>.md` before drafting, every time.

What the profile will not tell you is which channel you are in, or whether the register should step within it (a broadcast and a DM are the same channel and different registers). That is the routing question above: audience size and permanence.

If a profile is missing or unreadable, stop and say so. Do not reconstruct one from memory of a previous draft — that is how a fingerprint drifts toward a model's own default.

## Before showing him

```bash
bun ${NDEKO_DIR}/skills/Writing/Tools/VoiceCheck.ts --channel <channel> <file>
```

Fix every **DEFECT**. Look at every **FLAG** and decide — a flag is a prompt to check, not an instruction to change.

Then the four things the tool cannot see:

1. Does it **land on a recommendation**, or does it survey and stop?
2. If it disagrees, does the disagreement arrive **the way he does it** — restate, mark the load-bearing word, ask why — rather than as a flat contradiction?
3. Is any sharpness aimed at an **artifact** rather than a person?
4. If there is a "no," is it in the **opening lines**, per the profile's measured runway?

## Hand it over honestly

Say which channel profile you used and flag anything you were unsure about. He is the authority on his own voice; the profile is evidence, not a verdict.
