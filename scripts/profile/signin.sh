#!/usr/bin/env bash
# signin.sh: the owner's sign-in walk (EVALS-232 plan section 1.2.3). Signs the evals profile into each vendor, ONE AT A TIME, in the plan's
# order, and after each sign-in runs check-real.sh for that vendor against the NORMAL profile: the normal profile must still read, and its tokens
# must differ from the evals profile's.
#
#   ~/evals-232/bin/signin.sh                run the walk (each vendor waits for Enter, Ctrl-C stops)
#   ~/evals-232/bin/signin.sh --list         the order, and which vendors have already passed
#   ~/evals-232/bin/signin.sh --from slack   start at a vendor (the ones before it must have passed)
#   ~/evals-232/bin/signin.sh --only slack   one vendor
#   ~/evals-232/bin/signin.sh --redo         forget what passed
#   ~/evals-232/bin/signin.sh --yes          no Enter prompts (a vendor's own sign-in still opens its page)
#
# GitHub and Jira are NOT signed in: their cases run with no account (`accounts: none`). Slack, X and Google use the apps already configured: no
# second app or client. OpenRouter and Affinity are new (not in the normal profile): check-real only proves their evals sign-in.
# On any failure it stops, names the vendor and prints the one-line fix. It prints no token: the sign-in is `opencode auth login` in the evals
# profile, which handles its own secrets, and check-real prints only PASS or FAIL and the reason.
set -uo pipefail

ORDER="openrouter affinity ashby plaud gws slack x elevenlabs wisprflow metaview granola notion linear"
EXCLUDED="github jira"
B="${EVALS_BIN:-$HOME/evals-232/bin}"
STORE="${EVALS_STORE:-$HOME/evals-232/store}"
OC="${OPENCODE_BIN:-opencode}"
PASSED="$STORE/signin-passed"
mkdir -p "$STORE"; chmod 700 "$STORE" 2>/dev/null || true
touch "$PASSED"; chmod 600 "$PASSED" 2>/dev/null || true

from=""; only=""; list=0; redo=0; yes=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --from) from="${2:-}"; shift 2 ;;
    --only) only="${2:-}"; shift 2 ;;
    --list) list=1; shift ;;
    --redo) redo=1; shift ;;
    --yes) yes=1; shift ;;
    -h|--help) sed -n 2,16p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "signin.sh: unknown argument $1 (see --help)" >&2; exit 2 ;;
  esac
done

known() { local x; for x in $ORDER; do [ "$x" = "$1" ] && return 0; done; return 1; }
passed() { grep -qx "$1" "$PASSED"; }
for v in $from $only; do
  case " $EXCLUDED " in *" $v "*) echo "signin.sh: $v is not signed in: its cases run with no account (accounts: none)" >&2; exit 2 ;; esac
  known "$v" || { echo "signin.sh: no vendor $v: $ORDER" >&2; exit 2; }
done
[ "$redo" = 1 ] && : > "$PASSED"

if [ "$list" = 1 ]; then
  n=0
  for v in $ORDER; do n=$((n+1)); printf '%2d. %-11s %s\n' "$n" "$v" "$(passed "$v" && echo passed || echo "not yet")"; done
  echo "    (github and jira: not signed in; their cases run with no account)"
  exit 0
fi

# a token-shaped run of characters is never shown, whatever a tool printed
mask() { sed -E 's/[A-Za-z0-9_.~+\/=-]{32,}/***/g'; }

total=$(echo $ORDER | wc -w | tr -d ' ')
n=0
started=0; [ -z "$from" ] && started=1
for v in $ORDER; do
  n=$((n+1))
  [ -n "$only" ] && [ "$v" != "$only" ] && continue
  if [ "$started" = 0 ]; then
    if [ "$v" = "$from" ]; then started=1; else
      passed "$v" || { echo "STOP: --from $from needs $v to have passed first (it has not): run signin.sh --from $v" >&2; exit 1; }
      continue
    fi
  fi
  if passed "$v"; then echo "[$n/$total] $v: already passed (--redo to repeat)"; continue; fi
  echo
  echo "[$n/$total] $v: sign it into the evals profile, then it is checked against your normal profile"
  if [ "$yes" != 1 ]; then printf 'Press Enter to start (Ctrl-C to stop): '; read -r _ || true; fi
  "$B/evals-profile.sh" -- "$OC" auth login "$v"
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "STOP at $v: the sign-in did not complete (exit $code); nothing after it was signed in."
    echo "Fix: run $0 --from $v to try $v again; sign no other vendor first."
    exit 1
  fi
  out="$("$B/check-real.sh" "$v" 2>&1)"; code=$?
  printf '%s\n' "$out" | mask
  if [ "$code" -ne 0 ]; then
    echo "STOP at $v: check-real FAILED; no further vendor was signed in."
    echo "Fix: sign $v back in on your NORMAL profile (opencode auth login $v), then run $0 --from $v."
    exit 1
  fi
  echo "$v" >> "$PASSED"
  echo "[$n/$total] $v: PASS"
done
echo
echo "signin: every requested vendor is signed in and checked. GitHub and Jira are not signed in (accounts: none). Next: evals phase1"
