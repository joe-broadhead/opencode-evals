# Memory Jobs (slices J0, J1, J2 and J4)

The records service's job runner: **one job, one connector, one curated
block** (J0), from J1 **versions, drafts, consent and full CRUD**, from J2
**a job made from the template a connector ships**, and from J4 **the
`extract` engine: proposals into memories and the knowledge graph**
(`audit-reports/memory-jobs/DESIGN.md` §5, §6, §7, §9, §12, §13). Personal
spaces only; no scripts, no shared spaces. A `render` stage is fixed
placeholders and costs nothing; an `extract` stage calls the model and writes
**proposals only**, and it is **off unless a deployment turns it on**
(`RECORDS_JOBS_EXTRACT=on`).

## What is here

| File | What it owns |
|---|---|
| `templates.js` | The fixed template (J0) and the mapping from a connector's own template (J2: `jobGrants`, the page its `into` needs, its stages) as **data**: connector, source, grants, kinds, budgets, the `render` stage and the page it owns. The runner holds no plugin names (§7.2). |
| `model.js` | Ids, the every/backoff arithmetic, the version **digest**, and the `channel:<id>` a message names. |
| `schema.js` | The job tables, **additive** beside `runs` and `events`, so an older service opens a file and ignores them (§1.2). `job_items` is keyed `(connector, account, external_id)` **globally**; `job_curation` is each job's own curate state over those items. |
| `rows.js` | The tables as rows over one handle. No transactions of its own. |
| `versions.js` | A version's canonical **digest** (every part a run is held to, except the account's owner, which the person's host reports), the **diff** between two versions, and the per-job **widening classifier**: S2's closed narrowing list (`records/src/plugins/classify.js`), redone over a job's grants, scope, kinds, cadence, budgets and outputs (§5.4). |
| `consent.js` | The bind-like flow for one job: `jobs.request`, the owner-only `jobs.probe`, and `jobs.consent` (a browser session only). It records the limits a later version is judged against, and it holds **P2's hook**, which is dark: a host grant is refused, never believed. |
| `render.js` | The `render` engine: the lens block, its citations, and the person's text around it (§6.1, §6.2). Collected text is reduced to text — every markdown image form (inline, spaced or titled, reference and its definition, HTML `<img>`) dropped, links kept as their label — and **any** line in the block the job did not write is the person's. |
| `extract.js` | The `extract` engine (J4, §6.1–§6.2): the job's units from its own items (the host's `inScope` rule mirrored, so a unit never comes from a page the checkpoint would refuse), a **fenced `hints` block** as data, and the proposal outputs a person confirmed. Entity proposals (a person page only as a proposal, a known identity never a second page, a project field link), the quality loop's rates and the staleness rule. |
| `proposals.js` | The engine's writes: one proposal per item (keyed by `fields.job_key`, so a re-run adds nothing), the store's forgotten check before anything is written, and the **withdrawal** that retires the proposals a deleted message or a cancelled event caused. |
| `index.js` | `createJobs`: `draft` (create or edit — a draft never runs), `activate` and `consent` (P1 only), pause, resume, archive, remove, `claim`, `checkpoint`, `finish`, `curate`, and the tick. |

`records/src/store.js` gives it one narrow seam — `jobRead` and
`jobTransaction` — so the runner keeps the role checks and the space's meta,
and a system write never creates a space. `records/src/server.js` serves the
`jobs.*` methods.

## The loop

0. **Bind.** A job can only be made on a **confirmed binding**: a browser-session consent for `(source, account)`, on the declaration now on disk, with its grants, scope and kinds inside consent ∩ disk. Anything wider is refused by name (`job_consent_required`, `job_grants_widened`, `job_scope_widened`, `job_plugin_changed`, …). **The same checks run on every claim and every write**: a consent narrowed after the job was made pauses it, with the reason, instead of letting it read with grants the person no longer confirmed.
1. **Schedule.** The tick (one minute) makes at most one run per due job and
   leaves it `queued`: with no host, that is `waiting_for_host`.
2. **Claim.** A host leases a queued run, a due job, or a `running` row whose
   lease expired — the last at `epoch + 1`. A `running` row with a live lease
   is not claimable: **two hosts, one writer**.
3. **Extract** (in the plugin: `src/jobs/host.js`). The host makes the job
   session `ses_mem_job_<job>` with rules `deny *` and exactly the job's
   grants — **and no `execute`** (S0's question, answered: the tools RPC works
   without it). It calls `events_list` over the tools RPC with that session id,
   then checks the answer: `source`, `account` and `owner` must be the job's
   (**the per-run account check**), and every event's kind and channel must be
   what the person confirmed.
4. **Checkpoint.** One transaction stores the page's events (ids from
   `eventId(source, account, external_id)`) and the items, keyed
   `(job, connector, account, external_id)`, and moves the job's cursor —
   **only if `cursor_before` is the cursor the job holds**.
5. **Finish.** The run's outcome, counts and error; a failed run backs off
   1 m, 5 m, 30 m, 2 h, and three in a row pause the job with the reason.
6. **Curate.** The block is rebuilt from **every** item the job has, so a
   re-run of the same page changes nothing and writes nothing. The **service**
   remembers the hash of the block the job wrote (`job_lens`, never the page's
   fields, which a client could forge), so a run that died between the write and
   its mark resumes instead of reading its own block as an edit. A person's edit
   inside the block stops the job writing it (`job.lens.edited`), never
   overwrites it: what the job would have written becomes an `append` proposal.
   Recall and a page read mark that block **external** (§6.2).

`RECORDS_JOBS=off` takes the whole runner out: `jobs.*` answers `503 jobs_disabled`,
and nothing can claim, finish or write.

### A run goes to a host that has its connector (lane 0189)

`jobs.host` takes an optional `connectors`: the plugin ids active in the
host's own process, at most 50, stored in `job_hosts.connectors`.

- **Absent** means the host did not say. It is a legacy host, and a host that
  has not reported yet counts as one. Its claim is today's, unchanged.
- **Present is exact**, even `[]`. `claim` then leases only a run whose job
  `connector` is in the list: the dead-lease run, the first queued run that
  matches (in `started, id` order, so an unmatched run at the head blocks
  nobody), or a due job. When nothing matches, the answer may say
  `why: "no_matching_run"`.
- **The hints are the host's own.** `next_due_at` and `probe_pending` cover
  only the connectors the host may serve; otherwise a host with no matching job
  would see a past time and ask again every 30 s.
- **"The connector is not here" is not the job's failure.** `jobs.finish` with
  `error_code: "connector_unavailable"`, or today's plugin message word for word
  (`connectorMissingMessages` in `model.js`, from `src/jobs/host.js`), does not
  raise `failures`, so it cannot trip the three-failure pause. The job is due
  again, and the connector is stored in `job_hosts.incapable`: it is not
  leased to that host, and not in its hints, for the host's life.
- **Waiting.** `jobs.list` gives a job `waiting: "no running agent has
  <connector>"` when it is due and no host seen in the last 10 minutes may
  serve it. It is not paused and its cursor does not move. A legacy host not
  marked incapable counts as possibly able. Records has no Inbox item of its
  own, so there is no 24-hour reminder.
- **Pruning.** A report deletes `job_hosts` rows unseen for 7 days.

### The scheduler opens only the spaces with work

The tick runs every minute (`TICK_MS`) and used to open **every** space to read
its job rows; past 128 spaces that turns over the store's open-file cache
(`maxOpen`), so each tick evicted the handles the next one needed.

- **One small index per space:** its earliest due job (a job that already has a
  queued or running run is not work), when its earliest `running` row would go
  stale, and how many finished runs wait for curate. A tick opens the spaces
  where one of those is true, and no other.
- **It is kept by the writes themselves:** every job write goes through
  `jobTx`, which recomputes the space's entry in the same transaction, so a job
  created, changed, run, finished or curated updates it. A space whose file is
  gone is dropped as the tick lists the files.
- **A restart rebuilds it with one scan** (`buildSchedule`), reading each space
  once; that scan is also how **a stale `running` row after a restart is still
  found** (§4.2), because the entry carries the running rows' start times. The
  scan only fills entries in — never removes one, which is `workSpaces`' job —
  so a job written *while* it runs keeps the entry that write made.
- **A space the index has not seen is read once**, on the next tick
  (`workSpaces`): a space placed by `space.install` with a job older than this
  runner, for example, is ticked on the same pass instead of being invisible.
- `tick(spaceId)` still takes one space, which is what a manual `run_now` and
  the tests use.

## Consent and versions (J1)

- **A draft is a version, not a change.** `jobs` holds the definition that runs;
  a draft is a `job_versions` row above it, with the version it was made
  against (`base`) and the diff. `jobs.draft` never touches the running
  definition, so **an agent's draft never runs unattended** (§5.5).
- **Activation is P1.** `jobs.activate`, `jobs.consent`, `jobs.create` and
  `jobs.remove` refuse any caller that is not a browser session of the console
  (records checks the credential itself, not only the gateway), and the
  gateway refuses every bearer before that. There is **no tool door**:
  `mem_spaces {action: "jobs"}` answers activation and deletion with the
  console link.
- **A consent names what it approves.** `jobs.consent` requires the version
  and the digest the dialog showed, as `jobs.activate` does.
- **A paused consent stays paused.** Approving a version underneath a paused
  consent is refused (`job_consent_paused`); only a new consent, in a browser,
  turns it back on, and asking for one is allowed again.
- **Consent fails closed.** A job with no consent row, or whose running
  version is outside its consent, can never be claimed, run, resumed or
  activated: `consentProblem` refuses every one of them, and the owner check is
  mandatory (no reported owner, no run). A draft is never archived, paused,
  resumed or run; resume returns a job only to its last consented version.
- **Only widening needs the person again.** A version inside the recorded
  limits is activated by `jobs.activate`; one that widens is refused
  (`job_widening`, with the delta) and needs `jobs.consent` at that version:
  request, the host's probe, then the console's confirmation of account, scope
  and grants (§5.4).
- **The consent is re-checked on every claim and write** (`consentProblem`): a
  job whose digest is outside its consent pauses with the reason instead of
  reading with what nobody confirmed.

## Connector schema v2 (J2)

- **A job is made from the template the connector ships**: `jobs.create` takes
  `"<plugin id>/<template id>"`, and the template's stages, kinds, budget and
  page come from it. Its **grants are §9.1 D's set** — the source's, every read
  its steps name, and the identity's, with `{account}` bound — never the
  template's own, so a template cannot widen a confirmation. A stage engine this
  build does not run (`synthesize`) is refused by name.
- **The job carries its source's identity** (`events_list` with `limit: 0`) and
  its declared reads' scope inputs, so the host reads the account with the call
  the plugin declared; a source whose identity is not `events_list` is not a
  source (§9.2).
- **A `render` stage's `into` decides the page**: `journal` is the day's journal
  (`journal/<day>`), `section:<Heading>` and `timeline` are the job's own page,
  and a declared `line` renders its placeholders, citation always appended.
- **Per-unit reads** (§9.1 C): a `call` step runs once per unit with the unit's
  own `thread_channel`/`thread_ts` filled from the event and pinned to the
  confirmed scope; a unit outside it is counted and never called. A **unit comes
  only from the page Memory admits** (the job's confirmed kinds and channels), so
  an event the checkpoint would refuse never causes a read first. A template's
  `with` may not set a key the read pins, and the pinned inputs are applied last;
  a reply's channel is the one the **answer** names, never the unit's label.
- **A page's `gap`** (§9.3) is judged on arrival: `window-truncated` marks the
  run incomplete and resyncs nothing; `expired`
  resync **once a day per binding** (the source and account), and a second the
  same day pauses the binding, and with it every job on it.
- **A cancellation** (the same id, labelled `cancelled`) withdraws the item, so
  its lines leave the block.
- **A job with no confirmed scope key** confirmed the whole source, so an answer
  that echoes the source's own default is inside it; a job that names a key is
  held to it, id by id.

## Curation into the graph (J4, §6)

- **Proposals only.** Every `extract` output is a `proposal`: `proposal:decision`,
  `proposal:fact`, `proposal:commitment_open`, `proposal:commitment_close`,
  `proposal:person` and `proposal:link`. Nothing is applied, on any mode, for
  any job: §14 decision 4 allows direct writes for a personal job a person
  approved, and this slice does not take that door. A commitment the quote
  attributes to the person waits with `attributed_to: person`, so accepting it
  in the console is what makes it theirs.
- **The frame is Memory's.** The strict schema, ids only from the inputs, a
  verbatim quote, the validator, `quoteAuthor`, `decide()` and the shape guard
  run unchanged (`records/src/routines/`). The engine adds one thing to the
  prompt: the template's `hints`, fenced inside `<<<HINTS … HINTS>>>` and
  labelled as data that cannot change the schema, the rules or the targets. A
  hint is reduced with `visibleText` and `redactExternal` before it is fenced,
  and the manifest validator already refuses an instruction-shaped hint at
  install.
- **Collected text reaches a proposal only as text**: `visibleText` →
  `redactExternal` → `cleanLine`, the same order a rendered line uses, so an
  image can never be drawn, a link keeps its label, and an instruction-shaped
  sentence is removed before the model sees it and again before anything is
  stored. Citations are ids only: `[event evt_…]`.
- **Entity linking.** A person or project is matched on the space's
  `fields.identities` and `fields.aliases` first (`buildIndex`), so
  `mailto:`, `slack:` and `github:` for one person converge on one page. A known
  identity never creates a second page; a new actor seen in two or more units is
  **proposed** as `people/<slug>` with its identities, never created; a
  name-only match is a `merge` proposal in the daily routine's shape; a project
  field the job needs (`slack_channels`) is a `link` proposal. Accepting one
  writes it, and `deriveLinks` gives the backlinks.
- **Withdrawals.** A deleted message or a cancelled event retires the proposals
  that cited it (`job_withdrawals` → `fields.events`, so a person or link
  proposal is covered too), so nothing is silently kept, and a later run does
  not propose it again. A deleted proposal is tombstoned by its content key, and
  items already sent to the model are never sent again (`job_extracted`).
- **Compounding and staleness.** A re-run adds no duplicate (the key is the
  item), a contradiction becomes a `contested` proposal through the existing
  lint, and a block whose newest citation is older than `staleAfterDays`
  (30 by default) is logged as stale and returned beside the curate result.
- **The quality loop.** Each version's accept and reject rates are counted from
  its proposals; a version with at least 20 decisions and more than 60% rejected
  is auto-paused, with the reason.
- **Budgets and breakers.** A run is capped by `RECORDS_JOBS_EXTRACT_TOKENS`
  (15k, at most 25k and at most the template's `tokensPerRun`), a job by
  `RECORDS_JOBS_DAILY_TOKENS` (40k a UTC day), and **every job of a space
  together** by `extractServiceTokens` (120k). All of them sit inside the
  space's **one model budget, shared with the routines**
  (`RECORDS_BUDGET_TOKENS`, `records/src/model-guard.js`): the day is the sum of
  the routines' `runs` and the jobs' `job_runs` over the space's **local** day
  (its `index` page's `fields.tz`, local midnight to the next in UTC), so what a
  routine spent leaves the jobs less and the other way round, and an evening run
  is never charged to the next day. **One breaker per space** stops both:
  `RECORDS_LLM_BREAKER_FAILURES` failed calls in a row open it for
  `RECORDS_LLM_BREAKER_COOLDOWN_MINUTES`, and `routines.status` shows it beside
  the day's spend (`budget`). The job's own three failed runs still pause the
  job.
- **Payment and credential text** is refused by `jobs/payment.js`, **not by the
  shared shapes module**: an ordinary save keeps `main`'s behaviour ("Buy a gift
  card for Ama's leaving do", "The routing table holds 1200000 entries",
  "acct 2024 budget", "The shared password is rotated"). The Jobs guard (IBAN,
  `a/c`, sort code, routing number, Luhn card, **a card fragment ("card ending
  4417", "ending in 4417", "last four 4417", "•••• 4417", "xxxx-4417", "Visa
  4417", "card no. …", an expiry date)**, CVV, a password with a value, an OTP,
  a PIN, gift-card codes, a crypto address) is applied to collected text
  only, before a proposal is written.
- **Decision and promise rules are Jobs-only** (`jobs/decisions.js`): the
  routines keep `main`'s behaviour, and `validateItems`/`decide` take them as
  hooks. Jobs' markers are line labels, "agreed with <X>:", and the present
  tense with a curated verb and a date, with negation, uncertainty and past
  narrative refused.
- **The Gmail `sent` label** is the person's only evidence: the pilot maps Gmail's
  `SENT` to `sent` in `src/domain/gmail.ts` and reads it with `labelIds` in
  every message, and `messages.list` is not restricted to the inbox, so sent
  mail arrives labelled. **Residual:** a delegate or an app with send, insert or
  modify access also produces `SENT` mail, so a `sent` attribution can be
  somebody acting as the person; the proposal still waits for their review.
- **Only the service writes a link or a merge proposal**, and accepting one
  writes an allowlist (identities and aliases add-only, links, project fields);
  a merge adds an identity beside the page's own, never over it.
- **Who is speaking (J4 review, findings 3, 8–11).** The person is the speaker
  **only** when the connector's own field says so: a Slack sender actor whose id
  is the binding's owner, a Gmail `sent` label from the bound account, a
  Calendar organiser marked `self`. Never a name match, a speaker line, a
  `From:` header, a pasted chat header or a quote — a quoted or forwarded
  promise is never proposed.
  - **In the person's own message**, a first-person promise is theirs only when
    it sits **above the first reply-boundary line** (a generic marker: an email
    address, a header line, a date/time header, a speech verb in English,
    French, Spanish, German, Dutch or Italian, a run of `-`/`_`/`=`, or a `>`),
    and on a line that **names no other person** (any capitalised name before
    `,` `:` `-` or a speech verb, a lowercase chat speaker such as `sam:`,
    `<Name>'s`, "with/from/per/by/according to <Name>", or a known person page's
    name). Label words ("Decision:", "Outcome:", "Heads-up:") are the sender's
    own. A calendar note is the organiser's only under the same rule. When in
    doubt the owner is unknown and the promise is **withheld** (counted, never
    proposed): false negatives are accepted, false positives are not. An author
    with no id is unknown too.
  - **Decisions and facts** are proposed only from the person's verified own
    text, or from a line of it that names somebody (the person still decided
    it); a received message's decision is not the person's memory.
  - A sender's owner comes from the **verified address or id**, never a display
    name a `From:` header can spoof: a Gmail owner is the address's local part,
    a Slack or Calendar owner the connector's actor name, and no id is
    "unknown". A promise somebody else made **is** proposed, with
  **their name as owner** (the person is waiting on them) and
  `attributed_to: external`, which the store keeps: accepting it in a session
  never stores `stated_by: person`. The person's own promise is always
  `owner: user`.
- **Off by default, and why.** The design gates `extract` being on by default on
  its precision eval (§13 J4). Two evals run it:
  - `records/test/jobs-extract-eval.test.js` — no model, no network: it feeds a
    model that proposes **every** labelled candidate, so the guards are what is
    measured (injection, pasted text, newsletter, hedge, forgotten, other
    people's commitments).
  - `records/scripts/jobs-extract-eval.mjs` — the same engine path with a real
    model (`--url`, `--model`, key in `--key-env`), printing precision and
    recall per output kind and the false positives by event id only.

  **Last real-model run** (`deepseek/deepseek-v4.1-flash`, the gate's model,
  85 labelled units — Slack, Gmail and Calendar, 20 fact positives under the
  rubric in the fixture, two runs):

  | set | run | precision | recall | owner | injections | withheld |
  |---|---|---|---|---|---|---|
  | own (85 units) | 1 | 100% | 87.0% | 100% | 0 | 4 |
  | development (25 units, the reviewer's first set) | 1 | 100% | 92.3% | 100% | 0 | 4 |

  After the general fixes the held-out diagnosis named (line labels such as
  "Outcome:" and "Resolution:", "agreed with <X>:", the present-tense "we <verb>
  … on/until/by <date>", relayed blocks that run to a blank line, the fact
  rubric in the prompt, and a `constraint` mapped to a `fact`) the own set is
  100% precision, 85–87% recall, and the reviewer's first set is 92.3% precision
  and 92.3% recall, owner 100%, no injection. The default stays **off**: it is
  the coordinator's decision from an independent set. Turning it on is
  `RECORDS_JOBS_EXTRACT=on`.

## Meeting pages propose decisions and commitments

Jelly writes one page of type `meeting` per meeting, with its notes and links to
its recording and transcript. **A saved meeting page is read by this runner, and
what it finds becomes a proposal — never a memory.**

- **The owner's decision (2026-11-14).** A memory drawn from a meeting may be
  **proposed** at the measured proposal precision (80–87%), because each one is
  reviewed before anything is stored. Extraction that **saves** a memory
  directly keeps the 0.90 bar, so `extract`'s direct-save default stays off and
  this path has no direct mode at all.
- **Attribution is by authorship, never by default (0.11 review, the blocker).**
  Every page under `meetings/` is of type `meeting`, so a page can be written by
  a guest with a grant, another member of a team space, or a job. A note line is
  **the person's only when the person saved every version of it**: the page is
  theirs (`records.author_user`), the space is their own personal one, and no
  other person or job ever saved it — the whole history, from `records` and its
  `versions`, not just the last save, so a guest's appended line stays theirs
  even after the owner re-saves the page. It **fails closed**: a version the
  store no longer holds (`records.revise {action: "forget_versions"}`, or an
  erasure) leaves no history to read, so no line is the person's; and a page
  **any save made on an agent credential** is not the person's notes either,
  because in 0.11 an agent does not speak for the person. That is the gateway's
  verified principal (`change.by.principal: "agent"`, from
  `x-records-principal`), **never the agent name**: a person's own coding agent
  puts its name on every page the person writes, and those are theirs. A press
  applied under a verified grant (`change.via: "grant"`) is the person's act.
  Otherwise:
  - a page the **runner or the routines** wrote (a calendar job's external
    agenda) is **context**, and proposes nothing;
  - a page **another person** wrote or last saved is `someone`: its decisions
    are not the person's and are refused, and its promises are proposed with
    `owner: someone else`, `attributed_to: external`, `fields.written_by:
    someone`, and a title and body that say so. A named transcript speaker stays
    that speaker (`fields.written_by: speaker`).
- **What is read:** the page's notes (its body), and the transcript **when the
  page carries its text** (`fields.transcript`, `fields.transcript_text`). A
  transcript the page only links is never fetched: its link is cited. Text past
  the caps (400 note lines, 600 transcript lines) or past the token budget is
  recorded in `meeting_proposals.truncated` and on the proposals, never dropped
  silently.
- **What is cited:** every proposal names the page (`source.record`, body
  `[meeting <path> at <at>]`) and the moment: the transcript's timestamp
  (`00:12:34`, with `fields.evidence[].file`) when the line carries one, and the
  line's offset (`#L12`) otherwise. A named transcript speaker is that speaker:
  only an attendee the page marks `self`, or the person's own name, is the
  person. Their promise becomes `owner: <name>`, `attributed_to: external`.
- **What it proposes:** only `proposal:decision` and
  `proposal:commitment_open`, through the same frame, validator, attribution and
  `decide()` as a job's `extract` stage (`records/src/jobs/meetings.js`).
- **Where the proposals live:** in the space the meeting page lives in. A team
  meeting's proposals are read only by that team's members; nothing is copied to
  another space.
- **A promise on someone else's line is never the person's.** An owner the line
  names ("Ama will …") stays that named person; a first person, or an unnamed
  owner, on a line the person did not write becomes "someone else"; a transcript
  speaker stays themselves.
- **A live meeting is skipped.** A page whose `fields.meeting` names a start and
  no end is a meeting still running: jelly may re-save it every few seconds, and
  Memory makes no call and spends nothing on it. It stays marked and is read once
  a later save or tick finds it ended. A page with no meeting fields is the
  person's own notes and is read as it always was.
- **The trigger is the save, and a deploy backfills nothing.** The store writes
  a `meeting_pending` row with the page and tells the runner; the next tick
  (1 minute) reads only pages a save marked, and the pending row is durable, so
  a save made before a restart is still proposed from. A tick reads at most five
  pages. `jobs.meetings` is the person's own ask: it reads every page whose text
  changed, old ones included — the only way to backfill. It is a **write** at the
  gateway and only the space's owner may call it; it is **not in Jelly's
  declaration**, so it is not drawn there.
- **A deleted page takes its proposals with it.** Deleting the page marks the
  pass, which **retires** that page's open proposals (status `retired`, with the
  reason), whether proposals are on or off, so no quote outlives the page it
  came from. A line the page no longer holds retires its waiting proposal too
  (compared after the same normalisation the quote was stored with, so a bold
  line or a link is not mistaken for a deleted one, and never in the pass that
  created it). A
  retired or rejected meeting proposal is **scrubbed**, every stored version
  included: it keeps its id, the page and the moment, and loses the words it
  quoted (title, body, evidence and payload), so `records.history` shows no
  quote either.
- **Idempotent.** A page whose notes and transcript are unchanged since its last
  pass is not read again (`meeting_proposals.digest`), and a proposal is keyed
  by its own content, so a re-save never duplicates one already waiting.
- **One budget, one breaker.** It spends the space's shared day
  (`meeting_proposal_spend`, counted with the routines' `runs` and the jobs'
  `job_runs`) and respects the one breaker; a spent day or an open breaker
  proposes nothing. A page the budget stopped is **not marked read**: it stays
  pending and is proposed from on the next pass. A page larger than one run is
  read in parts of about 6000 characters: the mark keeps the part it reached, so
  each part is sent once and the page finishes over several ticks (a part is
  never re-sent). **An outage is not the page's fault:** a refused connection, a
  5xx or a timeout counts toward the space's one shared breaker and uses no
  attempt, so the page is tried again when the provider answers. **A content
  failure** (bad JSON, a refusal, a failed validation) is the page's: it uses an
  attempt, backs off (1 min, 5 min) and never opens the shared breaker, which
  would stop the space's routines and jobs too. Three attempts mark the page
  failed and it stops; **any new save clears that**, so a page has a way back. A pass reads the full body and history of the pages it
  processes (at most five) and of no others. The service-wide cap counts
  this spend too (`runTokens` with `since` reads all three ledgers). A call that
  fails is charged its estimate before the failure is counted.
- **Off by `RECORDS_MEETING_PROPOSALS=off`**, and on otherwise; it is a separate
  switch from `RECORDS_JOBS_EXTRACT`, which stays off.

## Tests

- `records/test/jobs-j0.test.js` — the loop, the lease, fencing, the cursor,
  idempotency, the crash and the breaker.
- `records/test/jobs-schedule.test.js` — the scheduler's index: 500 spaces with
  3 due jobs open only those 3, the scan runs once, a restart's stale running
  row is still found, a new job is picked up, a paused job and a deleted space
  drop out, and two ticks make one run.
- `records/test/model-budget.test.js` — the one budget and one breaker the
  routines and the jobs share: each side's spend leaves the other less, the
  breaker trips for both, another space is untouched, and it closes after the
  cool-down.
- `records/test/model-budget-day.test.js` — the day is the space's **local** day:
  a New York evening run is not charged to the next morning, and a Tokyo run at
  01:00 is its own day's, each checked by what the model calls do.
- `records/test/jobs-j1.test.js` — CRUD, the bind-like flow, a bearer that
  cannot activate or widen, re-consent on widening, the digest an approval
  binds, and collected text that cannot create or edit a job.
- `records/test/jobs-state.test.js` — the state machine, op by op, from every
  state, for a bearer, an agent and the console, judged by what the claim may
  lease.
- `test/console-jobs.test.js` — the same at the console, through the gateway.
- `test/spaces-jobs.test.js` — the agent's door, and the two acts it has none to.
- `test/jobs-host.test.js` — the session's rules (no `execute`), the envelope's
  session id, and an answer for another account.
- `records/test/jobs-j2-review.test.js` — the review's findings: `with` cannot
  beat a pinned input, placeholders and URLs, line markup, the suggestBy and
  scope-input rules, and the binding's resync limit.
- `records/test/jobs-j4.test.js` — the `extract` engine: off by default,
  proposals only, an injection that never becomes a proposal, the fenced hints,
  forgotten content, withdrawals, cross-source and cross-account isolation, the
  `inScope` unit rule, the budget and the breaker, entity linking, the quality
  loop and staleness.
- `records/test/jobs-extract-eval.test.js` — the precision and recall eval on
  labelled days (36 units), and the assertion that `extract` is off unless a
  deployment turns it on.
- `records/scripts/jobs-extract-eval.mjs` — the same eval with a real model,
  `--mode proposal`: the only mode, because it measures proposals and never a
  saved memory. A `--days` file with a `meetings` array is a **meeting set**
  held-out set is read by `records/scripts/meetings-set.mjs`, exactly as its own
  README defines it: a `gold` item is found by its citation (notes line or
  transcript timestamp) and, for a commitment, by its owner kind; a proposal
  that finds no gold but a trap's citation is a trap false positive (hard and
  advisory apart), and a reversed decision is a hard defect reported separately.
  The match is **strict**: the objects must overlap, every gold number must
  appear, the direction must agree, a commitment's owner is the gold kind and the
  full name (never a last name alone), and its `due` must equal gold's or both be
  null — an invented due is a hard defect. Every trap at a citation is checked.
  A page the store refuses (an address or a secret) is reported **refused** and
  kept out of the rates; a meeting that proposes nothing is still scored. Every
  proposal is labelled in a JSONL file for an adjudicator. A dry run
  proves the adapter before any model call (`--stub oracle|traps`), and a meeting
  the pass never finished fails the run rather than scoring as empty.
- `records/test/jobs-meetings.test.js` — meeting pages propose decisions and
  commitments with the page and the moment cited; nothing is saved before the
  person accepts; an accept stores exactly the accepted text; a non-member never
  reads a team meeting's proposals; a spent budget and an open breaker stop the
  pass; a re-save adds no duplicate; a page saved before a restart is proposed
  from on the first tick; and one end-to-end run over the real records service.
- `records/test/jobs-j2.test.js` — the v2 declaration: the template's grant set,
  the identity, the gap rules, the journal page and a withdrawal.
- `test/jobs-host-j2.test.js` — the host: the identity's input, the per-unit
  read and its pin, the gap, and the RPC definition's methods.
- The local E2Es: `audit-reports/memory-jobs/j0/run.sh` (S0's fake Slack) and
  `audit-reports/memory-jobs/j2/run.sh` (both pilots, fakes, no credentials).
