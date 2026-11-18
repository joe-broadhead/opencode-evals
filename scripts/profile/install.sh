#!/usr/bin/env bash
# Installs the profile scripts where the round expects them: $EVALS_BIN (default $HOME/evals-232/bin), mode 700.
set -euo pipefail
export EVALS_STORE="${EVALS_STORE:-$HOME/evals-232/store}"
dest="${EVALS_BIN:-$(dirname "$EVALS_STORE")/bin}"
mkdir -p "$dest"; chmod 700 "$dest"
here="$(dirname "$(readlink -f "$0")")"
for f in profile-lib.mjs check-real.mjs check-real.sh keeper.mjs evals-profile.sh; do install -m 700 "$here/$f" "$dest/$f"; done
echo "installed to $dest: check-real.sh evals-profile.sh keeper.mjs"
