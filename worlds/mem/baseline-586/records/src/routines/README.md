# Routines

The routines of the records service turn a space's day into a journal,
timelines, proposals and a dashboard. The binding design is
[memory-v1-contracts.md §5](../../../docs/design/memory-v1-contracts.md#5-routines-in-the-records-service)
and [memory-funnel-v1.md §6–§8](../../../docs/design/memory-funnel-v1.md#6-the-routines).

Decision extraction distinguishes made choices, concrete recommendations and
vague ideas. A recommendation for a specific option waits for review; a vague
idea or deferral is dropped. The validator checks the quote and its surrounding
sentence. The policy never applies a recommendation as a made choice.
Commitment closure also needs an explicit completion quote that mentions the
target work; a future promise or a completion about other work is rejected.

`RECORDS_ROUTINE_APPLY` (`config.apply`) is `propose` by default: decisions,
facts, preferences, constraints and commitments wait for review, and only
journal and timeline lines are written directly. `auto` applies what the
policy table allows ([memory-funnel-v1.md §7](../../../docs/design/memory-funnel-v1.md#7-policy-what-is-applied-what-waits)).
Before writing, the daily routine skips what a person forgot or deleted
(`space.routineCheck`), and pasted or quoted spans are never the person's.

Two trust foundations sit before the policy (the routines design v3, §5.4 and
§6):

- **Who the person is** is Memory's (`passes.js` `personFrom`): an actor is
  the person when its full id, in its own namespace, equals the owner of the
  bound account that delivered the event, or an identity the person confirmed
  in the console. A bare id value, another namespace, a display name and a
  meeting's `Name: text` line never make text the person's. A plugin's
  `self: false` downgrades and its `self: true` is dropped; a meeting segment
  is the person's only when the plugin attributes it to a speaking actor, and
  the policy proposes that speech and never applies it.
- **The trait gate** (`traits.js`) drops any claim and any reduced line that
  infers a sensitive trait: a deterministic lexicon first, then a small-tier
  classifier through the routines' model client. A lexicon hit on another
  person's claim drops it without asking. A claim the classifier cannot answer
  is held in the space (`trait_holds`) and retried by a later run — never
  dropped, never applied — and the tier keeps its own breaker and its own
  error count. The console reads the drops by category as counts, never the
  text. `ctx.traitLlm` is the seam a cell passes its small-tier client through;
  without one the classifier uses the extraction client.

## Interface

```js
import { configFromEnv, createRoutines } from "./routines/index.js"

const guard = createModelGuard({ store, log, config: { limit: 150_000 } })  // optional: one guard, shared
const routines = createRoutines({ store, config: configFromEnv(process.env), log, guard })
routines.start()                                      // the 10-minute scheduler
await routines.run(spaceId, "daily", "2026-11-08", actor)  // routines.run
await routines.status(spaceId)                        // routines.status
await routines.stop()
```

- `routine` is `daily`, `weekly`, `monthly`, `lint` or `dashboard`. `date` is
  `YYYY-MM-DD`, or null for today in the space's time zone.
- `actor` is the §2.5 actor. `run` needs the role `admin` or `owner`.
- A `daily` run also runs `lint` and `dashboard` after it.
- Errors are `RoutineError` with `status`, `code` and `next`.
- `guard` is the one model budget and breaker per space the routines **and the
  job runner** share (`records/src/model-guard.js`): the day is the sum of the
  routines' `runs` and the jobs' `job_runs`, and one breaker stops both. The
  service passes the same object to both; without it the routines make their
  own, which is what a solo build and the tests do. `status` reports it as
  `breaker` and `budget`.

## Store methods the routines use

The routines use these `SpaceStore` methods (§2.5), with the contract's
semantics: `get`, `list`, `search`, `put`, `append`, `listEvents`,
`listSources` and `listProposals`.

They also need these, which are not in §2.5:

| Method | Semantics |
|---|---|
| `openStore().listSpaces()` | Every space and its meta: `[{space, team, space_kind, owner_user}]`. A plain id is also accepted. |
| `meta()` | `{space, team, space_kind, owner_user}`. The first write records it. `owner_user` is never the routines' own user (`routines`). |
| `putRun({run})` | Upsert by `run.id`. |
| `listRuns({routine?, date?, budget_day?, status?, limit?})` | Newest first by `started`. On a tie, the run written last comes first. |
| `unitReads({day})` | The read marks of one local day: `{reads: [{key, fingerprint}]}`. Internal to the routines (the `routines` principal only). |
| `markUnitsRead({day, units, run})` | Upsert one run's marks, `units` as `[{key, fingerprint}]`. Written only after a batch succeeded. A build without it reads every unit again, which costs tokens but loses nothing. |
| `traitReads({day})` | The trait gate's verdicts for one local day: `{reads: [{key, verdict}]}`, `verdict` being `kept` or the category it dropped. Internal to the routines. A build without it asks the classifier again, which costs tokens but loses nothing. |
| `markTraitReads({day, reads})` | Upsert one run's verdicts, `reads` as `[{key, verdict, refs}]`, at most 4,000 a day (the newest are kept). `refs` names the sources the text was read for, so a forget deletes the verdict with them. A hold is never written. |
| `holdTraits({holds})`, `listTraitHolds({limit})`, `releaseTraits({keys})` | The trait gate's holds: a claim its classifier could not answer waits here, with its ref, so a later run retries it. Internal to the routines; no RPC method. |

`list` must also accept the following:

- `status: "all"`.
- `full: true`.
- `updated_after`.
- A `fields` object with keys the contract does not list. The routines store
  `routine_key` (to make re-runs idempotent), `links` and `closed_by` in it.

[test-store.js](test-store.js) is an in-memory double of all of the above. Use it
until the real store is wired in.

## Configuration

The routines read §2.1 (`RECORDS_*`) through `configFromEnv`. One variable is
not in §2.1:

- `RECORDS_CORE_SERVICE_ID`: the core's `x-tdai-service-id` for the cell.
  The gateway sends this header to the core; per-space `meta.service` takes precedence.

The routines read a space's turns with the gateway's core headers. Strict
isolation needs `team_id`, `user_id` and `agent_id` (the header
`x-tdai-agent-id`, and the same value in the body). A personal space sends
`team_id = meta.team`, `user_id = meta.owner_user`, and one query per agent
in the capture registry or named on a record here (`author.agent`). A shared
space sends one query per registered or author `(user, agent)` pair. The
registry has no backfill; capture-only agents are seen from 0.9.0 onward. The service id is
`meta.service`; `RECORDS_CORE_SERVICE_ID` is used only when the space has
none. A personal space with no known owner reads no turns.

## Catch-up

The daily writes a **read mark** per unit once that unit's batch succeeded: the
unit's day, its key and a fingerprint of the refs it was read with. A re-run of
the day, or a later run of the same day, sends only the units with no mark or a
different fingerprint, so a late event or a thread that gained a message is read
again and nothing is read twice.

The scheduler ticks every ten minutes, but a **scheduled re-run of today is
debounced** (lane 0198): it happens only when the last run left at least
`DEBOUNCE_MIN_UNITS` (5) units unread — a backlog it could not finish — or when
an hour (`DEBOUNCE_MAX_WAIT_MS`) has passed since it last looked. A person's
`routines.run`, a run the provider asked to put off (a 429, the open cell breaker)
and the catch-up queue are never debounced. Nothing is dropped by the wait: the
day's last run and the next day's catch-up still read every unit, only later.
Imported history is not activity: the probe asks `events.list` with
`exclude_history`, because an anchor or an import (0.15.12's `events.history`)
arrives now but is never journaled as a day's work (lane 0195b), and counting it
bought one wasted run an hour while it arrived. A genuine late arrival, which
carries no history mark, still wakes the day.

The trait gate also keeps its **verdicts** for the day (`trait_reads`): a title
or claim whose text the classifier already judged is not sent again, so a tick
that re-reads the day pays only for what is new or changed. The lexicon still
runs on every text, so a cached `kept` can never keep something the words now
condemn; an answer from the classifier is cached (`kept` or the category), and a
hold — a failure, a timeout, an open breaker — never is. A claim whose hold the
cache later answers is dropped and its hold released. Each verdict names the
refs it was reached for, and **every path that deletes events** — a forget, an
unbind, an account erasure and retention — deletes the verdicts naming them in
the same transaction; a space purge removes the whole file. Nothing derived
from a deleted event stays cached.

A run the provider asked to put off records `retry: "next_tick"` (lane 0198):
the next tick reads that code, not the run's reason, and does not make the day
wait.

A budget stop loses nothing: the next local day's tick queues the oldest day in
the retention window that still has unread units (it never ran, its run failed,
or it ended with unread units), one day per tick, and a **catch-up** run draws at
most half of the day's budget (`CATCH_UP_SHARE` in [index.js](index.js)) — the
share is of the day, not of the run, so repeated ticks cannot eat it — and it
cannot starve today. A day that already ran today and read nothing waits for the
next day and is reported as `stuck` by `routines.status`, so it never holds the
days after it. A day whose journal the person edited is skipped, as it always
was, and a run always sends at least one unit. The catch-up run's journal says
which units were read late.

## Failures

Only what the provider bills is charged: an answer's own usage, and the prompt
of a timeout after sending. A refused, failed or rate-limited call bills
nothing, so an outage cannot spend the day's cap. A 429 waits what its
`Retry-After` names (at most two minutes) and calls again once; it counts
against neither the space's breaker nor the budget. One **cell** breaker, at 50%
errors over the last 50 calls, sits in front of the per-space ones: while it is
open no call is made, and a daily run it refused ends `skipped` with
"the model is resting", so the day stays queued instead of failing.

## Logs

Each actual run writes one line:
`{"event":"memory.routine","outcome":"ok"|"failed"|"budget","routine","team","tokens","ms"}`.
`team` is a hash of the space id. A skipped run (a quiet day, an edited
journal, or a cell breaker that is open) writes only `memory.routine.tick`.
Other lines use `memory.routine.<name>`; the cell breaker's own line is
`memory.model.cell_breaker`.

## Evaluation

- `score.js` has `scoreDay({fixture, space, actor})`, `scorePrivacy(spaces)`
  and `THRESHOLDS`. The scorer reads only the space, so it also runs against
  the real store.
- The labelled days, the fake model and the harness are in
  `records/test/fixtures/days/`.
- `node --test records/test/routines*` runs everything with the fake model.
- To run the days through a real model, set `ROUTINES_LIVE_LLM_URL`:

```sh
ROUTINES_LIVE_LLM_URL=http://localhost:18450/<secret>/v1 ROUTINES_LIVE_LLM_MODEL=<model> \
  node --test records/test/routines-live.test.js
```
