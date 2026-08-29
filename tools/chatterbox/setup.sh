#!/bin/bash
# Idempotent setup for the Chatterbox voice-clone + TTS tooling.
# Creates a Python 3.11 venv at ~/.claude/tools/chatterbox/venv and
# installs chatterbox-tts plus its dependencies.

set -euo pipefail

# Self-located: this script always sits at <harness>/tools/chatterbox/, so the
# root is wherever it is. No config-root literal to go stale on a rename.
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
VENV="$ROOT/venv"
MARKER="$VENV/.chatterbox-installed"

if [ -f "$MARKER" ] && [ -x "$VENV/bin/python" ]; then
  exit 0
fi

if ! command -v python3.11 >/dev/null 2>&1; then
  echo "error: python3.11 not found. Install with: brew install python@3.11" >&2
  exit 1
fi

if [ ! -x "$VENV/bin/pip" ]; then
  if [ -d "$VENV" ]; then
    echo "setup: venv at $VENV is missing bin/pip — recreating" >&2
    rm -rf "$VENV"
  fi
  echo "setup: creating venv at $VENV" >&2
  python3.11 -m venv "$VENV"
fi

echo "setup: upgrading pip" >&2
"$VENV/bin/pip" install --upgrade pip >/dev/null

echo "setup: installing chatterbox-tts (first run downloads ~2GB of deps) ..." >&2
"$VENV/bin/pip" install chatterbox-tts >&2

# chatterbox-tts depends on resemble-perth, which still imports pkg_resources.
# setuptools >=81 removed pkg_resources, so pin to <81 until perth migrates.
"$VENV/bin/pip" install 'setuptools<81' >&2

touch "$MARKER"
echo "setup: complete" >&2
