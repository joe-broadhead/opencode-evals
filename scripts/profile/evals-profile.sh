#!/usr/bin/env bash
# evals-profile.sh -- <command...>: run a command inside the evals profile (EVALS-232 §1.2.1).
#
# HOME, OPENCODE_TEST_HOME and XDG_* point into the profile; it gets an EMPTY .claude and CLAUDE_CONFIG_DIR, the Claude Code
# integration is off, and nothing is linked out of it (the lab's envclean.sh symlinked the real ~/.claude: this does not).
# The profile's config denies the claude-agent provider, so it never spawns `claude`. Check: `find "$EVALS_PROFILE" -type l`
# prints nothing.
set -euo pipefail
umask 077
HERE="$(dirname "$(readlink -f "$0")")"
REAL_HOME="${EVALS_REAL_HOME:-$HOME}"
export EVALS_STORE="${EVALS_STORE:-$HOME/evals-232/store}"
P="${EVALS_PROFILE:-$HOME/evals-232/profile}"
mkdir -p "$P/.config/opencode" "$P/.local/share" "$P/.local/state" "$P/.cache" "$P/.claude"
chmod 700 "$P"
cat > "$P/.config/opencode/opencode.json" <<'JSON'
{ "policies": [ { "action": "provider.use", "resource": "claude-agent", "effect": "deny" } ] }
JSON
[ "${1:-}" = "--" ] && shift
[ "$#" -gt 0 ] || { echo "usage: evals-profile.sh -- <command...>" >&2; exit 2; }
for v in $(env | cut -d= -f1 | grep -E '^(OPENCODE_|XDG_|CLAUDE_)' || true); do unset "$v"; done
export HOME="$P" OPENCODE_TEST_HOME="$P" XDG_CONFIG_HOME="$P/.config" XDG_DATA_HOME="$P/.local/share" XDG_CACHE_HOME="$P/.cache" XDG_STATE_HOME="$P/.local/state" CLAUDE_CONFIG_DIR="$P/.claude" OPENCODE_DISABLE_CLAUDE_CODE=1 OPENCODE_DISABLE_AUTOUPDATE=1
# The profile's own service port: 47950, or the next free one, never the real service's (G0 review 4.1).
EVALS_REAL_HOME="$REAL_HOME" node "$HERE/ensure-port.mjs" "$P" "${OPENCODE_BIN:-opencode}"
if [ -n "$(find "$P" -type l 2>/dev/null | head -1)" ]; then echo "evals-profile: a symbolic link under $P: refusing to run" >&2; exit 1; fi
exec "$@"
