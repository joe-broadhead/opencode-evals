# Discovery evidence: R2 and native execution observations

## Adjacent read-case correction

The read-case increment starts from signed `976eb26b834198c711ac17ecba3f84255f90a9de`.
S1 was pre-existing, not introduced by that write-case correction.
Reciprocal counting now covers read-only cases with the same definite-mutation classifier.
Complete identity inventories, attributable completed observations, and supplied backend inventories remain required for that count.
Missing arguments do not hide an observed `remember` mutation.
The existing argument-based authorization check also uses this classifier, including page exports.
A supplied unauthorized export remains a contradiction even without backend inventories; no missing inventory becomes empty.
Unavailable actions remain unknown, optional reads remain allowed, and source text does not establish execution.

## Definite mutation count

The reciprocal-count correction starts from signed `91ceca7d871b027eee6cb99f3320faa7b814a245`.
The count uses definite mutation semantics, not exact authorized-payload matching.
`mem_remember` identifies a mutation even when its arguments are unavailable.
Action-based tools require a supplied known mutation action.
Source requests require the source-binding discriminator, and job drafts require the draft operation.
Missing payload content does not erase a known mutation.
Missing action information does not establish a mutation, and optional reads do not count.
Complete identity inventories and completed status remain required by the reciprocal check.
Payload availability and authorization checks remain independent.
No absent inventory becomes an empty inventory.

## Record-envelope correction

The incremental base is signed `091158ef029415f6befd7d1dcdf89a8a307f438e`.
The record validator checks supplied envelope keys and `upsert_path` before the record-availability return.
An absent record cannot suppress a forbidden sibling key or value.
Record-content comparisons still require an actual record object.
The correction does not manufacture missing content or normalize unknown types.

The source-metadata checks remain independent of sibling record fields.
Missing native-session evidence blocks the source-session comparison, but cannot hide malformed source keys, source types, or other supplied record fields.
The same-path matrix covers all six record-write cases in direct and Code Mode forms.
Native producer alignment and runtime evidence remain separate gates.

## Invocation-join corrections

The same increment also addresses N1–N4 from the independent SPEC review of `091158e`.
`execution_complete` describes the invocation inventory and its identity joins, not the availability of every invocation field.
Missing arguments, status, or output still block credit, but do not erase complete order or an independent contradiction.
Without complete order, a proof join requires a supplied call identity on both sides.
Two absent identities never identify the same invocation.

Direct journal comparisons use only overlapping supplied arguments, status, and output.
Neither copy fills missing fields in the other copy.
Backend comparisons retain candidates that missing fields cannot exclude.
Those candidates never grant credit because the field-availability checks still report BLOCKED.
Known differing fields can exclude a candidate without unrelated fields.

Complete backend and invocation inventories require a write bijection in both directions.
Extra successful actual writes fail, as do extra backend writes.
Optional reads do not increase the write count.
Absent inventories remain unavailable rather than empty.

Local output failure checks use the same `parseFirstJson` decoder as the private projector.
Supported JSON errors retain FAIL precedence with surrounding prose.
The decoder does not parse quoted body content recursively or infer errors from prose words.
Future journal schemas remain uninterpreted.

## Consolidated consumer corrections

The correction base is signed `46972538cb0d3a7afaebf24f10b43f2a5f089eb2`.
These changes address H1, F1/M1, F2, and F3/M2 from the independent reviews.
They do not change the native producer or establish runtime readiness.

Every backend write requires the authorized method, canonical payload, and wire payload.
The adapter checks each outer and nested row, not only the expected matching row.
Each supplied write must match a distinct invocation in a complete native inventory.
An extra matching-method write cannot borrow the successful expected row.
Valid optional reads do not grant write permission.
The closed authorized payload for a commitment carries the real records service's own derived bookkeeping — type, title, fields (what/owner/state) and the stated_by default — when the wire omits them, mirroring the service's newRecord and commitmentFields derivation (records/src/model.js:293, 305-313, 276-285, 270-275). The finite fixture serves the same derived row (worlds/mem/discovery-store.mjs records.put), so a reduced wire still stores and answers the full public row the real service would; the wire check itself still demands the producer's exact closed payload.

Known-schema observations retain their local status, output, and argument evidence despite missing completeness or identity metadata.
The private projection adds `unjoined_calls` for observations without a valid tool, call identity, or carrier join.
These observations can establish contradictions but never grant execution credit or supply proof joins.
Argument classification requires an observed tool and arguments.
Status and error-output checks do not require that tool identity.
Unsupported future journal versions remain unavailable.

The projection retains actual direct input values.
Absent or null input remains unavailable, even when the public codec supplies a digest for its default empty object.
A recorded empty object remains supplied evidence and receives normal argument validation.
Neither the public codec nor expected arguments can repair missing direct input.

The CLI distinguishes file absence from a supplied JSON value.
A supplied null, array, string, boolean, or number is a malformed journal and produces FAIL.
The in-memory interface retains its default-null absence convention.
Direct recordings without a sidecar can pass.
A complete empty journal fails, and an incomplete empty journal remains BLOCKED.

The focused matrix covers all 24 cases and both recording modes.
It includes unrelated missing metadata, malformed fields, optional reads, extra writes, and 528 on-disk sidecar classifications.
The original independent CLI safety suites remain unchanged.
All checks use synthetic offline evidence, not native production recordings.

## Prior R2 handoff

Incremental base: signed `9531cf698aac0c6a875ef0c27a144ffe2d4602fc`.
This document supersedes the earlier sole-returned-await exception.
The historical reports remain unchanged.

## Capture consistency

The discovery adapter validates both outer and nested capture collections independently.
It also compares overlapping facts under `oc-mem-capture/1` and `oc-mem-discovery-proof/1`.
The overlapping fields are:

- Outer `before` and nested `before`
- Outer `after` and nested `state`
- Outer `requests` and nested `requests`
- Outer `creators`, when supplied, and nested `creators`

An absent artifact remains unavailable.
The adapter never fills one copy from another copy.
Available contradictions retain FAIL precedence over unrelated missing artifacts.
The final priority remains FAIL, then BLOCKED, then PASS.

Every supplied creator must have a closed identity, context, tool, argument payload, and stored status.
Creator identities must be unique and absent from the seed.
Each creator must identify an actual new object and a successful backend creation.
Complete actual invocation evidence must also identify that creation.
Read cases and raw-file writes cannot supply object creators.

## Private recording interface

```js
projectMemoryRecording(rawLines, source, nativeJournal = null)
```

The CLI supplies `source.case_id` and `source.trial` from its case and physical trial selection.
Physical trial numbers start at one.
The semantic `trial_id` is distinct from the physical trial number.
The grader compares that semantic identity with the capture and native guard.

The projection remains a non-enumerable `runView.memoryRecording` property.
It never enters ordinary traces, verdicts, or diagnostic messages.
The raw source digest still binds the projection to the official trace.
Argument digests retain the existing `sha256(JSON.stringify(arguments))` codec and recorded key order.

Direct native tool events remain execution evidence.
Code Mode source is never execution evidence, including a sole returned await with valid literal arguments.
The source parser supplies structural trace facts only.
Its call sites cannot grant execution credit or set executed-call counts.
Native observations can describe dynamic arguments, loops, or calls absent from source sites.

## Discovery consumer contract

The discovery-only CLI reads `${rawBase}.mem-invocations.json` when that file exists.
The file is private native evidence, not model output, a capture header, or an ordinary trace field.
The current branch implements the consumer only.
The core worker owns the producer and `mem-turns` integration.
No producer schema agreement or merged runtime emission is claimed here.

The consumer accepts this schema:

```json
{
  "schema": "oc-mem-invocations/1",
  "scope": {
    "case_id": "<native case ID>",
    "trial": 1,
    "trial_id": "<native semantic trial ID>",
    "turn": 1,
    "session": "<native session ID>"
  },
  "raw_sha256": "<SHA-256 of the selected raw JSONL>",
  "complete": true,
  "calls": [
    {
      "call_id": "<unique native invocation ID>",
      "carrier_call_id": "<raw tool-event callID>",
      "tool": "mem_page",
      "args": {"action": "read", "id": "<resolved ID>"},
      "status": "completed",
      "output": "<actual native output string>"
    }
  ]
}
```

The journal covers all Memory invocations in that scope, including direct invocations.
Its array order is the native invocation order.
Each invocation identifies its raw carrier event.
Multiple invocations can identify the same Code Mode carrier.
Native invocation IDs remain unique across the journal.
Direct journal observations must agree with actual direct events.
The recorder must capture resolved arguments, actual status, and actual output at invocation time.
It cannot reconstruct observations from source or from the private fixture proof.

The raw digest uses the existing codec: `sha256(rawLines.join("\n"))` after removal of blank lines.
The case, physical trial, turn, session, semantic trial, and carrier identities must agree with independently available evidence.
Discovery currently supports one native turn per trial.

`complete:true` means that the journal contains every Memory invocation in the scope.
A complete empty journal is authoritative, even when the source contains required calls.
It cannot satisfy a case that requires an invocation.
A source-derived empty proof is not an authoritative empty journal.
An incomplete, absent, or unsupported future journal supplies no execution fallback from source.
Missing required execution evidence produces BLOCKED.
Malformed or contradictory supplied evidence produces FAIL.
An incomplete journal can still establish an error, unauthorized argument payload, or foreign scope.

Raw direct facts remain available for independent contradiction checks.
They never repair a supplied journal or change its authoritative call inventory.
A complete journal that omits an actual direct event is contradictory.

## Tests and integration gates

The R2 reproduction at the base had 220 failed safety assertions out of 288.
Those assertions cover all 24 cases in direct and Code Mode forms.
The first journal tests also reproduced source-only credit and ignored empty journals.

Positive synthetic fixtures now capture native observations from completed operation lists before proof or source mutations.
These fixtures exercise the consumer contract only.
They are not runtime recordings or evidence that the native producer exists.
The positive confirmation fixture supplies consistent outer, nested, and actual observations.
No previous negative expectation changed.

The new suite also covers absent, incomplete, empty, malformed, foreign, replayed, and failed native observations.
Source-only controls include literal awaits, dead branches, absent call sites, and dynamic arguments.
Pure CLI controls exercise the sidecar loader and R2 contradictions.
Original reports, probes, archive files, frozen cases, and core contracts remain unchanged.

The existing dependency inventory remains a union.
No prior entry was removed, including `mem-turns.mjs` after removal of its projector import.
The separately owned S2/S4 and core changes remain unmerged.
The integration owner must align the native producer with this consumer contract before a combined runtime claim.
The integration owner must also union the four older dependency omissions and refresh combined provenance.

All results are offline implementation evidence.
Independent review, native producer integration, and runtime trials remain pending.
