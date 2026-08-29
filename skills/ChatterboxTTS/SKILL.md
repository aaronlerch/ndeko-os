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
- Optional `--device auto|cpu|mps|cuda` — defaults to `auto` (which resolves to CPU on Darwin because chatterbox-tts has known MPS tensor-allocation bugs; pass `--device mps` only if the user explicitly wants to try it)
- Optional `--model standard|turbo` — defaults to `standard`. Use `turbo` when the user asks for expressive delivery, emotion, laughing/sighing/chuckling, or paralinguistic tags. Turbo also supports the same voice profiles.
- Optional `--exaggeration <float>` and `--cfg-weight <float>` — override profile defaults
- Optional Turbo-only sampling knobs: `--temperature`, `--top-p`, `--repetition-penalty`
- Optional `--play` — after writing, `afplay` the result
- Auto-chunking is **on by default** — text longer than 300 chars is split by paragraph/sentence, generated chunk-by-chunk with one shared model load, then concatenated with a brief silence between segments. This prevents the gibberish output Chatterbox produces on long single-shot generations. Flags: `--no-chunk` to disable, `--chunk-size <n>` to change the threshold, `--chunk-silence <sec>` for the gap (default 0.35s)

### Paralinguistic (emotion) tags — Turbo only

When `--model turbo`, you can embed these bracketed tags inline in the text and the model will perform them naturally in the cloned voice:

`[laugh]` `[chuckle]` `[gasp]` `[cough]` `[sigh]` `[groan]` `[sniff]` `[shush]` `[clear throat]`

All lowercase, exact match. Example text: `"Hey Sarah [chuckle], have you got a minute?"` or `"I can't believe it [gasp] — did that just happen?"`

If the user asks for emotion/chuckling/laughing/more expressive delivery and hasn't specified a model, use `--model turbo` automatically.

### 1. Validate

- Confirm profile exists:
  ```bash
  ${NDEKO_DIR}/tools/chatterbox/chatterbox show --profile <name>
  ```
  Non-zero exit means the profile is missing — suggest `/voice-clone` to create one.
- If `--out` was omitted, compute a default using `date +%Y%m%d-%H%M%S` and place it in `~/Downloads/`.
- Long text (> ~1500 chars) on CPU will be slow — warn the user and confirm before proceeding.

### 2. Invoke the CLI

```bash
${NDEKO_DIR}/tools/chatterbox/chatterbox tts \
  --profile <name> \
  --text "<inline text OR @/path/to/file.txt>" \
  --out <output-wav-path> \
  [--model standard|turbo] \
  [--device auto|cpu|mps|cuda] \
  [--exaggeration <float>] \
  [--cfg-weight <float>] \
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

## First-run behavior

- First-ever `/chatterbox-tts` invocation triggers setup.sh (venv + `pip install chatterbox-tts`) — several minutes.
- First-ever generation downloads Chatterbox model weights (~1–2GB) to `~/.cache/huggingface/`.
- Subsequent calls are fast (model stays cached on disk; load takes a few seconds).

## Tuning knobs

### Standard model (`--model standard`, default)

| Parameter | Default | Effect |
|---|---|---|
| `exaggeration` | 0.5 | Higher = more emotive delivery. 0.7+ is noticeably theatrical. |
| `cfg_weight` | 0.5 | Classifier-free guidance weight. Lower = slower/calmer pacing; raise if speech sounds rushed. |

Pair a higher `exaggeration` with a lower `cfg_weight` (~0.3) to counteract pacing issues, per Chatterbox's own guidance.

### Turbo model (`--model turbo`)

Ignores `--exaggeration` and `--cfg-weight`. Expression is driven by inline paralinguistic tags and sampling knobs instead.

| Parameter | Default | Effect |
|---|---|---|
| `temperature` | 0.8 | Higher = more varied / expressive; lower = flatter / more consistent. |
| `top_p` | 0.95 | Nucleus sampling cutoff. |
| `repetition_penalty` | 1.2 | Discourage repeated tokens. |

Turbo is also ~3x faster than standard on CPU (~30 it/s vs ~11 it/s in testing).

## Prerequisites

- `brew install python@3.11` (one-time — venv is created on first run)
- A saved profile via `/voice-clone`
