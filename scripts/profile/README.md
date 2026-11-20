# The profile sign-in walk

The scripts that sign a **separate** OpenCode profile (the *evals profile*) into each vendor, and prove after every step that the owner's
**real** profile still works: it still reads, and its tokens are not the ones the evals profile now uses.

The evals profile is a HOME of its own — its own config, XDG tree, background service and credentials — so a sign-in, a refresh or a logout
there cannot touch the real profile. Nothing here signs in, prints or copies a token: `check-real` compares token **digests** in memory and
prints only PASS or FAIL and the reason. The only thing copied out of the real profile is an OAuth **app client** (Slack, X, Google), never a
user token.

```
signin.sh                  the walk: sign in one vendor at a time, check-real after each
signin.sh --list           the order, and what has already passed
signin.sh --from slack     start at a vendor (the ones before it must have passed)
signin.sh --only slack     one vendor
signin.sh --recheck all    re-run every check for what the evals profile holds; no sign-in
signin.sh --redo           forget what passed
signin.sh --yes            no Enter prompts
```

`evals-profile.sh -- <command>` runs any command inside the profile (the sign-in is
`evals-profile.sh -- opencode auth login <vendor>`); `check-real.mjs` is the check on its own; `keeper.mjs` refreshes the evals profile's
tokens on a timer; `guard-real.mjs` refuses while the real background service is running; `copy-client.mjs` copies an app client.

## Safety rules

These are the rules the tests enforce; a change that drops one fails `npm run test:profile`.

1. **Never a plain `opencode` against the real profile.** With no `--server`, the CLI connects to the real background service and starts it
   when it is down — which takes over every running session and refreshes the owner's vendor tokens beside the web server. Every real-profile
   call therefore goes through `runReal()`, which appends `--server <the web server>` and puts the password in `OPENCODE_SERVER_PASSWORD` of
   that one call's environment (read from the server's env file; never in argv, a file or output). The guard reads `/proc` and runs first:
   nothing touches the real profile while a real `opencode serve --service` exists or anything listens on its port.
2. **A read only.** The real profile gets `auth export` and one tools-RPC read. No write, no sign-in, no logout, no revoke.
3. **Check sessions are least privilege and always deleted.** Every identity read runs in a session that starts `deny *` and allows only
   that read's action plus the inner reads the host lists (`identity-methods.json`) — nothing else, no wildcard. The session is deleted in
   `finally` on every path; one that cannot be deleted is named on PASS as well as FAIL.
4. **Only a real answer passes.** A non-zero exit, an RpcError, an error/isError/failed field, an error-word code, or an answer without the
   method's expected fields is a FAIL. A "probe" that only reads whether OpenCode holds a credential is not used for the four vendors whose
   probe calls nothing.
5. **The profile links nothing out.** Before it runs anything, `evals-profile.sh` refuses if there is **any** symbolic link under the
   profile, because a link could reach the real profile. `find`'s own errors fail the run too: a link under a directory `find` cannot read
   must not pass unseen.
   One link is expected — PulseAudio's own `.config/pulse/<name>-runtime -> /tmp/pulse-<id>` — and it is accepted only when the path is
   exactly that (one name, no `/`), the target is exactly `/tmp/pulse-<letters or digits>`, and the target is a real directory owned by
   this user. A link of that exact shape whose target is **gone** (a reboot, PulseAudio exited) is stale: that one link is removed, with one
   line saying so, and the run continues. Any other name, any other target, a missing target under any other name, or a target that is a
   link or a file is still refused.

`--recheck all` runs the guard once, then one check per vendor the evals profile holds, one line each; a vendor not signed in is `SKIPPED`
(never PASS), and a failure does not stop the others. It exits 1 if any failed. Run it with `signin.sh --recheck all` (or `--recheck <vendor>`).

## Paths

Every path is an environment variable with today's value as the default; the scripts also take a flag where one is useful
(`--profile`, `--store`, `--opencode`, `--real-server`, `--real-server-env`).

| Variable | What it is | Default |
| --- | --- | --- |
| `EVALS_PROFILE` | the evals profile's HOME | `$EVALS_REAL_HOME/evals-232/profile` |
| `EVALS_STORE` | the private store: plugin pins, copied app client, round log, progress | `$EVALS_REAL_HOME/evals-232/store` |
| `EVALS_REAL_SERVER` | the owner's web server; every real-profile call goes to it with `--server` | `http://127.0.0.1:4096` |
| `EVALS_REAL_SERVER_ENV` | the env file holding that server's password | `$EVALS_REAL_HOME/.config/opencode-web/server.env` |
| `EVALS_REAL_HOME` | the owner's home | the running user's home |
| `EVALS_BIN` | the walk's own scripts | this directory |
| `EVALS_REAL_SERVICE_PORT` | the real background service's port (read, never called) | its `service.json`, else 49374 |

The store is private (700, its files 600) and holds no credential: `evals-plugins.json` maps each vendor to its pinned plugin source;
`evals-gws-client.json` holds the copied Google OAuth client. `install.sh` copies these scripts to `EVALS_BIN` for a round that expects them
at `~/evals-232/bin`; the scripts are self-contained, so nothing is rewritten on the way.

## Tests

```sh
npm run test:profile        # node --test scripts/profile/*.test.mjs
```

A stand-in `opencode` records every call, and every profile, store, link and `/tmp/pulse-*` path is a scratch one under the test's TMPDIR.
The suite asserts, among the rest: every real-env call carries `--server` and the password only in its environment; no printed fix line holds
a plain `opencode auth login`; every vendor's session is deny-all then one read, and is deleted on every path; every refusal above.
