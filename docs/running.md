# Running live evals

`evals run` runs a plugin's cases against a real model: one isolated OpenCode run per (case, trial), recorded in the
private store where `evals trace` reads it. It is the only command that spends model time, so everything that can
refuse a batch does so before the first run starts.

> **Every run is confined in a container.** The sandbox below isolates the environment (HOME, the XDG tree, TMPDIR,
> the config and the database), not the filesystem: an agent under test with a shell or a write tool could otherwise
> read and write anything the user running the harness can, by absolute path, and an eval run has done exactly that.
> So every run, the harness's own scripted model included (it can call a shell tool too), runs under
> `--isolation container` by default: one Docker container per trial, on a network whose only way out is an
> allow-listing proxy ([Isolation](#isolation)). `--isolation none` is refused unless `--unsafe-no-isolation` is given
> as well, for a machine that is itself disposable and holds nothing you would mind losing; the recording says so.
> Read [Running live evals safely](#running-live-evals-safely) before the first live batch.

```sh
evals run --plugin history --iteration v1-a --model claude-agent/haiku --auth claude-agent \
  --set tune --trials 3 --parallel 4 --arm ../opencode-history --world ../history-world
evals trace --iteration v1-a --plugin history
evals grade --iteration v1-a --plugin history
evals report base=v0-a v1=v1-a --plugin history --set tune
```

| Flag | Default | What it does |
| --- | --- | --- |
| `--plugin <id>` | required | the pack id; the cases are `cases/<id>/*.json` in this repository and the private holdouts in `$EVALS_STORE/holdouts/<id>/` (`--cases-dir` for exactly one other directory) |
| `--iteration <name>` | required | the recordings go to `$EVALS_STORE/raw/<name>/<plugin>/` |
| `--model <provider>/<model>[#variant]` | required | the model every run uses |
| `--auth <profile>` | required (or `EVALS_AUTH`) | where the model credential comes from: below |
| `--cases <ids>` | `*` | ids and `prefix*` globs, comma separated |
| `--set <sets>` | `tune` | `tune`, `holdout`, `tools`, `all`, or a comma list (see [design.md](design.md#reports-over-arms)) |
| `--trials <k>` | `1` | runs per case; each is `<case>.t<k>`, and one trial never ships |
| `--parallel <n>` | `4` | runs at once; each gets its own server (and, under `container`, its own container and network: at most 8) |
| `--arm <dir>` \| `<file>.json` \| `none` | the plugin's checkout | a built plugin (`dist/`, `skills/`, `package.json`), copied once per batch; a JSON arm file names one and its options; `none` is the no-plugin control |
| `--world <dir\|file.mjs>` | `EVALS_WORLD_<ID>`, else an empty project | what each sandbox starts with: below |
| `--host <version>` | `EVALS_OPENCODE_BIN`, else `opencode` on `PATH` | a tested stock binary (`OPENCODE_BIN_<version>` or `EVALS_STOCK_DIR`) |
| `--options <json>` | none | the plugin's options in the run (or put them in an arm file, not both) |
| `--timeout <s>` | `420` | a run is killed after this |
| `--stale rebuild\|refuse` | `rebuild` | what to do with a stale world |
| `--append` | off | add trials after the ones the iteration already has; without it, a case with recordings is refused |
| `--isolation <backend>` | `container` (or `EVALS_ISOLATION`) | what confines the run's processes: `container`, or `none`, which is refused without `--unsafe-no-isolation` |
| `--scripted` | off | run the harness's own scripted model, `mock/m1` (T1's mock provider and server; needs `bun` or `EVALS_BUN`): with `--auth none`, the one run that is not live, though still confined, since it can call tools |
| `--accept-unknown-token-expiry` | off | with `--auth claude-agent`, run on a sign-in whose expiry is unknown (`expiresAt` null or absent) instead of refusing it ([Credentials](#credentials)) |
| `--unsafe-no-isolation` | off | with `--isolation none`, launch anyway: the agent can reach the whole filesystem. It means nothing with `container`, and is refused there |
| `--dry-run` | off | print the plan, the caps and the isolation; launch and reserve nothing |
| `--keep` | off | keep the sandboxes (for debugging the runner); with `--auth claude-agent` it is refused unless `--keep-credentials` is given too, because a kept sandbox holds the imported OpenCode credential (a marker; the access token is scrubbed from every kept file) |

## Arms

An arm is what a run measures: a built plugin, the options it runs with, or no plugin at all. An arm file keeps the
two together, so an `ask-changes` arm is a file and not a flag someone forgets:

```json
{ "package": "../opencode-history", "options": { "access": "ask-changes" } }
```

`package` is relative to the file. The options reach the run in its sealed config, and are recorded by digest (an
option can be a secret), with the `access` value beside it. They are a provenance axis of their own, `options`:
two arms that differ only in access compare with `evals policy --axis options`, and an options difference refuses
a comparison on any other axis. A batch from before options were recorded ran with none.

## Isolation

A backend (`src/run/isolation.mjs`) prepares once per batch and enters once per trial: the trial's `wrap` turns each
host command of a run (`opencode serve`, `opencode run`, the credential import, `--version`) into the command that
runs it confined, `ready` checks a server of the trial from wherever its loopback is, and `leave` ends everything
the trial started. `confines` says whether the run's processes are kept off the host filesystem. A run is live unless
it has no credential (`--auth none`) and runs the harness's own scripted model (`--scripted`); live or not is
recorded, but it no longer decides whether a run may go unconfined: every run can execute tools, so `--isolation
none` is refused for every run, before anything is created, reserved or imported (a world module included), unless
`--unsafe-no-isolation` is given; the summary and the batch record then say `unsafe_no_isolation: true`. World
`build` and `prepare` steps are the operator's own scripts and run on the host.

### The container backend

`--isolation container` (`src/run/container.mjs`) gives every trial:

- **its own container**, from the sandbox image (`docker/Dockerfile`: Ubuntu 24.04 pinned by digest, every package
  pinned by version: curl, git, ripgrep, sqlite3, jq, tini, procps; no Node, no OpenCode, no claude, no plugin, no
  credential). It runs as your own
  uid (never root), with a read-only root filesystem, a small tmpfs `/tmp` (256 MB), `--cap-drop ALL`,
  `no-new-privileges`, Docker's default seccomp and AppArmor profiles, its own pid namespace, and pids (512), memory
  (4 GB, no swap) and CPU (2) limits;
- **only its own files**: the trial's sandbox bind-mounted read-write at the same absolute path it has on the host (so
  HOME, the XDG tree, the working directory, the world's rewritten session paths and the sealed config stay valid);
  the build under test and the harness's scripted-model files read-only at theirs; and the host's `opencode`,
  `claude` (for the Claude Agent provider) and `bun` (for the scripted model) read-only under `/opt/evals/bin`, their
  sha256 recorded. Nothing else of the host: no home directory, no other trial, no Docker socket;
- **its own network**, `--internal` with the bridge gateway in Docker's `isolated` mode (Docker 28 or later): the bridge
  has no host address and the container has no route anywhere, so neither the host's services (an OpenCode server on
  loopback, a metadata service, anything on the host's addresses) nor the internet can be reached, and names do not
  resolve. A plain `--internal` network is not enough: its bridge address reaches the host;
- **one way out**: the batch's egress proxy (`docker/egress-proxy.mjs`), joined to every trial network as `egress`
  and set as `HTTPS_PROXY`. It allows `CONNECT` to port 443 of a host name on the allow-list, exactly (no wildcard, no
  IP literal, and only when the name resolves to a public address: never a private, loopback, link-local or
  documentation one, nor an IPv6 form that carries an IPv4 address, such as IPv4-mapped, NAT64, 6to4 or Teredo), and
  refuses everything else: another host, another port, a plain HTTP request. After `200`, nothing goes through the
  tunnel until the client's TLS ClientHello names the same host in its SNI (another name behind the same address, no
  SNI, or nothing within 10 s closes it), and the request itself must arrive within 10 s of the connection, however
slowly it is sent. At most 16 tunnels per trial and 64 in all are open at once. It runs as
  `nobody`, read-only, with no capabilities, on a network of its own, on the harness's own Node mounted read-only (the
  image has none: Ubuntu's is 18.x, past its end of life).
  The default allow-list is `api.anthropic.com`, `platform.claude.com`, `console.anthropic.com` and `claude.ai`;
  only the owner sets it (`caps.json` or `EVALS_EGRESS_ALLOW`, [configuration.md](configuration.md#the-container-backend)),
  never a case, an arm or a world. Every decision is logged by host name only, and the batch record's `egress` lists
  what was allowed and what was refused (at most 200 names, scrubbed like everything else).

Both `opencode serve` and `opencode run`, and under `--scripted` the mock model's server, run inside the trial's
container and talk over its loopback; the runner reaches them with `docker exec`. Every command's environment is passed
by name only (`docker exec -e NAME`, the value in the docker client's own environment): no secret is ever in an argv,
and nothing is set at `docker run`, so `docker inspect` of a trial shows no credential. The docker client itself runs
outside every sandbox, with your own Docker settings, never ones a run could plant in its HOME.

A trial ends with `docker rm -f`, which ends everything in it: killing a `docker exec` client does not stop what it
started inside, so the runner removes the container after every run (success, failure, timeout), on Ctrl-C and
`SIGTERM` (the interrupt handler tears the whole batch down: every trial, the proxy and its network), and after an
uncaught error. A runner killed outright leaves its containers and networks labelled with its pid, and its batch
directory under `EVALS_TMP`: the next batch's start, or `evals isolation sweep`, removes everything whose runner is
gone. A directory goes only if it holds the marker its runner wrote when it created it (`.evals-batch.json`: its own
path, the batch's label, the runner's pid and start time), that runner is dead, and Docker lists none of its
containers; it is removed the way the runner removes a sandbox (contained in `EVALS_TMP`, links not followed). A name
alone never qualifies a directory.

The sandbox lives on disk (`EVALS_TMP`, by default `/var/tmp/evals`), not in a memory-backed `/tmp`. Docker cannot put
a quota on a bind mount without root, so the disk is watched instead: every two seconds the trial's sandbox is walked
(links not followed) and its allocated bytes and entries counted. A trial is removed and recorded as killed when its
sandbox passes 2 GB (`disk`) or 200000 entries (`inodes`), when the filesystem under the sandboxes has less than 2 GB
or 100000 inodes free (`disk-floor`, `inode-floor`), or when the sandbox cannot be measured (`disk-unmeasurable`): a
directory the run made unreadable, or a walk longer than 10 s. While the container runs, the watchdog changes nothing
in the sandbox; it fails closed instead. This is a watchdog, not a quota: between two measurements (two seconds, plus
the walk itself, at most 10 s) a trial can write past its limits at the disk's speed, so the floors are what protect
the machine.

Once a trial's container is confirmed gone (`docker inspect` says there is no such container; an error is not taken
for one), and only then, the runner removes or scrubs its sandbox. A sandbox whose directories the run locked is
repaired through file descriptors, never by path: each entry is opened without following links and its mode changed
through `/proc/self/fd`, so a directory swapped for a link cannot aim the change outside the sandbox, and setuid,
setgid and sticky bits are dropped, never added. A batch whose containers cannot be confirmed gone keeps its
directory untouched and says so (`containers_left` in the batch record).

Startup checks, before any run is reserved: Docker is usable by this user, is version 28 or later, and the image is
built; the binaries exist; the proxy starts; and the version probe runs as a trial of its own, so a container that
cannot start stops the batch before it costs anything. Per trial the container costs about 0.3 s to set up and 0.5 s
to remove (measured here: two scripted trials in parallel in under 5 s, end to end).

`evals isolation build` builds the image (its tag is a digest of `docker/`, so an edit makes a new one; its build
context is that directory alone), `evals isolation check` reports Docker, the image and the settings, and
`evals isolation sweep` removes what dead batches left.

### Running live evals safely

1. **Docker**, version 28 or later, usable by your user without `sudo` (the `docker` group). Note that membership of
   the `docker` group is root-equivalent on the host: the Docker API can read any container's environment, the
   credential included (`docker inspect` of a trial does not show it, because it is passed per command, but the
   daemon holds it, and `/proc/<pid>/environ` of a trial's process shows it to root). Only the owner should have it.
2. **The image**: `evals isolation build`, once (and again after `docker/` changes); `evals isolation check` should
   report it.
3. **A disk for the sandboxes**: `/var/tmp/evals` is made, private to you, on first use. Where `/var/tmp` does not let
   you, create it once: `sudo install -d -m 700 -o "$USER" -g "$USER" /var/tmp/evals`, or set `EVALS_TMP` to a
   directory on disk.
4. **A credential that can only reach Anthropic**: the access token reaches a trial's processes as
   `CLAUDE_CODE_OAUTH_TOKEN` and nothing else of your sign-in ([Credentials](#credentials)); the agent can read it, and
   can send it only to the allow-listed hosts, and only in a TLS session whose SNI names the host it asked for. A
   client that uses Encrypted Client Hello would be refused (its outer SNI is another name).
5. **Start small**: a dry run (`--dry-run` prints the isolation and the allow-list), then a supervised batch of a few
   cases. Its batch record's `egress.refused` names the hosts `claude` or OpenCode tried and could not reach: widen
   the allow-list deliberately, in `caps.json`, only for a host that is needed.
6. **What isolation does not stop**: a run can still spend your plan's model time while it lives, and can send data
   to Anthropic itself (the allow-list cannot tell a model request from an upload to an Anthropic host); it can hide
   an encoded copy of the token in its output, which no scrub of the exact value finds; and it shares the host's
   kernel (a kernel or container-runtime exploit is out of scope). The plugin under test runs inside the container
   with the agent, so it is confined too, but it is trusted to measure itself honestly.

## Before the first run

In this order, and a failure stops the batch with nothing launched:

1. the isolation: a run without filesystem isolation is refused (unless `--unsafe-no-isolation`), and under
   `container` Docker, the image, the binaries and the proxy are checked and a probe container is started;
2. the cases are selected; a named case outside `--set` is an error, not an empty run;
3. a recording that already exists in the iteration is never overwritten (`--append` numbers new trials after it);
4. the build is copied into the batch directory, so a later edit to the checkout cannot reach a running batch;
5. the world is checked, and rebuilt with the build under test when it is stale (below);
6. the credential profile is prepared;
7. the dollar budget: the projected spend must fit the month's cap ([configuration.md](configuration.md#budget));
8. the model routes: one preflight trial, set up as a run's would be (the isolation, the build under test, the
   credential imported, the server started) but sent no prompt, must list the batch's model within
   `EVALS_ROUTE_TIMEOUT_S` (60 s), or the batch is refused;
9. the run caps: the whole batch is reserved in the run ledger, or refused whole.

During the batch, a run is not launched when the world has gone stale since the batch started (a batch that crosses
midnight UTC on a day-bound world) or when the month's billed spend has crossed its cap; its reservation is
released, and the batch record says why.

## The sandbox

Every run has its own directory under `EVALS_TMP` (else `/var/tmp/evals`, on disk): `home/` is `HOME`, `OPENCODE_TEST_HOME` and
the whole XDG tree, so the database, config, cache, logs and any plugin data are the run's own; `tmp/` is `TMPDIR`.
The config is sealed in `OPENCODE_CONFIG_CONTENT` (and written to the sandbox's own config file): the build under
test, its options and the model, nothing else, so the machine's plugins, MCP servers and agents never load. The
environment is built from nothing: `PATH`, the locale, proxy and CA settings if the machine has them, the sandbox's
directories, a password only this run knows, and auto-update, file watching and Claude Code import off. A caller's
`OPENCODE_*` variables and provider keys are not passed unless a profile passes them. A world's `env` is applied
first and may not set the harness's own variables (`HOME`, `PATH`, `TMPDIR`, `XDG_*`, `OPENCODE_*`, `CLAUDE_*`,
`ANTHROPIC_*`, the proxy settings, the scripted model's endpoint, `NODE_OPTIONS`, `LD_PRELOAD` and the like): those
are applied after it, so the sealed config cannot be replaced after the checks that read it, and the names a world
tried are recorded as `world_env_ignored`. Under `--scripted` the harness's provider is listed after the plugin under
test, so a `mock` provider the plugin registers is overridden by the harness's, and it reads its endpoint from a file
beside the batch's own copy of it (read-only in a container), not from the environment the plugin shares.

The host is `opencode serve` on a loopback port (inside the trial's container under `container`), and the run is
`opencode run --server <url> --format json` in the case's working directory. Both are started in their own process
group and stopped with it, and under `container` the trial's container is removed, so a provider's own CLI cannot
outlive its run. The sandbox is deleted after the run.

Links out of the sandbox are removed once, after the world is copied in and before the run starts. A run can make new
ones while it runs; only the container keeps them from reaching anything (inside it, a link to a host path points at
nothing that exists). After a run the runner treats the sandbox as hostile: it never follows a link out of it (a
working directory replaced by a link is not walked for the files record, and a sign-in file is removed only through
no link), and it removes the sandbox without following links, giving itself back access to any directory the run
locked first.

An interrupt (Ctrl-C, `SIGTERM`) or an uncaught error stops the batch the same way: every process group it started
gets `SIGTERM`, then `SIGKILL`, and every trial container, its network and the egress proxy are removed; the run that was interrupted is not recorded; the sandboxes, with the credential
imported into them, are removed (unless `--keep`); the runs that never launched are released from the ledger; the
batch record says `interrupted by SIGINT`; and the runner exits 130 (143 on `SIGTERM`, 1 on an error).

## Credentials

`--auth` is required, so a run never picks a credential up by accident. Nothing is written into the repository or
the store; a credential reaches a sandbox and is deleted with it.

| Profile | What the run gets |
| --- | --- |
| `none` | nothing: a mock model, or a provider that needs no sign-in |
| `env:A,B` | the caller's `A` and `B`, as they are (an API key) |
| `claude-agent` | OpenCode's Claude Agent provider, as the History lab ran it |

`claude-agent`: the credential OpenCode stores as "Claude Agent" (`EVALS_AUTH_CREDENTIAL` names another) is a marker
with no secret in it. It is exported once from the caller's own OpenCode (`opencode auth export`), held in memory,
and piped into each sandbox's `opencode auth import --standalone`. The export is the one command run with the
caller's own environment: it has to read the caller's stored credential from the caller's own OpenCode, and its
output goes straight into the sandbox, never to disk.

The secret is `claude`'s own sign-in, `~/.claude/.credentials.json`: an access token and a long-lived refresh token.
The runner reads it at the batch's start and again immediately before each trial (never through a link, never from a
FIFO, at most 64 KB, and only when it parses as a Claude sign-in) and keeps only the access token and its expiry, in
memory; its content is never logged. Something outside can rotate the sign-in (boxd keeps it fresh), which revokes the
value read earlier: each trial runs on the value current at its launch, and every value the batch has read is scrubbed
from everything it writes. A sign-in that cannot be re-read, or holds no access token, makes that trial `infra: auth`,
and no further trial launches; `evals run` then exits 1.
**Nothing of it is copied into a sandbox, the refresh token is never passed on, and a sandboxed run never writes to
the caller's `~/.claude`.** Each run's processes get the access token alone, as `CLAUDE_CODE_OAUTH_TOKEN`, which
`claude` uses for the whole session and never refreshes or writes. So a batch must not outlive the token: it is
refused when the access token expires within its worst case (the run timeout times the rounds of runs,
`ceil(runs / parallel)`, each round also counting a per-run overhead for the world's prepare step, the container's
setup and teardown, the credential import and the server's start, 120 s by default, `EVALS_RUN_OVERHEAD_S` or
`run_overhead_s` in `caps.json`; plus ten minutes), with the next step: use `claude` normally once so it refreshes,
then retry. The batch record's `horizon` says what was assumed.

A sign-in whose `expiresAt` is null or absent has an unknown expiry: some machines keep `claude`'s sign-in fresh
themselves (boxd injects it, and refreshes it outside every run). Such a batch cannot be checked against its token, so
`--auth claude-agent` refuses it unless `--accept-unknown-token-expiry` is given; then the horizon check is skipped,
the log warns, and the batch record's `horizon` says `expires: "unknown", accepted_by_flag: true` (`--dry-run` shows
the same). A known expiry is checked as above, flag or not. The access token must still be a non-empty string, and the
refresh token is parsed with the file but never kept or passed on.

A provider can fill its model list only after the server answers: the Claude Agent provider caches its catalog in
OpenCode's plugin storage and, in a fresh sandbox, fills it by probing `claude` (about a second; no model call). So
every run waits, after its server is ready, until `opencode models --server` inside the trial lists its model, and
only then sends the prompt. A model that does not route within `EVALS_ROUTE_TIMEOUT_S` (60 s), or a run the host
answers with `provider.no-route` before any model work, is `infra: "provider"`: not graded, released to the reserve,
and the batch launches nothing after it.

A trial whose model call is refused its credential (HTTP 401 or 403 from the provider, an authentication or
permission error, an expired or invalid token, the sign-in prompt), with no model work done, is recorded as an
infrastructure failure, `infra: "auth"` in its summary and trace. It is never graded (`evals grade` marks it
`NOT_RUN`, with the reason), its run goes back to the reserve, and no new trial is launched after it: the batch
record's `stopped` says why. Refresh the sign-in and rerun with `--append`. A run that ends on such a refusal after
the model already worked (the token was revoked mid-run) is `infra: "auth"` too, and not graded; but it spent, so it
is recorded in the ledger with what it billed (marked `infra`) and counts against the run and dollar caps.

Each sandbox has its own empty `~/.claude` (`CLAUDE_CONFIG_DIR`): no `.credentials.json`, no `~/.claude.json`, none of
the caller's settings, hooks, global `CLAUDE.md`, MCP servers or agents; `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` and
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` are set, and claude's auto-updater is off. Everything `claude` writes
stays in the sandbox and is deleted with it. A world's home that carries links out of the sandbox (a lab sandbox
links `~/.claude` and `~/.local/bin`) has them removed. `CLAUDE_AGENT_SDK_VERSION` must be set and is passed on.

The token is readable by the agent under test, from its environment. The runner scrubs it, by its exact value, from
every recording, summary, files record, batch record and log line before writing them, and from every file of a kept
sandbox (masked with as many `*`, so a database keeps its layout); a key passed with `env:` is scrubbed the same
way, scrubbed before any output is cut (a value straddling a cut would otherwise leave its tail). The container keeps it
from leaving a run except to the allow-listed hosts. Whether the Claude Agent provider's own `claude` inherits the
variable, and which hosts a real turn needs, is to be confirmed by one supervised run.

## Worlds

A plugin whose cases need data brings a world: a directory with a `world.json`, or a module. Without one, each run
starts in an empty project directory.

```json
{
  "home": "gold/home",
  "repos": "repos",
  "cwd": { "api": "lumen-api", "web": "lumen-web" },
  "default_cwd": "api",
  "now": "truth.json#now",
  "fresh": "utc-day",
  "build": "./make-gold.sh",
  "overlay": "$EVALS_STORE/holdouts/history/world",
  "prepare": "./fix-directories.sh",
  "sessions": { "earlier": "ses_…" }
}
```

`home` is copied over each sandbox home (a seeded OpenCode database, a prebuilt index). `repos` holds working
directories, and a case's `Seed: cwd=<key>` picks one through `cwd`; each run works in its own copy. A key, and the
repository it names, is a single name inside `repos` (no `/`, no `..`): anything else is refused, and so is a
repository that is itself a symbolic link or holds one that points out of the world. After the copy, any link left in
the sandbox that points outside it is removed, however deep. Every containment check compares real paths, links
resolved. `now` is the
world's clock, a number of milliseconds or `file#key`. `fresh` says how long a build stays valid: `utc-day` (the
world's day must be today, UTC: History's synthetic history is relative to its build time, so its time-window
questions mean something else tomorrow), `<n>h`, or `always`.

`build` rebuilds the world, from the world directory, with `EVALS_WORLD_ARM` set to the copied build under test: a
plugin's own index must be built by the build being measured, never by a fixed baseline. The runner stamps each build
it ran with that build's digest (`.evals-world.json`); a world built by another build, or by hand, is stale. A stale
world is rebuilt (`--stale rebuild`) or refused (`--stale refuse`); a world with no `build` is refused.

`overlay` is a private add-on (holdout sessions, say) that lives in the store, never beside the world: `$VAR` in it is
the caller's variable, and the build receives it as `EVALS_WORLD_OVERLAY`; its digest is stamped with the build, so a
world built with another overlay is told apart without the overlay being shown. `prepare` runs per sandbox, after the
copy, with `EVALS_SANDBOX_HOME`, `EVALS_RUN_CWD` and `EVALS_REPO_SOURCE` set: a world whose recorded sessions name
directories rewrites them to the run's own there, so a directory-scoped question still means something in a copy.
`sessions` names sessions a case continues with `Seed: continue=<key>`: the run is `opencode run --session <id>` on
the sandbox's own copy of the world.

A case's `Seed:` can also bound the time of day: `utc-hours=9-15` runs the case only from 09:00 to 15:00 UTC (a window
may cross midnight, `22-6`); outside it the run is skipped and its reservation released, and every summary records
the UTC hour its run started.

A module world exports `{ name, status({ arm }), build({ arm, caller, log })?, prepare({ sandbox, case, seed, trial }),
provenance()? }`; `prepare` returns `{ cwd, env? }`.

## What a run records

`$EVALS_STORE/raw/<iteration>/<plugin>/<case>.t<k>.jsonl` is what `opencode run --format json` printed, and
`<case>.t<k>.summary.json` holds the exit (124 on a timeout), the time, the trial, the model, the host version, the
runner and its version, the credential profile's name, the isolation (and under `container`, `isolation_detail`: the
trial's container, its setup and teardown time, any processes the memory limit killed), `killed` when the disk
watchdog stopped it, `world_env_ignored` when a world tried to set a sealed variable, the world's name and clock, the
batch id and the build's provenance per axis. `<case>.t<k>.files.json` lists the files the run added, modified or deleted in its working directory (`.git` aside),
each with its digest and, for a text file of 64 KB or less, its content: `file:` clauses grade them, and no trace
holds them. `batch-<id>.json` is the plan and every run's outcome, with the isolation (image and its id, Docker version, limits,
allow-list, the binaries' sha256), `egress` (the proxy's allowed and refused host names) and `horizon`. The ledger
(`$EVALS_STORE/ledger/runs.jsonl`) has the reservation and one line per run with what it billed.

Not verified end to end by this repository's tests: a live model, the Claude Agent provider, and a real History world.
Those are exercised by a pilot, never by `npm test`. The container backend is: with Docker and the image present, the
tests run a scripted-model trial end to end inside a container and grade it, and check what a trial can read, write
and reach (they skip, with the reason, where Docker or the image is missing, as in CI).
