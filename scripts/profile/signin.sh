#!/usr/bin/env bash
# signin.sh: the owner's sign-in walk (EVALS-232 plan section 1.2.3). Signs the evals profile into each vendor, ONE AT A TIME, in the plan's
# order, and after each sign-in runs check-real.sh for that vendor against the NORMAL profile: the normal profile must still read, and its tokens
# must differ from the evals profile's.
#
#   signin.sh                run the walk (each vendor waits for Enter, Ctrl-C stops)
#   signin.sh --list         the order, and which vendors have already passed
#   signin.sh --from slack   start at a vendor (the ones before it must have passed)
#   signin.sh --only slack   one vendor
#   signin.sh --recheck affinity   only the check for one vendor (no new sign-in; works whether or not it passed before)
#   signin.sh --recheck            (or --recheck all) the check of every vendor signed into the evals profile, one line each
#   signin.sh --redo         forget what passed
#   signin.sh --yes          no Enter prompts (a vendor's own sign-in still opens its page)
#
# GitHub and Jira are NOT signed in: they run in fake mode (`accounts: fake`): no account, no real endpoint, the harness's own fake MCP server. Slack, X and Google use the apps already configured: no
# second app or client. Affinity is not in the normal profile, and OpenRouter is there only as an MCP tools entry: a successful real export with no credential means check-real proves only the evals sign-in; a FAILED real export is a FAIL.
# On any failure it stops, names the vendor and prints the one-line fix. It prints no token: the sign-in is `opencode auth login` in the evals
# profile, which handles its own secrets, and check-real prints only PASS or FAIL and the reason.
#
# Paths (env, with today's values as defaults): EVALS_BIN, these scripts; EVALS_PROFILE, the evals profile; EVALS_STORE, the private store;
# EVALS_REAL_HOME, the owner's home; EVALS_REAL_SERVER / EVALS_REAL_SERVER_ENV, the web server and its password file.
set -uo pipefail

ORDER="openrouter affinity ashby plaud gws-app gws slack-app slack x-app x elevenlabs wisprflow metaview granola notion linear"
# Steps that copy the owner's own app client into the evals profile (client configuration only; never a user token): see copy-client.mjs.
CLIENT_STEPS="gws-app slack-app x-app"
EXCLUDED="github jira"
REAL_HOME="${EVALS_REAL_HOME:-$HOME}"
# These scripts' own directory, so the walk works from wherever it is checked out (signin.sh's siblings do the work).
B="${EVALS_BIN:-$(dirname "$(readlink -f "$0")")}"
STORE="${EVALS_STORE:-$REAL_HOME/evals-232/store}"
OC="${OPENCODE_BIN:-opencode}"
REAL_SERVER="${EVALS_REAL_SERVER:-http://127.0.0.1:4096}"
REAL_SERVER_ENV="${EVALS_REAL_SERVER_ENV:-$REAL_HOME/.config/opencode-web/server.env}"
PASSED="$STORE/signin-passed"
mkdir -p "$STORE"; chmod 700 "$STORE" 2>/dev/null || true
touch "$PASSED"; chmod 600 "$PASSED" 2>/dev/null || true

from=""; only=""; recheck=""; list=0; redo=0; yes=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --recheck) if [ "$#" -ge 2 ] && [ -n "${2:-}" ] && [ "${2#--}" = "$2" ]; then recheck="$2"; shift 2; else recheck=all; shift; fi ;;
    --from|--only) [ "$#" -ge 2 ] && [ -n "${2:-}" ] || { echo "signin.sh: $1 needs a vendor (one of: $ORDER)" >&2; exit 2; }
                   if [ "$1" = --from ]; then from="$2"; else only="$2"; fi; shift 2 ;;
    --list) list=1; shift ;;
    --redo) redo=1; shift ;;
    --yes) yes=1; shift ;;
    -h|--help) sed -n 2,18p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "signin.sh: unknown argument $1 (see --help)" >&2; exit 2 ;;
  esac
done

known() { local x; for x in $ORDER; do [ "$x" = "$1" ] && return 0; done; return 1; }
passed() { grep -qx "$1" "$PASSED" || grep -qx "skipped:$1" "$PASSED"; }
skipped() { grep -qx "skipped:$1" "$PASSED"; }
[ "$recheck" = all ] && rv="" || rv="$recheck"
for v in $from $only $rv; do
  case " $EXCLUDED " in *" $v "*) echo "signin.sh: $v is not signed in: they run in fake mode (accounts: fake): no account, no real endpoint" >&2; exit 2 ;; esac
  known "$v" || { echo "signin.sh: no vendor $v: $ORDER" >&2; exit 2; }
done
[ "$redo" = 1 ] && : > "$PASSED"

if [ "$list" = 1 ]; then
  n=0
  for v in $ORDER; do n=$((n+1)); printf '%2d. %-11s %s\n' "$n" "$v" "$(skipped "$v" && echo "skipped (the form will ask)" || { passed "$v" && echo passed || echo "not yet"; })"; done
  echo "    (github and jira: not signed in; they run in fake mode)"
  exit 0
fi

# The name `auth login` knows each vendor by, where it is not the vendor's own (checked on 2.3.2: `auth list`/`api get /api/integration`; no sign-in).
# Slack and X register their OAuth integration only once their app client id is stored (slack-app, x-app): until then `auth login slack|x` says not found.
login_target() { case "$1" in gws) echo gws-default ;; wisprflow) echo "Wispr Flow" ;; *) echo "$1" ;; esac; }

# a token-shaped run of characters is never shown, whatever a tool printed
mask() { sed -E 's/[A-Za-z0-9_.~+\/=-]{32,}/***/g'; }

# After a vendor is signed in, or on --recheck: runs check-real and explains a failure by SIDE (its exit code: 1 your normal profile, 4 the evals
# profile, 5 the web server could not be read or a real background service is running). Returns 0 on PASS.
run_check() {
  local v="$1" out code
  out="$("$B/check-real.sh" "$v" 2>&1)"; code=$?
  printf '%s\n' "$out" | mask
  case "$code" in
    0) return 0 ;;
    4) echo "STOP at $v: the evals sign-in is held, but its check failed. Nothing is wrong with your normal profile."
       echo "Fix: run $0 --recheck $v (the check again, no new sign-in); if it fails again, sign $v into the evals profile again with $0 --from $v." ;;
    6) echo "STOP at $v: its program is not installed in your normal profile yet; nothing is wrong with your sign-in."
       echo "Fix: run /gws-install in your normal OpenCode (the web app at http://127.0.0.1:4096), then run $0 --recheck $v." ;;
    5) echo "STOP at $v: the normal profile could not be read (the web server is unreachable, or a real background service is running); nothing was changed or signed out."
       echo "Fix: check the web server (http://127.0.0.1:4096), then run $0 --recheck $v." ;;
    *) echo "STOP at $v: check-real FAILED; no further vendor was signed in."
       echo "Fix: sign $v back in from your normal OpenCode (the web app at http://127.0.0.1:4096), then run $0 --from $v."
       echo "(Or, in a shell: OPENCODE_SERVER_PASSWORD=\"\$(sed -n 's/^OPENCODE_PASSWORD=//p' \"$REAL_SERVER_ENV\")\" opencode auth login \"$(login_target "$v")\" --server $REAL_SERVER . Always with --server: without it the command starts the real background service.)" ;;
  esac
  return 1
}

# --recheck / --recheck all: every vendor signed into the evals profile, one line each; the ones not signed in are skipped; it goes through all of them.
if [ "$recheck" = all ]; then
  if ! gout="$(node "$B/guard-real.mjs" 2>&1)"; then
    printf '%s\n' "$gout"
    echo "STOP: stop it with: HOME=$REAL_HOME opencode service stop, then run $0 --recheck"
    exit 1
  fi
  pass=0; bad=0; skip=0; failed=""
  for v in $ORDER; do
    case " $CLIENT_STEPS " in *" $v "*) continue ;; esac
    out="$("$B/check-real.sh" "$v" --skip-unsigned 2>&1)"; code=$?
    printf '%s\n' "$out" | tail -n 1 | mask
    case "$code" in
      0) pass=$((pass+1)); passed "$v" || echo "$v" >> "$PASSED" ;;
      3) skip=$((skip+1)) ;;
      *) bad=$((bad+1)); failed="$failed $v" ;;
    esac
  done
  echo "recheck: $pass passed, $bad failed, $skip not signed in (skipped)."
  if [ "$bad" -gt 0 ]; then
    echo "Failed:$failed. Run $0 --recheck <vendor> after fixing one; exit 4 means its evals sign-in, 5 the web server, 6 a program to install, 1 your normal profile (the line above says which)."
    exit 1
  fi
  exit 0
fi

total=$(echo $ORDER | wc -w | tr -d ' ')
n=0
started=0; [ -z "$from" ] && started=1
for v in $ORDER; do
  n=$((n+1))
  if [ -n "$recheck" ]; then
    [ "$v" = "$recheck" ] || continue
    if ! gout="$(node "$B/guard-real.mjs" 2>&1)"; then
      printf '%s\n' "$gout"
      echo "STOP before $v: stop it with: HOME=$REAL_HOME opencode service stop, then run $0 --recheck $v"
      exit 1
    fi
    echo "[$n/$total] $v: check only (no sign-in)"
    run_check "$v" || exit 1
    passed "$v" || echo "$v" >> "$PASSED"
    echo "[$n/$total] $v: PASS"
    continue
  fi
  [ -n "$only" ] && [ "$v" != "$only" ] && continue
  if [ "$started" = 0 ]; then
    if [ "$v" = "$from" ]; then started=1; else
      passed "$v" || { echo "STOP: --from $from needs $v to have passed first (it has not): run signin.sh --from $v" >&2; exit 1; }
      continue
    fi
  fi
  if passed "$v"; then echo "[$n/$total] $v: already passed (--redo to repeat)"; continue; fi
  # No real background service, nothing on its port: from /proc, never an opencode command (one could start it).
  if ! gout="$(node "$B/guard-real.mjs" 2>&1)"; then
    printf '%s\n' "$gout"
    echo "STOP before $v: stop it with: HOME=$REAL_HOME opencode service stop, then run $0 --from $v"
    exit 1
  fi
  case " $CLIENT_STEPS " in *" $v "*)
    echo
    echo "[$n/$total] $v: copy your own app's client from your normal profile (client configuration only, no user token)"
    out="$(node "$B/copy-client.mjs" "$v" 2>&1)"; code=$?
    printf '%s\n' "$out" | mask
    if [ "$code" -eq 3 ]; then
      echo "skipped:$v" >> "$PASSED"
      echo "[$n/$total] $v: SKIPPED (the form will ask)"
      continue
    fi
    if [ "$code" -ne 0 ]; then
      case "$v" in
        gws-app) echo "STOP at gws-app: nothing after it was signed in. Fix the line above, then run $0 --from gws-app"; exit 1 ;;
        slack-app) echo "STOP at $v. Run: $B/evals-profile.sh -- $OC auth login slack-app"
                   echo "It asks for the Slack app's client ID (the same app as your normal profile) and an optional Client secret (only for a Slack app without PKCE: skip it for an app made from the plugin's manifest). Then: $0 --from slack-app"; exit 1 ;;
        x-app) echo "STOP at $v. Run: $B/evals-profile.sh -- $OC auth login x-app"
               echo "It asks for the X app's client ID (the same app as your normal profile) and an optional Client secret (only for a confidential Web App: skip it for a Native App). Then: $0 --from x-app"; exit 1 ;;
      esac
    fi
    echo "$v" >> "$PASSED"
    echo "[$n/$total] $v: PASS"
    continue ;;
  esac
  echo
  echo "[$n/$total] $v: sign it into the evals profile, then it is checked against your normal profile"
  if [ "$yes" != 1 ]; then printf 'Press Enter to start (Ctrl-C to stop): '; read -r _ || true; fi
  "$B/evals-profile.sh" -- "$OC" auth login "$(login_target "$v")"
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "STOP at $v: the sign-in did not complete (exit $code); nothing after it was signed in."
    echo "Fix: run $0 --from $v to try $v again; sign no other vendor first."
    exit 1
  fi
  # The sign-in's time, for check-real: the real token must be minted after it for the refresh chain to count as verified. Not fatal if it fails.
  node "$B/log-signin.mjs" "$STORE" "$v" || echo "signin: could not record the sign-in time for $v (its check stays provisional)" >&2
  run_check "$v" || exit 1
  echo "$v" >> "$PASSED"
  echo "[$n/$total] $v: PASS"
done
echo
echo "signin: every requested vendor is signed in and checked. GitHub and Jira are not signed in (fake mode). Next: evals phase1"
