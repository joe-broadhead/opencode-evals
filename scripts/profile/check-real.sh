#!/usr/bin/env bash
# check-real.sh <integration> [--skip-unsigned]: after the evals profile is signed into <integration>, prove the REAL profile still works.
# Prints PASS or FAIL and the reason, never a token. See check-real.mjs.
# EVALS_PROFILE, EVALS_STORE, EVALS_REAL_SERVER and EVALS_REAL_SERVER_ENV move its paths; each defaults to today's value.
set -euo pipefail
REAL_HOME="${EVALS_REAL_HOME:-$HOME}"
export EVALS_STORE="${EVALS_STORE:-$REAL_HOME/evals-232/store}"
export EVALS_PROFILE="${EVALS_PROFILE:-$REAL_HOME/evals-232/profile}"
exec node "$(dirname "$(readlink -f "$0")")/check-real.mjs" "$@"
