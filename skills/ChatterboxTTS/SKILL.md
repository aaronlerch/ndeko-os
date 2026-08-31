---
name: chatterbox-tts
disable-model-invocation: true
description: Generate speech from text using a saved Chatterbox voice profile. USE WHEN text to speech, tts, generate voice, chatterbox tts, synthesize speech, read aloud, voice generation, speak as, say in voice.
user-invocable: true
allowed-tools:
  - Bash
  - Read
  - Write
---

# /chatterbox-tts — Generate Speech with a Saved Voice

Takes a saved voice profile plus text, calls Chatterbox TTS, and writes a WAV to disk. Reports the path so the user can play it with `afplay` or pass it to another tool.

Arguments passed: `$ARGUMENTS`

## Workflow

Parse `$ARGUMENTS` to extract:
- **Profile name** — must exist in `${NDEKO_DATA_DIR}/voice-profiles/` (create with `/voice-clone`)
- **Text** — inline string, or `@/path/to/text.txt` to load from a file
- Optional `--out <path>` — defaults to `~/Downloads/chatterbox-<profile>-<YYYYmmdd-HHMMSS>.wav`
- Optional `--device auto|cpu|mps|cuda` — defaults to `auto`, which resolves cuda → mps → cpu. On Apple Silicon `auto` picks **mps**, measured ~4x faster than CPU on turbo (2026-08-31). An older note here claimed MPS was broken by tensor-allocation bugs; that is no longer true and `--device cpu` is only needed to reproduce a seed rendered on CPU.
- Optional `--model turbo|standard|multilingual|nano` — defaults to `standard`. See the model table below. **Cue tags only work on `turbo` and `nano`.**
- Optional `--mtl-version v2|v3` — multilingual weights, defaults to `v3`
- Optional `--language <code>` — multilingual only, defaults to `en` (23 supported)
- Optional `--exaggeration <float>` and `--cfg-weight <float>` — standard/multilingual only
- Optional turbo/nano sampling knobs: `--temperature`, `--top-p`, `--repetition-penalty`, `--no-norm-loudness`
- Optional `--seed <int>` — makes a take reproducible on the same device
- Optional `--candidates <n>` — render n seeded takes side by side (writes `<out>.seed<N>.wav` per take) and pick the best
- Optional `--play` — after writing, `afplay` the result
- Auto-chunking is **on by default** — text longer than 300 chars is split by paragraph/sentence, generated chunk-by-chunk with one shared model load, then concatenated with a brief silence between segments. This prevents the gibberish output Chatterbox produces on long single-shot generations. Flags: `--no-chunk` to disable, `--chunk-size <n>` to change the threshold, `--chunk-silence <sec>` for the gap (default 0.35s)

## Model tiers

| Model | Params | Decoder | Cue tags | `exaggeration`/`cfg_weight` |
|---|---|---|---|---|
| `turbo` | 350M | 2 CFM steps | **yes** | inert (`emotion_adv=False`) |
| `nano` | 110M | 2 CFM steps | **yes** | inert |
| `standard` | 500M | 10 CFM steps | no — stripped | yes |
| `multilingual` (v3) | 500M | 10 CFM steps | no — stripped | yes |

The 2-vs-10 flow-matching step count is the speed/fidelity trade. `standard` and
`multilingual` do 5x the vocoder work per clip and take the pacing knobs; `turbo`
and `nano` are faster and are the only tiers that can perform cue tags.

**They are mutually exclusive.** There is no tier with both cue tags and
`cfg_weight`. If the user wants performed emotion, that decides it: turbo.

### Cue tags — turbo and nano only

19 tags are real vocabulary entries in the turbo/nano checkpoints
(`added_tokens.json`). Run `chatterbox tags` for the live list.

Paralinguistic: `[laugh]` `[chuckle]` `[gasp]` `[cough]` `[sigh]` `[groan]`
`[sniff]` `[shush]` `[clear throat]` `[crying]`

Delivery/emotion: `[narration]` `[whispering]` `[dramatic]` `[sarcastic]`
`[happy]` `[angry]` `[fear]` `[surprised]` `[advertisement]`

All lowercase, exact match, inline in the text:
`"Hey Sarah [chuckle], have you got a minute?"`. A delivery tag placed at the
**start** of a line colours the whole line — `"[narration] Phase three ships
today."` is the usual move for voiceover.

On `standard` and `multilingual` the CLI strips these with a warning, because
those tokenisers would otherwise read the brackets out loud.

If the user asks for emotion, chuckling, laughing, whispering, narration
delivery, or any expressive read and hasn't named a model, use `--model turbo`.

### `[pause]` — every model

`[pause]` (0.6s) and `[pause:1.5]` are **not** model tokens; no tier has one.
The CLI implements them by splitting the text and inserting real silence, so
they work everywhere and the beat is exactly as long as requested.

### Pronunciation

There is no phoneme, IPA, lexicon, or G2P input anywhere in chatterbox. Homographs
("rECord" the noun vs "recORD" the verb) are decided by sampling. Two handles:

1. Respell it in the text — `"REH-cord"` / `"ree-CORD"`.
2. `--candidates 4`, listen, keep the take that is right, then pin its `--seed`
   so the clip is reproducible on re-render.

## Workflow steps

### 1. Validate

- Confirm profile exists:
  ```bash
  ${NDEKO_DIR}/tools/chatterbox/chatterbox show --profile <name>
  ```
  Non-zero exit means the profile is missing — suggest `/voice-clone` to create one.
- If `--out` was omitted, compute a default using `date +%Y%m%d-%H%M%S` and place it in `~/Downloads/`.
- Long text (> ~1500 chars) will be slow — warn the user and confirm before proceeding. On mps, turbo runs a little faster than realtime and `standard`/`multilingual` around 1.5-2.4x slower than realtime (measured 2026-08-31, M-series).
- Check the reference length: `chatterbox show --profile <name>` reports `reference_duration_sec`. profiles default to a 45s reference; if one is shorter than the source it stores, `chatterbox rebuild --profile <name>` widens it. The CLI prints a note when this applies.

### 2. Invoke the CLI

```bash
${NDEKO_DIR}/tools/chatterbox/chatterbox tts \
  --profile <name> \
  --text "<inline text OR @/path/to/file.txt>" \
  --out <output-wav-path> \
  [--model turbo|standard|multilingual|nano] \
  [--device auto|cpu|mps|cuda] \
  [--seed <int>] [--candidates <n>] \
  [--exaggeration <float>] \
  [--cfg-weight <float>] \
  [--mtl-version v2|v3] [--language <code>] \
  [--temperature <float>] \
  [--top-p <float>] \
  [--repetition-penalty <float>]
```

CLI prints the output WAV path on stdout; progress messages go to stderr.

### 3. Optional playback

If the user asked to hear it, or passed `--play`:
```bash
afplay <output-wav-path>
```

### 4. Report

Tell the user the output path, the profile used, and the `afplay` command they can run to hear it if not already played.

## Examples

- `/chatterbox-tts aaron "Hello world, this is my cloned voice."`
- `/chatterbox-tts narrator @/tmp/chapter1.txt --out ~/Downloads/chapter1.wav`
- `/chatterbox-tts my-voice "Test" --play`
- `/chatterbox-tts aaron "Excited!" --exaggeration 0.8 --cfg-weight 0.3`
- `/chatterbox-tts aaron "Wait really? [chuckle] That's hilarious." --model turbo`
- `/chatterbox-tts aaron "Ugh [sigh], fine." --model turbo --temperature 0.9`
- `/chatterbox-tts morgan "[narration] Phase three ships today. [pause:0.8] Here is what changed." --model turbo`
- `/chatterbox-tts aaron "She will record the record." --model turbo --candidates 4` (pick the right homograph, then pin its seed)

## First-run behavior

- First-ever `/chatterbox-tts` invocation triggers setup.sh (venv + chatterbox-tts from GitHub master) — several minutes. `setup.sh --upgrade` re-runs it.
- First generation **per model tier** downloads that tier's weights (~1–2GB each) to `~/.cache/huggingface/`. turbo, standard, multilingual and nano are separate downloads.
- Subsequent calls are fast (model stays cached on disk; load takes a few seconds).

## Tuning knobs

### Standard model (`--model standard`, default)

| Parameter | Default | Effect |
|---|---|---|
| `exaggeration` | 0.5 | Higher = more emotive delivery. 0.7+ is noticeably theatrical. |
| `cfg_weight` | 0.5 | Classifier-free guidance weight. Lower = slower/calmer pacing; raise if speech sounds rushed. |

Pair a higher `exaggeration` with a lower `cfg_weight` (~0.3) to counteract pacing issues, per Chatterbox's own guidance.

### Turbo / Nano (`--model turbo`, `--model nano`)

Ignores `--exaggeration` and `--cfg-weight` — turbo's `T3Config` sets
`emotion_adv=False`, so they are inert no matter what is passed. Expression comes
from inline cue tags and the sampling knobs instead.

| Parameter | Default | Effect |
|---|---|---|
| `temperature` | 0.8 | Higher = more varied / expressive; lower = flatter / more consistent. |
| `top_p` | 0.95 | Nucleus sampling cutoff. |
| `repetition_penalty` | 1.2 | Discourage repeated tokens. |
| `norm_loudness` | on | Normalises the reference to -27 LUFS before conditioning. `--no-norm-loudness` to skip. |

### Reference length

**Profiles default to a 45s reference.** `turbo`/`nano` slice 15s of it for the
speech-cond prompt and `standard`/`multilingual` take 6s enc + 10s dec, but the
rest is not wasted: every tier passes the **whole** file to the voice encoder,
which splits it into partial utterances and averages their embeddings.

Aaron A/B'd 15s vs 30s vs 45s on identical text and seed, 2026-08-31, and
preferred 45 > 30 > 15. Longer helps as long as the extra audio stays clean
speech — silences, music, or a second voice pull the average the wrong way.

A profile is capped by the source it holds. To re-cut:

```bash
chatterbox rebuild --profile <name> [--seconds 45]
```

`chatterbox tts` prints a note when a profile is shorter than the source audio it
has stored, and stays quiet otherwise.

## Prerequisites

- `brew install python@3.11` (one-time — venv is created on first run)
- A saved profile via `/voice-clone`
