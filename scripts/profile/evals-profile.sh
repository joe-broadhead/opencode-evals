#!/usr/bin/env bash
# evals-profile.sh -- <command...>: run a command inside the evals profile (EVALS-232 §1.2.1).
#
# HOME, OPENCODE_TEST_HOME and XDG_* point into the profile; it gets an EMPTY .claude and CLAUDE_CONFIG_DIR, the Claude Code
# integration is off, and nothing is linked out of it (the lab's envclean.sh symlinked the real ~/.claude: this does not).
# The profile's config denies the claude-agent provider, so it never spawns `claude`. Check: `find "$EVALS_PROFILE" -type l` prints only
# PulseAudio's own runtime link, the one exception below.
#
# Paths (env, with today's values as defaults): EVALS_PROFILE, the profile; EVALS_STORE, the private store; EVALS_REAL_HOME, the owner's
# home (the profile and store default under it); EVALS_REAL_SERVICE_PORT, the real background service's port.
set -euo pipefail
umask 077
HERE="$(dirname "$(readlink -f "$0")")"
REAL_HOME="${EVALS_REAL_HOME:-$HOME}"
export EVALS_STORE="${EVALS_STORE:-$REAL_HOME/evals-232/store}"
P="${EVALS_PROFILE:-$REAL_HOME/evals-232/profile}"
mkdir -p "$P/.config/opencode" "$P/.local/share" "$P/.local/state" "$P/.cache" "$P/.claude"
chmod 700 "$P"
# The config: the claude-agent deny and the walk's pinned plugins ($EVALS_STORE/evals-plugins.json). Every vendor after OpenRouter is a plugin's
# integration, so a profile without them cannot sign into it.
node "$HERE/write-config.mjs" "$P"
[ "${1:-}" = "--" ] && shift
[ "$#" -gt 0 ] || { echo "usage: evals-profile.sh -- <command...>" >&2; exit 2; }
for v in $(env | cut -d= -f1 | grep -E '^(OPENCODE_|XDG_|CLAUDE_)' || true); do unset "$v"; done
export HOME="$P" OPENCODE_TEST_HOME="$P" XDG_CONFIG_HOME="$P/.config" XDG_DATA_HOME="$P/.local/share" XDG_CACHE_HOME="$P/.cache" XDG_STATE_HOME="$P/.local/state" CLAUDE_CONFIG_DIR="$P/.claude" OPENCODE_DISABLE_CLAUDE_CODE=1 OPENCODE_DISABLE_AUTOUPDATE=1
# The profile's own service port: 47950, or the next free one, never the real service's (G0 review 4.1).
EVALS_REAL_HOME="$REAL_HOME" node "$HERE/ensure-port.mjs" "$P" "${OPENCODE_BIN:-opencode}"
# No symbolic link may reach out of the profile (a link could reach the real one). Each link is judged on its own: a `find` glob's `*` matches `/` and
# `..`, so neither the path nor the target is matched with one. The one exception: PulseAudio's client library, started by a browser the sign-in opens,
# leaves .config/pulse/<name>-runtime -> /tmp/pulse-<id>, a private audio socket directory, not a path into any profile. It is excepted only when its
# path is exactly that (one <name>, no `/`), its unresolved readlink is /tmp/pulse-<id> with <id> letters and digits only, and the target is a real
# directory (not a link) owned by this user. Anything else is refused.
#
# Sets PULSE_NAME and PULSE_TARGET when the link has that exact shape, whatever its target is: 0 when it does, 1 when it does not.
pulse_link_parts() {
  local link="$1" rel rest target
  # Exactly $P/.config/pulse/<name>-runtime: the prefix once, then one component with a -runtime suffix.
  rel="${link#"$P"/.config/pulse/}"
  [ "$rel" != "$link" ] || return 1
  case "$rel" in */*) return 1 ;; esac
  case "$rel" in *-runtime) PULSE_NAME="${rel%-runtime}" ;; *) return 1 ;; esac
  [ -n "$PULSE_NAME" ] || return 1
  # The link's own text, not a resolved path.
  target="$(readlink -- "$link")" || return 1
  rest="${target#/tmp/pulse-}"
  [ "$rest" != "$target" ] || return 1
  [ -n "$rest" ] || return 1
  case "$rest" in *[!A-Za-z0-9]*) return 1 ;; esac
  PULSE_TARGET="$target"
  return 0
}
# The one link it accepts: the shape above, and the target a real directory (not a link) owned by this user.
pulse_link_ok() {
  local link="$1"
  pulse_link_parts "$link" || return 1
  [ -d "$PULSE_TARGET" ] && [ ! -L "$PULSE_TARGET" ] || return 1
  [ "$(stat -c %u -- "$PULSE_TARGET" 2>/dev/null)" = "$(id -u)" ] || return 1
  return 0
}
# A stale PulseAudio link: the exact legitimate name and target shape, and the target is gone (a reboot, or PulseAudio exiting). Only that link is
# removed, and only when its target is absent (neither a file nor a link: a link or a file is a wrong target, not a stale one). Anything else is refused.
pulse_link_stale() {
  pulse_link_parts "$1" || return 1
  [ ! -e "$PULSE_TARGET" ] && [ ! -L "$PULSE_TARGET" ] || return 1
  return 0
}
# find's own failure must fail the run: a link under a directory find cannot read would otherwise never be seen (fail open; review 6, note 1).
LINKS="$(mktemp "${TMPDIR:-/tmp}/evals-profile-links.XXXXXX")"
trap 'rm -f -- "$LINKS"' EXIT
if ! find "$P" -type l -print0 >"$LINKS"; then
  echo "evals-profile: find could not read every directory under $P: refusing to run (it cannot see every link, so it cannot judge them)" >&2
  exit 1
fi
while IFS= read -r -d '' link; do
  if pulse_link_ok "$link"; then continue; fi
  if pulse_link_stale "$link"; then
    if rm -f -- "$link"; then
      echo "evals-profile: removed the stale PulseAudio link $link (its target $PULSE_TARGET no longer exists; PulseAudio recreates it)" >&2
      continue
    fi
    echo "evals-profile: a symbolic link under $P: refusing to run (it is stale but could not be removed): $link" >&2
    exit 1
  fi
  echo "evals-profile: a symbolic link under $P: refusing to run: $link" >&2
  exit 1
done < "$LINKS"
trap - EXIT
rm -f -- "$LINKS"
exec "$@"
