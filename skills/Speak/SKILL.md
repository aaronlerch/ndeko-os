---
name: speak
description: Speak text aloud with Kokoro — 54 fixed voices, no cloning, ~10x faster than Chatterbox. Reads the default voice from ${NDEKO_DATA_DIR}/voice-profiles/.default-kokoro (falls back to af_heart) unless overridden with --voice. Plays via afplay automatically. USE WHEN speak, speak this, narrate, read this aloud fast, kokoro, narration, voiceover, fast tts. NOT FOR a cloned voice or cue tags like [sigh] — that is /say.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /speak — Kokoro TTS

Thin wrapper around the Kokoro CLI + afplay. The fast, fixed-voice sibling of `/say`.

Arguments passed: `$ARGUMENTS`

## Which of the two to use

| | `/speak` (Kokoro) | `/say` (Chatterbox) |
|---|---|---|
| Voice | 54 fixed, no cloning | any voice you cloned |
| Cue tags `[sigh]` `[laugh]` | **none** — read aloud as text | turbo/nano only |
| Speed | ~10x realtime | ~0.4x realtime on turbo |
| Determinism | same text, same audio, always | seed-dependent |

Measured on the same 11-second line, 2026-09-13: kokoro 2.76s end-to-end, chatterbox
turbo 27.4s. **Default to `/speak` for narration and anything long; switch to `/say`
the moment the job needs a specific person's voice or an emotional beat.**

If the text contains cue tags, say so and offer `/say` instead — the CLI warns but
will still read `[sigh]` out loud as the word.

## Default voice resolution

1. Explicit `--voice <name>` in the command
2. Contents of `${NDEKO_DATA_DIR}/voice-profiles/.default-kokoro`
3. Hardcoded fallback: `af_heart`

This is a **separate file** from the `.default` that `/say` reads. The namespaces do
not overlap — `aaron` is not a Kokoro voice and `af_heart` is not a Chatterbox profile
— so one default file could never serve both.

```bash
echo "bf_emma" > ${NDEKO_DATA_DIR}/voice-profiles/.default-kokoro
```

## Workflow

Parse `$ARGUMENTS`:
- **Text** — everything that isn't a flag. `@/path/to/file.txt` also works.
- Optional `--voice <name|blend>` — see below
- Optional `--speed <f>` — 0.5–2.0, default 1.0
- Optional `--lang <code>` — only to override; language follows the voice by default
- Optional `--sentence-pause` / `--clause-pause` — the model's own gaps at `.` and `,`
- Optional `--continuous` — prosody runs across window joins; ~1.4x cost, use on long paragraphs
- Optional `--timings <path.json>` — phoneme-level start/end times
- Optional `--no-play` — save the WAV but don't auto-play
- Optional `--out <path>` — defaults to `/tmp/speak-<ts>.wav`

```bash
OUT="${flag_out:-/tmp/speak-$(date +%s).wav}"
${NDEKO_DIR}/tools/kokoro/kokoro tts \
  --voice "$VOICE" --text "<text or @file>" --out "$OUT" \
  [--speed ...] [--lang ...] [--sentence-pause ...] [--clause-pause ...] \
  [--continuous] [--timings ...]
afplay "$OUT"     # unless --no-play
```

**Forward every flag the caller passed straight through.** This skill owns voice
resolution and playback; every other flag belongs to the CLI. `kokoro tts --help`
is the authority.

Report one line: `🔊 spoken via <voice> (kokoro) → <out path>`

## Voices

`kokoro voices` lists all 54 with language, gender and grade; `kokoro voices --lang en-gb`
filters. `kokoro langs` lists the nine language codes.

**Only three voices are graded above C by hexgrad, and all three are female:**
`af_heart` (A), `af_bella` (A-), `bf_emma` (B-). The other 51 are usable but
audition them before they end up in something you ship. There is no high-graded
male voice — when a demo needs one, that is the strongest reason to fall back to
a cloned Chatterbox profile.

Non-English is thin by hexgrad's own admission: weak G2P and less training data.

## Blending

Kokoro voices are plain style vectors, so a weighted sum is a real third voice
rather than a crossfade:

```bash
/speak "Quarterly numbers are in." --voice "af_heart:0.6,bf_emma:0.4"
```

Weights normalise, so `3,1` and `0.75,0.25` are the same blend. This is the only
voice customisation Kokoro has — there is no cloning and no fine-tune path here.

## Pauses

`[pause]` and `[pause:1.5]` work, implemented the same way as in `/say`: the CLI
splits the text and splices real silence, so the beat is exactly as long as asked.
Verified — a `[pause:1.5]` produces 1.50s of digital silence.

These are different from `--sentence-pause` / `--clause-pause`, which lengthen the
model's own natural gaps at punctuation across the whole clip. Use the flags to
change pacing, `[pause:N]` to place one specific beat.

## Notes

- First run on a fresh machine triggers `setup.sh`: a ~150MB venv plus 350MB of
  model files, about a minute. No Homebrew prerequisite — espeak data is vendored.
- Kokoro is tuned for 100–200 token utterances and prosody drifts on long passages.
  `--continuous` is the mitigation.
- `--timings` emits phoneme start/end pairs, which is what to use when narration has
  to line up with something on screen.
