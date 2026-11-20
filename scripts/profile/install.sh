#!/usr/bin/env bash
# Installs the profile scripts where the round expects them: $EVALS_BIN (default $HOME/evals-232/bin), mode 700.
# The scripts are self-contained: service-port.mjs sits beside them, so nothing is rewritten on the way out.
set -euo pipefail
export EVALS_STORE="${EVALS_STORE:-$HOME/evals-232/store}"
dest="${EVALS_BIN:-$(dirname "$EVALS_STORE")/bin}"
mkdir -p "$dest"; chmod 700 "$dest"
here="$(dirname "$(readlink -f "$0")")"
for f in profile-lib.mjs service-port.mjs check-real.mjs check-real.sh keeper.mjs evals-profile.sh ensure-port.mjs write-config.mjs signin.sh guard-real.mjs log-signin.mjs copy-client.mjs identity-methods.json rpc-methods.fixture.json; do
  install -m 700 "$here/$f" "$dest/$f"
done
echo "installed to $dest: signin.sh check-real.sh evals-profile.sh keeper.mjs"
