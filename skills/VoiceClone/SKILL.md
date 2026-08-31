---
name: voice-clone
description: Save a reusable Chatterbox voice profile from one or more audio samples. USE WHEN voice clone, clone voice, save voice profile, create voice profile, chatterbox profile, voice sample, reference voice, new voice.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /voice-clone — Save a Chatterbox Voice Profile

Stores a named voice profile backed by Resemble AI's Chatterbox TTS. Each profile is a normalized 15s reference clip plus metadata at `${NDEKO_DATA_DIR}/voice-profiles/<name>/`. Reuse it later via `/chatterbox-tts --profile <name>`.

Arguments passed: `$ARGUMENTS`

## How it works

Chatterbox "voice cloning" is reference-based, not training-based: generation takes a short reference audio clip each time. A profile is just a saved, normalized reference clip + metadata — no model training happens.

The CLI copies each `--sample` file into `<profile-dir>/sources/` so the source audio survives even if the original location is cleaned up. `profile.json` records the local copies under `source_samples` (relative to the profile dir) and the original paths under `original_source_paths` for provenance.

## Workflow

Parse `$ARGUMENTS` to extract:
- **Profile name** — e.g. `aaron`, `my-voice`, `narrator`. Alphanumeric + dash/underscore, max 64 chars.
- **One or more sample paths** — any format ffmpeg can read (mp3, m4a, wav, ogg, flac). **All samples are concatenated in the order given**, then the first `--seconds` are taken as the reference. Supply the cleanest, most representative speech first.
- Optional `--seconds <n>` — reference length, default 15. See "How long should the reference be" below.
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

Default 15s, because that is the longest **conditioning prompt** any tier reads:
`turbo`/`nano` slice 15s for the speech-cond prompt, `standard`/`multilingual`
take 6s enc + 10s dec. Anything under 15s leaves turbo conditioning on less than
it can use.

Longer still is not wasted. Every tier hands the **whole** reference file to the
voice encoder and caps only the prompt slices, so the speaker embedding keeps
changing with length — verified 2026-08-31, where 15s / 30s / 45s references
produced three different renders from identical text and seed. Whether longer is
*better* depends on the extra audio staying clean speech, so treat 30s as worth
A/B-ing rather than an automatic win.

## Rebuilding an existing profile

`clone` copies every sample into `<profile-dir>/sources/`, so a profile can be
re-cut without hunting down the original audio:

```bash
${NDEKO_DIR}/tools/chatterbox/chatterbox rebuild --profile <name> [--seconds 30]
```

This is the fix when `chatterbox list` shows a profile with a reference shorter
than 15s — profiles cloned before 2026-08-31 were cut at 10s and conditioned on
the first sample only.

## Other operations via the same CLI

- `${NDEKO_DIR}/tools/chatterbox/chatterbox list` — list all profiles
- `${NDEKO_DIR}/tools/chatterbox/chatterbox show --profile <name>` — show metadata JSON
- `${NDEKO_DIR}/tools/chatterbox/chatterbox delete --profile <name> --force` — remove a profile

## Examples

- `/voice-clone <profile-name> ~/Downloads/sample.mp3`
- `/voice-clone narrator ~/Recordings/clip.m4a --notes "warm, conversational"`
- `/voice-clone my-voice ~/sample.wav --force` (overwrite existing)
- `/voice-clone narrator ~/take1.wav ~/take2.wav --seconds 30` (concatenated, 30s reference)

## Prerequisites

- `brew install python@3.11 ffmpeg` (one-time; ffmpeg is used to normalize the reference clip)
- The chatterbox-tts venv is auto-installed on first CLI invocation
