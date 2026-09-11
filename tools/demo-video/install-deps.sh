#!/usr/bin/env bash
# Install the two things `bun install` cannot: ffmpeg, and Playwright's browser.
#
# The demo-video preflight names the missing tool and, since it can also name
# this script, an agent reading that message can offer to run it. That is the
# whole reason this exists as a script rather than as a paragraph in the README:
# "want me to do that for you?" needs something to point at.
#
# Safe to re-run. Everything already present is skipped, and nothing here
# upgrades a package you already have.
#
#   ./install-deps.sh            install what is missing (prompts before sudo)
#   ./install-deps.sh --check    report only; exit 1 if anything is missing
#   ./install-deps.sh --yes      no prompts (CI, agents, containers)
#
# The Linux package selection here is the shell twin of lib/install-hint.ts.
# Both read /etc/os-release and reach the same answer; if you change the
# packages in one, change the other. A third copy of these commands is inlined
# in scripts/cloud-env-setup.sh, which cannot call this file because it runs
# before the repository is cloned.
set -uo pipefail

MODE="install"
ASSUME_YES=0

for arg in "$@"; do
	case "$arg" in
	--check) MODE="check" ;;
	--yes | -y) ASSUME_YES=1 ;;
	--help | -h)
		sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	*)
		echo "unknown argument: $arg (try --help)" >&2
		exit 2
		;;
	esac
done

# Repo root, from this script's own location, so the script works from any cwd.
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"

# --- platform ---------------------------------------------------------------

# Which package manager owns this machine's system packages. Derived from
# os-release rather than probing PATH: a box can have several managers installed
# and only one of them responsible for the base system.
detect_manager() {
	if [ "$(uname -s)" = "Darwin" ]; then
		echo "brew"
		return
	fi
	[ -r /etc/os-release ] || return
	# shellcheck disable=SC1091
	. /etc/os-release
	for id in ${ID:-} ${ID_LIKE:-}; do
		case "$id" in
		debian | ubuntu | linuxmint | pop | raspbian)
			echo "apt"
			return
			;;
		fedora | rhel | centos | rocky | almalinux)
			echo "dnf"
			return
			;;
		arch | archlinux | manjaro | endeavouros)
			echo "pacman"
			return
			;;
		alpine)
			echo "apk"
			return
			;;
		esac
	done
}

MANAGER="$(detect_manager)"

# Root already, or a sudo prefix, or neither — in which case we can report but
# not install, and we say so rather than failing with a bare permission error.
SUDO=""
if [ "$MANAGER" != "brew" ] && [ "$(id -u)" != "0" ]; then
	if command -v sudo >/dev/null 2>&1; then
		SUDO="sudo"
	fi
fi

confirm() {
	[ "$ASSUME_YES" = "1" ] && return 0
	[ -t 0 ] || return 0 # non-interactive: proceed rather than hang on read
	printf '  run: %s\n  proceed? [Y/n] ' "$1"
	read -r reply
	case "$reply" in n | N | no | NO) return 1 ;; *) return 0 ;; esac
}

run_step() {
	local description="$1"
	shift
	echo "  $description"
	if ! "$@"; then
		echo "  FAILED: $description" >&2
		return 1
	fi
}

# --- ffmpeg -----------------------------------------------------------------

have_ffmpeg() {
	command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1
}

install_ffmpeg() {
	case "$MANAGER" in
	brew)
		confirm "brew install ffmpeg" || return 1
		run_step "installing ffmpeg via homebrew" brew install ffmpeg
		;;
	apt)
		confirm "$SUDO apt-get install -y ffmpeg" || return 1
		run_step "apt-get update" $SUDO apt-get update -qq
		run_step "installing ffmpeg" $SUDO apt-get install -y -qq ffmpeg
		;;
	dnf)
		# Fedora and RHEL carry no `ffmpeg` package at all — only `ffmpeg-free`,
		# which is built without libx264, and libx264 is exactly what
		# lib/assemble.ts encodes the finished mp4 with. RPM Fusion is therefore
		# required rather than preferred. (Verified against fedora:40,
		# 2026-08-31: `dnf list ffmpeg` returns nothing on a stock image.)
		confirm "enable RPM Fusion, then $SUDO dnf install -y ffmpeg" || return 1
		local fedora_release
		fedora_release="$(rpm -E %fedora 2>/dev/null || echo "")"
		if [ -n "$fedora_release" ]; then
			run_step "enabling RPM Fusion (free)" $SUDO dnf install -y \
				"https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-${fedora_release}.noarch.rpm"
		else
			echo "  note: could not read the Fedora release number;" \
				"enable RPM Fusion manually — https://rpmfusion.org" >&2
		fi
		run_step "installing ffmpeg" $SUDO dnf install -y ffmpeg
		;;
	pacman)
		confirm "$SUDO pacman -S --needed ffmpeg" || return 1
		run_step "installing ffmpeg" $SUDO pacman -S --needed --noconfirm ffmpeg
		;;
	apk)
		confirm "$SUDO apk add ffmpeg" || return 1
		run_step "installing ffmpeg" $SUDO apk add ffmpeg
		;;
	*)
		echo "  cannot install ffmpeg automatically — unrecognised system." >&2
		echo "  Install ffmpeg and ffprobe with your package manager." >&2
		return 1
		;;
	esac
}

# --- playwright's chromium --------------------------------------------------

# The CLI, preferring the version this repo pins. `bunx playwright` would
# resolve a different build than the library actually loads, and the two agree
# on a browser revision or nothing works.
playwright_cli() {
	if [ -x "$ROOT/scripts/node_modules/.bin/playwright" ]; then
		echo "$ROOT/scripts/node_modules/.bin/playwright"
	elif [ -x "$ROOT/node_modules/.bin/playwright" ]; then
		echo "$ROOT/node_modules/.bin/playwright"
	fi
}

have_chromium() {
	local cli
	cli="$(playwright_cli)"
	[ -n "$cli" ] || return 1
	# `playwright install --dry-run chromium` prints the resolved install
	# location and exits 0 whether or not it is there, so it cannot answer this.
	# Ask the library where the binary is and test for the file.
	(cd "$ROOT/scripts" && bun -e '
		const { chromium } = await import("playwright");
		const p = chromium.executablePath();
		process.exit((await Bun.file(p).exists()) ? 0 : 1);
	') >/dev/null 2>&1
}

install_chromium() {
	local cli
	cli="$(playwright_cli)"
	if [ -z "$cli" ]; then
		echo "  playwright is not installed — run \`bun install\` first." >&2
		return 1
	fi

	# On Linux the browser binary alone is not enough: headless Chromium needs a
	# set of shared libraries no distro installs by default. Those go in as root;
	# the browser itself must NOT, because Playwright caches it under $HOME and a
	# root-owned cache is invisible to the user who runs the demo.
	if [ "$MANAGER" != "brew" ]; then
		if [ -z "$SUDO" ] && [ "$(id -u)" != "0" ]; then
			echo "  note: no sudo available — skipping Chromium's system" \
				"libraries. Install them with:" >&2
			echo "        sudo $cli install-deps chromium" >&2
		else
			confirm "$SUDO $cli install-deps chromium" || return 1
			run_step "installing Chromium's system libraries" \
				$SUDO "$cli" install-deps chromium
		fi
	fi

	confirm "$cli install chromium" || return 1
	run_step "downloading Chromium" "$cli" install chromium
}

# --- report -----------------------------------------------------------------

echo "demo-video dependencies  (${MANAGER:-unrecognised system})"

missing=0

if have_ffmpeg; then
	echo "  ok       ffmpeg + ffprobe"
else
	echo "  MISSING  ffmpeg + ffprobe"
	missing=$((missing + 1))
	NEED_FFMPEG=1
fi

if have_chromium; then
	echo "  ok       playwright chromium"
else
	echo "  MISSING  playwright chromium"
	missing=$((missing + 1))
	NEED_CHROMIUM=1
fi

if [ "$missing" = "0" ]; then
	echo "nothing to do."
	exit 0
fi

if [ "$MODE" = "check" ]; then
	echo
	echo "run \`bun run demo:deps\` to install the missing pieces."
	exit 1
fi

echo
failed=0
[ "${NEED_FFMPEG:-0}" = "1" ] && { install_ffmpeg || failed=1; }
[ "${NEED_CHROMIUM:-0}" = "1" ] && { install_chromium || failed=1; }

echo
if [ "$failed" = "1" ]; then
	echo "some dependencies were not installed — see the messages above." >&2
	exit 1
fi

# Re-check rather than trusting the installers' exit codes. A package manager
# can succeed and still leave nothing on PATH (a shell hash miss, a brew keg
# that was not linked), and a green exit that has not been probed is exactly the
# failure this pipeline's preflight exists to prevent.
if have_ffmpeg && have_chromium; then
	echo "all demo-video dependencies are installed."
	exit 0
fi

echo "install reported success but the tools are still not usable." >&2
echo "Open a new shell and re-run \`bun run demo:deps --check\`." >&2
exit 1
