# The engine's ingest (S3a)

The engine reads a space one lane at a time, from a cursor, instead of one row
per routine per event (the design is `docs/design/memory-routines-v1.md` in the
routines work, §10). This directory is the part that numbers and orders events,
and it makes no model call at all.

`RECORDS_ENGINE` decides what happens. It is `off` by default, and then nothing
here writes: the columns exist and stay null, no marker is made, and no lane is
leased, so a space's event rows are exactly what 0.13.0 wrote (a test compares
them, `records/test/engine-off-parity.test.js`). The other values are `ingest`,
`shadow` (reserved for the scheduler slice) and `on` (reserved for S8; this
build runs the ingest half of it and logs that it does). The flag is **not**
`RECORDS_ROUTINES_V2`: that name is an alias of `RECORDS_CLAIMS`, so it must not
start the engine.

## What one ingest page writes

With the engine on, every event of a page gets the following inside the page's
own transaction. A page that rolls back takes all of it back.

- **`seq`**, from the counter in `meta.event_seq` and never from `max(seq) + 1`:
  retention can delete every event of a space, and a reused seq would sit below a
  cursor and never be read again.
- **`content_hash`**, the first 16 bytes of `sha256` over the event's text,
  title, actors and `meta.facts`, and never its labels (`contentHash` in
  `records/src/events-normalize.js`). It is not the contract's `eventHash`: that
  one is defined by the contract and decides whether a page is a repeat at all;
  this one decides whether the content the engine reads has changed. It is a
  blob, not a hex string: the columns sit on every event row, and 16 bytes
  instead of 71 keep that cost down, which is what the ingest benchmark measures.
  A false "unchanged" would need two contents of one space to collide, which is
  not a risk at the size of a space's day.
- **`lane`**, from `laneOf` in `lanes.js`.
- **`reentry_day` and `reentry_count`**, the day's re-entry accounting.

A re-sent item whose content did not change keeps its `seq`, and so does a fourth
content change in one UTC day: at most three content changes a day take a new
seq. A change of labels only never does. A change that came after the day's cap
sits below its lane's cursor, so it is marked as dropped and the next day's first
page gives it one new seq, above the cursor, and starts its count again: what the
row holds now is read, and it is not re-queued again until three more changes have
happened. A row whose three changes all took seqs is not re-queued, because
nothing of it went unread.

## The lanes

- **`own`**: the person wrote the item or is addressed by it. The rule is the
  routines' own (`personFrom` and `isSelfActor` in `src/routines/passes.js`), so a
  plugin's `self: true` never promotes a stranger into the person, and only its
  `self: false` can take the person's word away.
- **`backfill`**: `occurred_at` is earlier than its binding's confirmation less
  24 hours, or older than the space's cutover watermark. It is read first, so an
  old message of the person's own is history too: the bind's window is about how
  far back a source is read.
- **`general`**: everything else.

A shared space gets a `seq` and no lane. The lane is opened in a personal space
only (`openLane`), so no unit of a team space is ever leased.

## The first enable

Rows an earlier build wrote have no `seq`. The first page after the engine is
switched on numbers them in `ingested_at` order, on the `backfill` lane, and
records that moment as the space's watermark (`meta.engine_watermark`). The same
repair runs after a rollback wrote rows with no seq, and the repair's rows sit
above every cursor.

## The ready index

A space with work says so in one small file, `spaces/<id>.ready`, holding
`{deadline, pending_tokens, lanes}`. It is written when a space goes from idle to
busy, when a re-entry takes a new seq, when enrolment numbers rows an earlier
build wrote, or when the earliest deadline moves earlier, and never on every
ingest. The
index is rebuilt from the markers alone (`readyIndex`), so a scheduler finds the
spaces with work without listing or opening the space files. The suffix is
`.ready` and never `.work`: the removal worker drains every `spaces/*.work` and
would run removal slices on a marker it found there.

## The retry set

`lane_retry` holds failed items, deferred threads and held claims, with
`not_before` for a deferral. The trait gate's holds stay where S1 wrote them, in
`trait_holds`, and are counted as `held` here rather than copied. The cap is
2,000 rows per space over both tables; at the cap a lane stops advancing, and
`createEngine().status(handle)` says which lane and why.

A retry row is about one event, so it is deleted with it in the same transaction,
wherever the event goes: retention, a forget, a person's erasure, or an unbind.
The set can never count a row that no lane could still read.

## The batch commit

`commitBatch(handle, {lane, source, account, expectFrom, to, file, ledger,
retry})` is the scheduler slice's interface. It runs inside a savepoint on the
space's handle, so it is atomic whether it runs alone or inside a lease's own
transaction: the cursor moves with a compare-and-set, S2's claims are filed
through `file(handle)` on the same handle, the lane ledger's line is written, and
the retry rows are added. The compare-and-set runs even when the batch moves
nothing, so a reader that is behind is refused rather than writing a ledger line
against a lane it no longer owns. A lost race throws `cursor_race` and writes
nothing at all; a full retry set throws `retry_cap`. A crash between the model's
answer and the commit leaves the cursor where it was and the same items unread.

An unbind deletes the source's cursor and retry rows, so a rebind reads from the
beginning of its own window, and keeps its ledger lines: the ledger is what the
cell spent, and an unbind does not un-spend it. A person's erasure deletes them
with their account.

## Retention

Retention deletes an event 30 days after it arrived. Before it does, it counts
the rows the lane never read — above its cursor, or in the retry set — into
`lane_expired` by day, source and lane, and a trait hold whose event expires is
counted with them. A second pass on the same day adds nothing.

## Measuring it

`records/scripts/engine-ingest-bench.mjs` runs the same 10,000 events through
0.13.0's store, this build's `off` and this build's `ingest`, page by page and
rotating the order in one process, and reports the wall and CPU time of one
ingest call:

```sh
node records/scripts/engine-ingest-bench.mjs \
  --baseline ~/opencode-mem-wt/int0130/records/src/store.js \
  --events 10000 --page 100 --chars 300 --rounds 5
```

The target is against the shipped build, not against `off`, because the engine's
columns are a fixed cost per event row and a percentage would be unfair to short
events: with `off` the p99 is within 3% of 0.13.0's, and with `ingest` it adds at
most 4 ms per 100-event page, at 300 and at 1,000 characters.

# The engine in shadow (S3b)

`RECORDS_ENGINE=shadow` runs the engine's leases for the cohort
(`RECORDS_ENGINE_SPACES`) and for nothing else. With `off` or `ingest`, and in any
space outside the cohort, nothing here runs: `ingest` numbers events and assigns
their lanes, and no model is called.

The cohort starts **forward only**: when a space joins, its cursors are set to the
`seq` each lane holds at that moment (`engine_shadow_started` says when), so the
engine never re-reads the history the daily already read.

## One pass

`scheduler.js` chooses the space and lane from the **ready index** alone, and
never lists the space files. A lane's deadline is the earlier of the oldest item's
expiry margin (`ingested_at` plus retention minus three days) and the lane's
target: fifteen minutes for `own`, two hours for `general`, and nothing for
`backfill`. Slots are shared by deficit round robin in estimated tokens (weight 1
a space until S5), with 30% of them held for `own`. The space then runs one lease:

1. **Read** the lane's unread rows and the retry rows that are due.
2. **Build** one batch: one lane, one `(source, account)`, at most
   `RECORDS_ROUTINE_BATCH_CHARS` characters, and only the threads that are quiet
   (`own` ten minutes, `general` sixty). A thread that is not quiet is left above
   the cursor or deferred to `lane_retry(kind=deferred)` with `not_before`.
3. **Release** the space's file (`store.releaseSpace`). The handle is never held
   across the model's `await`: the store's LRU closes an evicted handle, so a
   lease reopens the file for its commit.
4. **Call** once, through the tier's pool (`createPool`, a hard timeout under the
   provider's 150 s) and the shared guard. A failure reaches the cell's breaker
   and never the space's, so a shadow failure cannot stop the live daily.
5. **Reopen and commit** in one savepoint: the shadow rows, the deferred threads,
   the ledger line and the cursor, with `commitBatch`'s compare-and-set.

A lease runs one pass at a time per `(space, lane, source, account)`
(`createLeases`); the compare-and-set is the safety net for a second process.
The space is acquired for the read and its token released before the call
(`store.acquireSpace`), so a release from one caller never closes a handle
another is still using: a release without its own acquire is a no-op, and the
LRU marks a held handle rather than closing it, with the last release closing
it. Every path that awaits with a handle in scope acquires the space first.

A **retry row is work**, not an answer: a deferred thread past its `not_before`
and a failed item after its back-off are leased as their own batch, and the row
goes when the item commits. A failed call writes one row an item with a back-off
of a minute and then five; at the third attempt the row is set aside, never due
again, and keeps the provider's reason for the person to see.

A real provider failure is reported to the `extract` tier's cell breaker — never
to a space's own count — and an open tier holds the work, so an outage costs no
item its attempts. A classify lease runs S1's gate and reports the call to the
**classify** tier, which is the engine's own: the routines' trait client (S1's
daily and jobs path) is untouched and keeps the guard's default tier.

A classify lease asks the guard and the shadow cap before its one gate call, and a
refusal spends nothing and moves no breaker, as a batch's does.

A tick reads the ready index and picks spaces by the scheduler — the earliest
deadline first, then fair share — so a cell with more spaces than one tick holds
does not read the same ones for ever; a space with nothing left clears its
marker. A space whose holds are waiting gets a `classify` lease in the same tick.

## What one call carries

`context.js` writes the thread summaries in code — the title, the participants and
the claims already filed — at most 1,500 characters a thread and 2,000 tokens a
call, and ranks the batch's linked entities by how many items cite them, at most
forty. `extractor.js` is the stand-in: it wraps the routines' `buildPrompt` and
`validateItems`, so the token profile is real, and maps the items to S2's claim
inputs. Its keys are not S5's, and S5 replaces it.

On a length stop the items the model completed are kept and committed, and the
rest of the batch goes back to the **head of its own lease key** in two halves,
first half first (`answer.js`). A half is taken only after the one before it has
committed, so a cursor never steps over an item nobody read.

## The trait tier

A claim about a person with a free-text value is not filed on the extractor's
word: the commit writes it as `held` in the retry set, and a `classify` lease
(`runner.classify`) takes up to S1's `maxPerCall` holds in one call to S1's own
gate. A flagged claim is dropped, never filed; a claim the gate answered about is
filed to the shadow log; a claim it did not answer about stays held and is retried
(decision 2: a hold is never set aside).

## The shadow log and the ledger

`engine_shadow` holds one row per claim the engine would have filed: its key, its
type and knowledge key, the refs it cited, its lane, a digest of its statement and
when. It writes no projection, no proposal and no record. S8's report reads it.

`lane_ledger` holds one line per commit: what it covered (`lo`, `hi`), how many
items it filed, its tier, its tokens and calls, and its outcome (`committed`,
`length`, `deferred`, `failed`). Its tokens are the provider's **billed** usage, and the
classifier's own call is counted too, so the line is the bill. `runTokens` adds
the ledger to the cell's service cap; `modelTokens` does not add it while the
engine is in shadow, so the shadow can never starve the daily. In `on` (S8) the
ledger joins the space's day and the daily stops.

## The shadow run over the labelled days

`records/test/engine-shadow-days.test.js` runs the six labelled days through the
real store and this engine, with the days' own fake provider behind the routines'
model client. It checks that every laned item of every day is read or in the retry
set, that the ledger's items equal what was ingested, and that the ledger's tokens
equal the provider's bill to the token, classifier calls included.
