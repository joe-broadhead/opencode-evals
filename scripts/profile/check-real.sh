#!/usr/bin/env bash
# check-real.sh <integration>: after the evals profile is signed into <integration>, prove the REAL profile still works.
# Prints PASS or FAIL and the reason, never a token. See check-real.mjs.
set -euo pipefail
export EVALS_STORE="${EVALS_STORE:-$HOME/evals-232/store}"
export EVALS_PROFILE="${EVALS_PROFILE:-$HOME/evals-232/profile}"
exec node "$(dirname "$(readlink -f "$0")")/check-real.mjs" "$@"
