#!/usr/bin/env bash
# Installs the profile scripts where the round expects them: $EVALS_BIN (default dirname($EVALS_STORE)/bin), mode 700, JSON data at 600.
# If the destination already holds a DIFFERENT copy it refuses and changes nothing: pass --force to back it up to <dest>.bak-<UTC date-time>
# and install anyway. It writes nothing outside the destination and that backup, and runs no opencode command.
set -euo pipefail

force=0
for a in "$@"; do
  case "$a" in
    --force) force=1 ;;
    -h|--help) sed -n '2,4p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install.sh: unknown argument $a (see --help)" >&2; exit 2 ;;
  esac
done

export EVALS_STORE="${EVALS_STORE:-$HOME/evals-232/store}"
dest="${EVALS_BIN:-$(dirname "$EVALS_STORE")/bin}"
here="$(dirname "$(readlink -f "$0")")"
files=(profile-lib.mjs auth-targets.mjs service-port.mjs check-real.mjs check-real.sh keeper.mjs evals-profile.sh ensure-port.mjs write-config.mjs signin.sh guard-real.mjs log-signin.mjs copy-client.mjs identity-methods.json rpc-methods.fixture.json)

# Never overwrite a tree that differs from this repository's copies, unless asked: a hand edit or an older round may be there.
if [ -d "$dest" ]; then
  changed=""
  for f in "${files[@]}"; do
    if [ -f "$dest/$f" ] && ! cmp -s "$here/$f" "$dest/$f"; then changed="$changed $f"; fi
  done
  if [ -n "$changed" ]; then
    if [ "$force" != 1 ]; then
      echo "install.sh: $dest already holds a different copy:$changed" >&2
      echo "Refusing to overwrite it. Re-run with --force to back it up to $dest.bak-<UTC date-time> and install this copy." >&2
      exit 1
    fi
    backup="$dest.bak-$(date -u +%Y%m%dT%H%M%SZ)"
    cp -a "$dest" "$backup"
    echo "install.sh: backed up $dest to $backup"
  fi
fi

mkdir -p "$dest"; chmod 700 "$dest"
for f in "${files[@]}"; do
  case "$f" in
    *.json) install -m 600 "$here/$f" "$dest/$f" ;;
    *) install -m 700 "$here/$f" "$dest/$f" ;;
  esac
done
echo "installed to $dest: signin.sh check-real.sh evals-profile.sh keeper.mjs"
