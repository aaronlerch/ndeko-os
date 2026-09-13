#!/bin/bash
# Idempotent setup for the Kokoro TTS tooling.
# Creates a Python venv at <harness>/tools/kokoro/venv, installs kokoro-onnx,
# and fetches the two model files into <harness>/tools/kokoro/models.
#
# Why ONNX and not the official `kokoro` PyTorch package:
#   - kokoro-onnx's only deps are onnxruntime, numpy, phonemizer and
#     espeakng-loader. No torch, so the venv is ~150MB against chatterbox's 1.5G,
#     and espeakng-loader vendors the espeak-ng data — there is NO brew
#     prerequisite, which is the whole reason this installs unattended.
#   - Kokoro's ISTFTNet vocoder uses ops Metal does not implement (aten::angle),
#     so the torch path falls back to CPU mid-graph and round-trips tensors on
#     every call. ONNX on CPU is faster than torch on MPS here.
#   - kokoro-onnx shipped 0.6.1 on 2026-08-19; the torch path's G2P dependency
#     (misaki) has not shipped since 2025-04-05.
# (Verified 2026-09-13.)

set -euo pipefail

# Self-located: this script always sits at <harness>/tools/kokoro/, so the root
# is wherever it is. No config-root literal to go stale on a rename.
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
VENV="$ROOT/venv"
MODELS="$ROOT/models"
MARKER="$VENV/.kokoro-installed"

# Model files come from the kokoro-onnx release assets, not from HuggingFace —
# the .onnx export is the maintainer's, not hexgrad's.
#
# NOTE on the tag/filename mismatch: the assets named kokoro-v1.0.* live under
# the model-files-v1.1 tag. That is upstream's own numbering (the v1.1 tag adds
# the separate Chinese model); it is not a typo here. The v1.1 tag also carries
# a *newer build* of the v1.0 weights than the v1.0 tag does, which is why it is
# the one pinned.
RELEASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
VOICES_FILE="voices-v1.0.bin"

# Bump to force existing installs to re-resolve. Records what the marker holds.
VARIANT="${KOKORO_VARIANT:-full}"
case "$VARIANT" in
  full) MODEL_FILE="kokoro-v1.0.onnx" ;;       # 325MB, fp32 — the quality default
  fp16) MODEL_FILE="kokoro-v1.0.fp16.onnx" ;;  # 163MB
  int8) MODEL_FILE="kokoro-v1.0.int8.onnx" ;;  # 114MB, fastest, audibly grainier
  *) echo "error: KOKORO_VARIANT must be full|fp16|int8 (got '$VARIANT')" >&2; exit 1 ;;
esac
WANT="kokoro-onnx+${MODEL_FILE}"

if [ "${1:-}" = "--upgrade" ]; then
  rm -f "$MARKER"
elif [ -f "$MARKER" ] && [ -x "$VENV/bin/python" ] \
     && [ "$(cat "$MARKER")" = "$WANT" ] \
     && [ -s "$MODELS/$MODEL_FILE" ] && [ -s "$MODELS/$VOICES_FILE" ]; then
  exit 0
fi

# ── Python ──────────────────────────────────────────────────────────────────
# kokoro-onnx wants >=3.10,<3.14. uv can provision an interpreter itself, which
# is why it is preferred over hunting for a system python of the right minor.
if [ ! -x "$VENV/bin/python" ]; then
  if [ -d "$VENV" ]; then
    echo "setup: venv at $VENV is incomplete — recreating" >&2
    rm -rf "$VENV"
  fi
  echo "setup: creating venv at $VENV" >&2
  if command -v uv >/dev/null 2>&1; then
    uv venv --python 3.12 "$VENV" >&2
  else
    PY=""
    for cand in python3.12 python3.11 python3.10; do
      command -v "$cand" >/dev/null 2>&1 && { PY="$cand"; break; }
    done
    if [ -z "$PY" ]; then
      echo "error: need uv, or a python 3.10-3.13. Install one:" >&2
      if [ "$(uname -s)" = "Darwin" ]; then
        echo "  brew install uv        # or: brew install python@3.12" >&2
      elif command -v apt-get >/dev/null 2>&1; then
        echo "  sudo apt-get install -y python3.12 python3.12-venv" >&2
      else
        echo "  https://github.com/astral-sh/uv  ->  uv python install 3.12" >&2
      fi
      exit 1
    fi
    "$PY" -m venv "$VENV"
  fi
fi

echo "setup: installing kokoro-onnx (no torch — this is quick)" >&2
if command -v uv >/dev/null 2>&1; then
  VIRTUAL_ENV="$VENV" uv pip install --quiet --upgrade kokoro-onnx soundfile >&2
else
  "$VENV/bin/pip" install --quiet --upgrade pip >&2
  "$VENV/bin/pip" install --quiet --upgrade kokoro-onnx soundfile >&2
fi

# ── Model files ─────────────────────────────────────────────────────────────
mkdir -p "$MODELS"
fetch() {
  local name="$1" dest="$MODELS/$1"
  [ -s "$dest" ] && return 0
  echo "setup: downloading $name ..." >&2
  # --fail so a 404 leaves no truncated file pretending to be a model. Download
  # to .part and rename, so an interrupted fetch cannot satisfy the -s check
  # above on the next run and produce an onnxruntime error instead of a retry.
  curl -fL --progress-bar -o "$dest.part" "$RELEASE/$name" >&2
  mv "$dest.part" "$dest"
}
fetch "$MODEL_FILE"
fetch "$VOICES_FILE"

# ── Verify ──────────────────────────────────────────────────────────────────
# Loading the session is the only thing that proves the .onnx is intact and that
# espeak data resolved. A marker written without this would make a truncated
# download look like a successful install until the first real render.
"$VENV/bin/python" - "$MODELS/$MODEL_FILE" "$MODELS/$VOICES_FILE" <<'PY' >&2
import sys
from kokoro_onnx import Kokoro
k = Kokoro(sys.argv[1], sys.argv[2])
voices = sorted(k.get_voices())
samples, sr = k.create("Setup check.", voice=voices[0], speed=1.0, lang="en-us")
print(f"setup: verified — {len(voices)} voices, {sr} Hz, {len(samples)/sr:.2f}s test render")
PY

printf '%s' "$WANT" > "$MARKER"
echo "setup: complete" >&2
