# The claims layer (S2)

Docs/design/memory-routines-v1.md §4 and §5, in the repository's schema terms.

A claim is one cited statement: a subject, an attribute, a canonical value, a
statement for display, who stated it, a quote, its refs, and its knowledge key.
Records and page lines are projections of claims and keep the claim ids they
cite. The log is additive in each space file, beside the records, so an older
service opens the file unchanged and a rollback touches no space file.

## The switch

`RECORDS_CLAIMS=on` opens the layer. Anything else, including unset, leaves it
off: `openClaims` answers `null`, the page writer is not made, the journal view
answers `null`, and `forgetClaims` answers `{skipped: "off"}`. Nothing is
written while the switch is off, so the daily's behaviour is what it was.

## Modules

| Module | What it holds |
|---|---|
| `flag.js` | the switch |
| `keys.js` | knowledge keys, the claim key and the rejection key |
| `values.js` | a canonical value and a normalised task |
| `registry.js` | the core types, their rule, precedence, the supersession verdict |
| `target.js` | the known-or-new rule for a decision's or fact's subject and attribute |
| `store.js` | the log: file, cite, reject, expire, pin |
| `projections.js` | append, transition, upsert, reduce's interface |
| `pages.js` | the 15-minute page writer and routine-version compaction |
| `forget.js` | the forget cascade |
| `journal.js` | a day's journal as a view |
| `rows.js` | reading a claim row the same way everywhere |

## The tables

All of them are in `ADDITIVE` in `records/src/schema.js`, created when missing
without raising `schema_version`:

| Table | What it holds |
|---|---|
| `claims` | one cited statement per row, with its count, dates and at most 20 refs |
| `claim_marks` | keyed hashes of a rejection, never text |
| `claim_pins` | one attribute a person's edit pinned |
| `claim_lines` | a projection line and the claim ids it cites |
| `claim_page_writes` | when a projected page last changed, and its digest |

## Rollback

A space that holds claims was written by a build that knows the claims tables.
A build that does not know them cannot scrub them when a person is erased, so
the writer records `claims_build` in `meta` and an opening build refuses a file
whose marker it does not know. An operator acknowledges a rollback with
`RECORDS_CLAIMS_ROLLBACK_ACK=on`, or purges the claims tables first:

```sql
delete from claim_forget_pending;
delete from claim_lines;
delete from claim_pins;
delete from claim_marks;
delete from claim_page_writes;
delete from claims;
delete from meta where key in ('claims_build', 'claims_mark_key');
```

The tables are additive, so a rollback that purges them leaves every record and
page as it was. The full operator procedure is
[docs/operations/records-rollback.md](../../../docs/operations/records-rollback.md).

## The forget hook

Lane 0129's per-item `events.forget` calls:

```js
forgetClaims(handle, { refs, subjects, statedBy, claimIds, pages, tz })
```

inside its own transaction. It deletes the claims that cite only a forgotten
item, drops the item from a claim that keeps another citation, removes every
line that cited a deleted claim, re-projects a line that keeps a citation,
purges the older page versions that held a removed line, and reports the
journal days to rebuild. It runs with no model call.
