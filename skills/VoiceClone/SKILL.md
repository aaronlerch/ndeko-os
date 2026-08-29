---
name: voice-clone
description: Save a reusable Chatterbox voice profile from one or more audio samples. USE WHEN voice clone, clone voice, save voice profile, create voice profile, chatterbox profile, voice sample, reference voice, new voice.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /voice-clone — Save a Chatterbox Voice Profile

Stores a named voice profile backed by Resemble AI's Chatterbox TTS. Each profile is a normalized ~10s reference clip plus metadata at `${NDEKO_DATA_DIR}/voice-profiles/<name>/`. Reuse it later via `/chatterbox-tts --profile <name>`.

Arguments passed: `$ARGUMENTS`

## How it works

Chatterbox "voice cloning" is reference-based, not training-based: generation takes a short reference audio clip each time. A profile is just a saved, normalized reference clip + metadata — no model training happens.

The CLI copies each `--sample` file into `<profile-dir>/sources/` so the source audio survives even if the original location is cleaned up. `profile.json` records the local copies under `source_samples` (relative to the profile dir) and the original paths under `original_source_paths` for provenance.

## Workflow

Parse `$ARGUMENTS` to extract:
- **Profile name** — e.g. `aaron`, `my-voice`, `narrator`. Alphanumeric + dash/underscore, max 64 chars.
- **One or more sample paths** — any format ffmpeg can read (mp3, m4a, wav, ogg, flac). Only the first 10 seconds of the first sample are used for the reference clip.
- Optional `--force` to overwrite an existing profile with the same name.
- Optional notes passed via `--notes "<text>"`.

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
  [--force] \
  [--notes "<optional notes>"]
```

**First-ever run installs the chatterbox-tts venv** (Python 3.11 + torch + chatterbox-tts, ~2GB). This takes several minutes. Warn the user if `${NDEKO_DIR}/tools/chatterbox/venv/.chatterbox-installed` doesn't exist.

### 3. Report result

The CLI prints the saved profile directory and the normalized reference duration. Pass that back and suggest a test invocation of `/chatterbox-tts`.

## Other operations via the same CLI

- `${NDEKO_DIR}/tools/chatterbox/chatterbox list` — list all profiles
- `${NDEKO_DIR}/tools/chatterbox/chatterbox show --profile <name>` — show metadata JSON
- `${NDEKO_DIR}/tools/chatterbox/chatterbox delete --profile <name> --force` — remove a profile

## Examples

- `/voice-clone <profile-name> ~/Downloads/sample.mp3`
- `/voice-clone narrator ~/Recordings/clip.m4a --notes "warm, conversational"`
- `/voice-clone my-voice ~/sample.wav --force` (overwrite existing)

## Prerequisites

- `brew install python@3.11 ffmpeg` (one-time; ffmpeg is used to normalize the reference clip)
- The chatterbox-tts venv is auto-installed on first CLI invocation
