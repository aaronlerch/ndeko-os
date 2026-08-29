---
name: say
description: Speak text aloud using a Chatterbox voice profile. Reads the default voice from ${NDEKO_DATA_DIR}/voice-profiles/.default (currently `aaron`) unless overridden with --voice. Plays the result via afplay automatically. USE WHEN say, speak, read aloud, voice out, speak this, say aloud, tts this, talk, narrate.
user-invocable: true
allowed-tools:
  - Bash
  - Read
---

# /say — Speak Text Aloud

Thin wrapper around Chatterbox TTS + afplay. Pairs with `/voice-clone` and `/chatterbox-tts`.

Arguments passed: `$ARGUMENTS`

## Default voice resolution

Every voice skill in this system resolves the voice in this order:

1. Explicit `--voice <profile>` flag in the command
2. Contents of `${NDEKO_DATA_DIR}/voice-profiles/.default` (one line, the profile name)
3. Hardcoded fallback: `aaron`

To change the default permanently:
```bash
echo "narrator" > ${NDEKO_DATA_DIR}/voice-profiles/.default
```
The value must be a profile that exists in `${NDEKO_DATA_DIR}/voice-profiles/`. Verify with `${NDEKO_DIR}/tools/chatterbox/chatterbox list`.

## Workflow

Parse `$ARGUMENTS` to extract:
- **Text** — the phrase to speak. Everything that isn't a flag. Wrap in quotes if it has spaces. `@/path/to/file.txt` also works.
- Optional `--voice <profile>` — override the default voice
- Optional `--model standard|turbo` — default `turbo` (faster + supports `[chuckle]` `[sigh]` tags)
- Optional `--no-play` — save the WAV but don't auto-play
- Optional `--out <path>` — defaults to `/tmp/say-<ts>.wav`

### 1. Resolve voice

```bash
VOICE="${flag_voice:-$(cat ${NDEKO_DATA_DIR}/voice-profiles/.default 2>/dev/null || echo aaron)}"
```

If the resolved voice profile doesn't exist (`chatterbox show --profile "$VOICE"` fails), suggest `/voice-clone` to create it and stop.

### 2. Generate audio

```bash
OUT="${flag_out:-/tmp/say-$(date +%s).wav}"
${NDEKO_DIR}/tools/chatterbox/chatterbox tts \
  --profile "$VOICE" --model "${flag_model:-turbo}" \
  --text "<text or @file>" --out "$OUT"
```

### 3. Play (unless --no-play)

```bash
afplay "$OUT"
```

### 4. Report

One line: `🔊 spoken via <voice> (<model>) → <out path>`

## Examples

- `/say "Hello, welcome back."`
- `/say "This meeting is gonna run long [sigh]." --model turbo`
- `/say "Board meeting in five minutes." --voice narrator`
- `/say @/tmp/note.txt --no-play --out ~/Downloads/note.wav`

## Notes

- First run after a fresh machine will trigger Chatterbox model download (~1-2GB, one-time).
- For long text, expect a delay — Turbo on CPU is ~3x faster than standard but still not instant.
