---
name: voice-clone
description: Save a reusable Chatterbox voice profile from one or more audio samples. USE WHEN voice clone, clone voice, save voice profile, create voice profile, chatterbox profile, voice sample, reference voice, new voice.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /voice-clone — Save a Chatterbox Voice Profile

Stores a named voice profile backed by Resemble AI's Chatterbox TTS. Each profile is a normalized 45s reference clip plus metadata at `${NDEKO_DATA_DIR}/voice-profiles/<name>/`. Reuse it later via `/chatterbox-tts --profile <name>`.

Arguments passed: `$ARGUMENTS`

## How it works

Chatterbox "voice cloning" is reference-based, not training-based: generation takes a short reference audio clip each time. A profile is just a saved, normalized reference clip + metadata — no model training happens.

The CLI copies each `--sample` file into `<profile-dir>/sources/` so the source audio survives even if the original location is cleaned up. `profile.json` records the local copies under `source_samples` (relative to the profile dir) and the original paths under `original_source_paths` for provenance.

## Workflow

Parse `$ARGUMENTS` to extract:
- **Profile name** — e.g. `aaron`, `my-voice`, `narrator`. Alphanumeric + dash/underscore, max 64 chars.
- **One or more sample paths** — any format ffmpeg can read (mp3, m4a, wav, ogg, flac). **All samples are concatenated in the order given**, then the first `--seconds` are taken as the reference. Supply the cleanest, most representative speech first.
- Optional `--seconds <n>` — reference length, default 45. It is a **ceiling**, not a requirement: a source with only 12s of audio clones fine and lands at 12s. See "How long should the reference be" below.
- Optional `--force` to overwrite an existing profile with the same name.
- Optional notes passed via `--notes "<text>"`.

The reference must be **longer than 5 seconds** — chatterbox asserts on anything shorter and the CLI fails early with that message rather than letting it blow up mid-generation.

### 1. Validate

- Confirm each sample path exists (`ls` or `Read`). If any is missing, report which and stop.
- If profile name is missing or malformed, ask the user to supply one.
- If a profile with that name already exists and `--force` wasn't specified, ask the user to confirm overwrite before passing `--force`.

### 2. Invoke the CLI

```bash
${NDEKO_DIR}/tools/chatterbox/chatterbox clone \
  --name <profile-name> \
  --sample <path-1> \
  [--sample <path-2>] ... \
  [--seconds <n>] \
  [--force] \
  [--notes "<optional notes>"]
```

**First-ever run installs the chatterbox-tts venv** (Python 3.11 + torch + chatterbox-tts, ~2GB). This takes several minutes. Warn the user if `${NDEKO_DIR}/tools/chatterbox/venv/.chatterbox-installed` doesn't exist.

### 3. Report result

The CLI prints the saved profile directory and the normalized reference duration. Pass that back and suggest a test invocation of `/chatterbox-tts`.

## How long should the reference be

**Default 45s. Longer is better, up to the point the audio stops being clean.**

15s is only where the *conditioning prompts* stop: `turbo`/`nano` slice 15s for
the speech-cond prompt, `standard`/`multilingual` take 6s enc + 10s dec. Past
that the audio still counts, because every tier hands the **whole** file to the
voice encoder, which splits it into partial utterances and averages their
embeddings. More clean speech means a more stable speaker embedding.

Aaron A/B'd 15s vs 30s vs 45s on the same text and seed, 2026-08-31, and
preferred them in that order — 45 > 30 > 15. That listening test is where the
default comes from.

The caveat is what "clean" is doing in that sentence. The gain assumes the extra
audio is still the same speaker talking normally; long silences, music, a second
voice, or a noisy tail will pull the average the wrong way. If a source degrades
after the first minute, cut it with `--seconds`.

Profiles are capped by what they have — `aaron` holds 15s of source, so it sits
at 15s until longer audio is supplied.

## Rebuilding an existing profile

`clone` copies every sample into `<profile-dir>/sources/`, so a profile can be
re-cut without hunting down the original audio:

```bash
${NDEKO_DIR}/tools/chatterbox/chatterbox rebuild --profile <name> [--seconds 30]
```

This is the fix when `chatterbox list` shows a profile shorter than its available
source — profiles cloned before 2026-08-31 were cut at 10s and conditioned on the
first sample only. `chatterbox tts` prints a note when re-cutting would actually
gain something, and stays quiet when a profile is already using every second it
has.

## Other operations via the same CLI

- `${NDEKO_DIR}/tools/chatterbox/chatterbox list` — list all profiles
- `${NDEKO_DIR}/tools/chatterbox/chatterbox show --profile <name>` — show metadata JSON
- `${NDEKO_DIR}/tools/chatterbox/chatterbox delete --profile <name> --force` — remove a profile

## Examples

- `/voice-clone <profile-name> ~/Downloads/sample.mp3`
- `/voice-clone narrator ~/Recordings/clip.m4a --notes "warm, conversational"`
- `/voice-clone my-voice ~/sample.wav --force` (overwrite existing)
- `/voice-clone narrator ~/take1.wav ~/take2.wav` (concatenated, up to the 45s default)
- `/voice-clone narrator ~/long-interview.wav --seconds 20` (cap it short — the tail is noisy)

## Prerequisites

- `brew install python@3.11 ffmpeg` (one-time; ffmpeg is used to normalize the reference clip)
- The chatterbox-tts venv is auto-installed on first CLI invocation
