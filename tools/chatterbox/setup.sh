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

# The pin the marker records. Bump this to force existing installs to upgrade.
#
# Deliberately a git ref, not a PyPI version: chatterbox-tts on PyPI is 0.1.7 and
# so is GitHub master, but master's 0.1.7 is strictly newer code — it adds the
# multilingual v3 weight selector and the Nano model, neither of which exists in
# the published wheel. Installing "the latest release" therefore silently gets a
# build missing two model tiers. (Verified 2026-08-31.)
CHATTERBOX_REF="master"
WANT="chatterbox-tts@git+${CHATTERBOX_REF}"

if [ "${1:-}" = "--upgrade" ]; then
  rm -f "$MARKER"
elif [ -f "$MARKER" ] && [ -x "$VENV/bin/python" ] && [ "$(cat "$MARKER")" = "$WANT" ]; then
  exit 0
fi

if ! command -v python3.11 >/dev/null 2>&1; then
  # The install command is not the same everywhere, and a macOS-only hint is
  # worst exactly where it lands: a Linux box, which is where this tooling is
  # most likely to be set up from scratch.
  echo "error: python3.11 not found. Install it:" >&2
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "  brew install python@3.11" >&2
  elif command -v apt-get >/dev/null 2>&1; then
    # Debian's own repos stop at 3.11 on bookworm; newer releases need the
    # deadsnakes PPA. venv is a separate package on Debian derivatives.
    echo "  sudo apt-get update && sudo apt-get install -y python3.11 python3.11-venv" >&2
    echo "  (Ubuntu 24.04+ / Debian 13+: sudo add-apt-repository ppa:deadsnakes/ppa first)" >&2
  elif command -v dnf >/dev/null 2>&1; then
    echo "  sudo dnf install -y python3.11" >&2
  elif command -v pacman >/dev/null 2>&1; then
    echo "  sudo pacman -S --needed python311   # AUR on current Arch" >&2
  elif command -v apk >/dev/null 2>&1; then
    echo "  sudo apk add python3   # Alpine tracks one python3; check it is 3.11" >&2
  else
    echo "  use your package manager, or https://github.com/astral-sh/uv:" >&2
    echo "  uv python install 3.11" >&2
  fi
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

echo "setup: installing chatterbox-tts from git ${CHATTERBOX_REF} (first run downloads ~2GB of deps) ..." >&2
# Deps first from the published wheel (identical dependency set, and pip resolves
# it far faster), then overlay master's source with --no-deps.
"$VENV/bin/pip" install chatterbox-tts >&2
"$VENV/bin/pip" install --no-deps --force-reinstall \
  "git+https://github.com/resemble-ai/chatterbox.git@${CHATTERBOX_REF}" >&2

# chatterbox-tts depends on resemble-perth, which still imports pkg_resources.
# setuptools >=81 removed pkg_resources, so pin to <81 until perth migrates.
"$VENV/bin/pip" install 'setuptools<81' >&2

# Fail loudly if the overlay did not take — a silent fallback to the PyPI build
# means --model multilingual and --model nano are gone, and the only symptom is
# a TypeError deep in a generate call.
"$VENV/bin/python" - <<'PY' >&2
import sys
try:
    from chatterbox.mtl_tts import MULTILINGUAL_T3_MODELS
    from chatterbox.tts_turbo import NANO_REPO_ID
except ImportError as e:
    sys.exit(f"setup: git overlay did not take ({e}) — multilingual v3 and nano are unavailable")
print("setup: verified multilingual v3 + nano support present")
PY

printf '%s' "$WANT" > "$MARKER"
echo "setup: complete" >&2
