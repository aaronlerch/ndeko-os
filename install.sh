#!/usr/bin/env bash
#
# install.sh — mount this ndeko-os checkout as ~/.claude.
#
# WHY A SYMLINK AND NOT A RENAME
#
# Claude Code reads its configuration from ~/.claude (or CLAUDE_CONFIG_DIR).
# The obvious install is to name the repo ~/.claude directly, and that is what
# an earlier plan for this tree did. It is worse, for three reasons:
#
#   1. Repo identity stops being visible. `~/.claude` says nothing about what
#      is checked out there or which remote it tracks.
#   2. The mount point becomes the clone path, so the harness can only ever
#      live in one place — no side-by-side testing of a second checkout.
#   3. Claude Code writes session runtime (projects/, sessions/, history.jsonl)
#      into the config dir. Mixing that into the repo root is survivable
#      because .gitignore covers it, but the coupling is invisible.
#
# A symlink keeps the repo named for what it is, makes the mount point a
# one-line thing to repoint, and makes uninstall exact.
#
# WHAT THIS SCRIPT GUARANTEES
#
#   * It never deletes a real directory. An existing ~/.claude that is a real
#     directory is MOVED to a timestamped backup, never removed.
#   * It is idempotent. Running it when already correctly linked changes
#     nothing and exits 0.
#   * It refuses rather than guesses. Anything ambiguous stops the script with
#     a message saying what to do.
#   * --check makes no changes at all, so you can see the plan first.
#
# Usage:
#   ./install.sh              install or repair
#   ./install.sh --check      report what would change, touch nothing
#   ./install.sh --force      proceed past the "backup exists" guard
#   ./install.sh --uninstall  remove the ~/.claude symlink (repo untouched)

set -euo pipefail

# ─── Repo root is derived from THIS SCRIPT'S location ────────────────────────
# Same principle as hooks/lib/paths.ts: a literal would go stale the moment the
# checkout moved, and the failure would be silent. `install.sh` always sits at
# the repo root, so the root is wherever this file is.
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

MOUNT="$HOME/.claude"
DATA_DIR="${NDEKO_DATA_DIR:-$HOME/.config/ndeko-os}"
DATA_DIR="${DATA_DIR/#\$HOME/$HOME}"
DATA_DIR="${DATA_DIR/#\~/$HOME}"

CHECK=0
FORCE=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --check|-n|--dry-run) CHECK=1 ;;
    --force)              FORCE=1 ;;
    --uninstall)          UNINSTALL=1 ;;
    -h|--help)            sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's|^# \{0,1\}||'; exit 0 ;;
    *) printf 'install.sh: unknown argument %s (try --help)\n' "$arg" >&2; exit 2 ;;
  esac
done

# ─── Output helpers ─────────────────────────────────────────────────────────
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; X=$'\033[0m'
else B=""; G=""; Y=""; R=""; D=""; X=""; fi

say()  { printf '%s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$X" "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$X" "$*"; }
info() { printf '  %s·%s %s\n' "$D" "$X" "$*"; }
die()  { printf '\n%sinstall.sh: %s%s\n' "$R" "$*" "$X" >&2; exit 1; }
act()  { printf '  %s→%s %s\n' "$B" "$X" "$*"; }

# Collapse $HOME to ~ so output is copy-pasteable and carries no username.
# The replacement lives in a variable because a bare `~` in the replacement is
# tilde-expanded and an escaped `\~` emits a literal backslash. Both are wrong.
tilde() { local t='~'; printf '%s' "${1/#$HOME/$t}"; }

step() { printf '\n%s%s%s\n' "$B" "$*" "$X"; }

# ─── Preflight ──────────────────────────────────────────────────────────────
step "ndeko-os installer"
info "repo   $(tilde "$REPO_ROOT")"
info "mount  $(tilde "$MOUNT")"
info "data   $(tilde "$DATA_DIR")"
[ "$CHECK" -eq 1 ] && info "mode   --check (no changes will be made)"

# The repo must actually look like the harness. Symlinking an arbitrary
# directory to ~/.claude would break every session on the machine, so this is a
# hard gate rather than a warning.
for required in settings.json CLAUDE.md system-prompt.md hooks/lib/paths.ts; do
  [ -e "$REPO_ROOT/$required" ] || die "$(tilde "$REPO_ROOT") is missing $required — this does not look like an ndeko-os checkout."
done

# ─── Uninstall ──────────────────────────────────────────────────────────────
if [ "$UNINSTALL" -eq 1 ]; then
  step "Uninstall"
  if [ -L "$MOUNT" ]; then
    target="$(readlink "$MOUNT")"
    if [ "$CHECK" -eq 1 ]; then
      act "would remove symlink $(tilde "$MOUNT") -> $(tilde "$target")"
    else
      rm "$MOUNT"
      ok "removed symlink $(tilde "$MOUNT") (was -> $(tilde "$target"))"
    fi
    say ""
    say "The repo at $(tilde "$REPO_ROOT") is untouched."
    say "Claude Code will fall back to creating a fresh $(tilde "$MOUNT") on next launch."
  elif [ -e "$MOUNT" ]; then
    die "$(tilde "$MOUNT") is a real directory, not a symlink. Refusing to touch it — remove it yourself if that is what you want."
  else
    ok "nothing to do — $(tilde "$MOUNT") does not exist"
  fi
  exit 0
fi

# ─── Dependencies ───────────────────────────────────────────────────────────
step "Dependencies"
if command -v bun >/dev/null 2>&1; then
  ok "bun $(bun --version)"
else
  # Not fatal: the symlink is still the right thing to create, and the hooks
  # will simply not fire until bun exists. Saying so beats failing opaquely at
  # the first SessionStart.
  warn "bun not found — hooks and tools will not run until it is installed (brew install oven-sh/bun/bun)"
fi
if command -v claude >/dev/null 2>&1; then
  ok "claude $(claude --version 2>/dev/null | head -1)"
else
  warn "claude CLI not found on PATH"
fi

# ─── The mount point ────────────────────────────────────────────────────────
step "Mount point"
NEED_LINK=1

if [ -L "$MOUNT" ]; then
  current="$(cd -- "$(dirname -- "$MOUNT")" && cd -- "$(readlink "$MOUNT")" 2>/dev/null && pwd -P || true)"
  raw="$(readlink "$MOUNT")"
  if [ "$current" = "$REPO_ROOT" ]; then
    ok "already linked: $(tilde "$MOUNT") -> $(tilde "$raw")"
    NEED_LINK=0
  else
    warn "points elsewhere: $(tilde "$MOUNT") -> $(tilde "$raw")"
    if [ "$CHECK" -eq 1 ]; then
      act "would repoint to $(tilde "$REPO_ROOT")"
    else
      rm "$MOUNT"
      act "removed stale symlink (target directory left alone)"
    fi
  fi
elif [ -e "$MOUNT" ]; then
  # A real directory. This is the dangerous case and the reason the script
  # exists: it holds live session history and possibly a previous harness.
  # Move it aside; never delete it.
  stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  backup="$HOME/.claude.backup-$stamp"
  size="$(du -sh "$MOUNT" 2>/dev/null | cut -f1 | tr -d ' ')"
  warn "$(tilde "$MOUNT") is a REAL directory (${size:-unknown})"
  if [ -e "$backup" ] && [ "$FORCE" -eq 0 ]; then
    die "backup path $(tilde "$backup") already exists. Re-run with --force to pick a new name."
  fi
  if [ "$CHECK" -eq 1 ]; then
    act "would move it to $(tilde "$backup") — nothing deleted"
  else
    mv "$MOUNT" "$backup"
    ok "moved to $(tilde "$backup") — nothing deleted"
  fi
else
  info "$(tilde "$MOUNT") does not exist yet"
fi

if [ "$NEED_LINK" -eq 1 ]; then
  if [ "$CHECK" -eq 1 ]; then
    act "would link $(tilde "$MOUNT") -> $(tilde "$REPO_ROOT")"
  else
    ln -s "$REPO_ROOT" "$MOUNT"
    ok "linked $(tilde "$MOUNT") -> $(tilde "$REPO_ROOT")"
  fi
fi

# ─── The data tree ──────────────────────────────────────────────────────────
# Deliberately OUTSIDE the repo so `git clean -xdf` cannot destroy memory.
# Created empty; never populated by the installer, because everything in it is
# personal and belongs to whoever is installing.
step "Data tree"
if [ -d "$DATA_DIR" ]; then
  # -d follows symlinks, which is what we want: a data tree reached through a
  # symlink is a perfectly good data tree. Only report the indirection.
  if [ -L "$DATA_DIR" ]; then
    ok "exists: $(tilde "$DATA_DIR") -> $(tilde "$(cd -- "$DATA_DIR" && pwd -P)")"
  else
    ok "exists: $(tilde "$DATA_DIR")"
  fi
  # A stale NDEKO_DATA_DIR is the normal symptom of a shell or session that
  # predates the rename, so name it rather than silently honouring it.
  if [ -n "${NDEKO_DATA_DIR:-}" ] && [ "$DATA_DIR" != "$HOME/.config/ndeko-os" ]; then
    warn "NDEKO_DATA_DIR in this shell points at $(tilde "$DATA_DIR"), not the canonical $(tilde "$HOME/.config/ndeko-os")"
    info "settings.json sets the value sessions actually use; this is just your shell"
  fi
else
  if [ "$CHECK" -eq 1 ]; then
    act "would create $(tilde "$DATA_DIR") with memory/ identity/ state/"
  else
    mkdir -p "$DATA_DIR/memory" "$DATA_DIR/identity" "$DATA_DIR/state"
    ok "created $(tilde "$DATA_DIR") with memory/ identity/ state/"
    info "populate identity/principal.md and goals.md yourself — the installer will not"
  fi
fi

# ─── Git hooks ──────────────────────────────────────────────────────────────
# The privacy gate has to travel with the repository, and `.git/hooks/` never
# does — it is per-clone, so a hook installed there protects one machine and
# silently protects nothing on a fresh clone. `core.hooksPath` redirects hook
# lookup at a tracked directory, which makes the gate part of the artifact.
#
# Set with --local: this is a property of this checkout, and stamping a global
# core.hooksPath would point every unrelated repo on the machine at these hooks.
step "Git hooks"
HOOKS_REL="hooks/git"
if [ ! -d "$REPO_ROOT/.git" ] && [ ! -f "$REPO_ROOT/.git" ]; then
  info "not a git checkout — skipping hook wiring"
elif [ ! -x "$REPO_ROOT/$HOOKS_REL/pre-commit" ] || [ ! -x "$REPO_ROOT/$HOOKS_REL/commit-msg" ]; then
  warn "$HOOKS_REL/pre-commit or $HOOKS_REL/commit-msg is missing or not executable"
  info "fix with: chmod +x $HOOKS_REL/pre-commit $HOOKS_REL/commit-msg"
else
  current_hooks="$(git -C "$REPO_ROOT" config --local --get core.hooksPath 2>/dev/null || true)"
  if [ "$current_hooks" = "$HOOKS_REL" ]; then
    ok "core.hooksPath -> $HOOKS_REL"
  elif [ "$CHECK" -eq 1 ]; then
    act "would set core.hooksPath to $HOOKS_REL (currently: ${current_hooks:-unset})"
  else
    git -C "$REPO_ROOT" config --local core.hooksPath "$HOOKS_REL"
    ok "core.hooksPath -> $HOOKS_REL (was: ${current_hooks:-unset})"
  fi
  info "pre-commit and commit-msg run tools/privacy-scan.ts; bypass with git commit --no-verify"
fi

# ─── Shell integration ──────────────────────────────────────────────────────
step "Shell integration"
alias_line="alias ndeko='bun ~/.claude/tools/ndeko.ts'"
shell_rc="$HOME/.zshrc"
[ -n "${BASH_VERSION:-}" ] && [ ! -f "$shell_rc" ] && shell_rc="$HOME/.bashrc"
if [ -f "$shell_rc" ] && grep -qF "tools/ndeko.ts" "$shell_rc" 2>/dev/null; then
  ok "launcher alias present in $(tilde "$shell_rc")"
else
  warn "no launcher alias found in $(tilde "$shell_rc")"
  info "add it yourself (the installer does not edit your shell config):"
  printf '      %s\n' "$alias_line"
fi

# ─── Verify ─────────────────────────────────────────────────────────────────
# The install is not "done" because the symlink exists — it is done when the
# harness resolves its own roots through it. That is the only check that
# exercises the same path a real session does.
if [ "$CHECK" -eq 1 ]; then
  step "Check complete"
  say "No changes were made. Re-run without --check to apply."
  exit 0
fi

step "Verify"
verify_failed=0
if command -v bun >/dev/null 2>&1; then
  # Resolve through the MOUNT, not the repo path: if the symlink is wrong, this
  # is the probe that catches it.
  if roots="$(cd "$MOUNT" && CLAUDE_CONFIG_DIR= NDEKO_DATA_DIR= bun hooks/lib/paths.ts 2>&1)"; then
    printf '%s\n' "$roots" | sed 's/^/      /'
    if printf '%s' "$roots" | grep -q 'MISSING\|unresolved'; then
      warn "a root or the algorithm file did not resolve"
      verify_failed=1
    else
      ok "both roots and the algorithm file resolve through $(tilde "$MOUNT")"
    fi
  else
    warn "paths.ts failed to run:"
    printf '%s\n' "$roots" | sed 's/^/      /'
    verify_failed=1
  fi

  if gate="$(cd "$MOUNT" && bun tools/PathGate.ts 2>&1)"; then
    ok "PathGate: no hardcoded config-root literals"
  else
    printf '%s\n' "$gate" | sed 's/^/      /'
    warn "PathGate failed"
    verify_failed=1
  fi

  # The privacy gate is the one check whose failure is permanent and public, so
  # the installer runs it rather than waiting for the first commit to find out.
  if privacy="$(cd "$MOUNT" && bun tools/privacy-scan.ts --all 2>&1)"; then
    ok "privacy-scan: tracked tree is clean"
  else
    printf '%s\n' "$privacy" | sed 's/^/      /'
    warn "privacy-scan found content that must not be published"
    verify_failed=1
  fi

  # Hook files must be present AND wired. A hook named in settings.json that
  # does not exist on disk is a gate that silently never fires.
  missing_hooks=""
  while IFS= read -r hook; do
    resolved="${hook/\$HOME/$HOME}"
    [ -e "$resolved" ] || missing_hooks="$missing_hooks $hook"
  done < <(grep -o '\$HOME/[^"]*\.hook\.ts' "$MOUNT/settings.json" | sort -u)
  if [ -n "$missing_hooks" ]; then
    warn "settings.json names hook files that do not exist:$missing_hooks"
    verify_failed=1
  else
    ok "every hook named in settings.json exists on disk"
  fi
else
  warn "bun missing — skipping verification (the install itself is in place)"
  verify_failed=1
fi

# ─── Result ─────────────────────────────────────────────────────────────────
step "Result"
if [ "$verify_failed" -eq 0 ]; then
  say "  ${G}Installed and verified.${X}  $(tilde "$MOUNT") -> $(tilde "$REPO_ROOT")"
else
  say "  ${Y}Installed, but verification was incomplete.${X} See the warnings above."
fi
say ""
say "  ${B}Restart any running Claude Code session${X} — a live session holds the old"
say "  absolute config path in its environment and will not pick this up."
say ""
say "  Next:  ndeko            launch a session against this tree"
say "         bun test         224 tests over the hooks, guards and privacy gate"
say "         ./install.sh -n  re-check the install without changing anything"
say ""
exit 0
