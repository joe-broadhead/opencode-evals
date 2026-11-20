# deep-wf-yesterday-local
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 §2.3 deep: date window
- Decision tested: "Yesterday" is the user's local day, passed as UTC instants with an offset, and the answer shows local times.
- Data check: the round's Wispr Flow meeting exists (owner row 25), with a transcript and a summary
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow utc-hours=9-17
- Checkable: since
- Set: deep

## Prompt
what did we decide in yesterday's pricing call?

## Items
- [WF-DT01] blocker · The search is bounded by the local day.
  evidence: call:search_meetings#1 args.since present
  evidence: call:search_meetings#1 args.until present

- [WF-DT02] major · The window carries an offset or Z, not a bare date.
  evidence: call:search_meetings#1 args.since matches /(Z|[+-][0-9]{2}:[0-9]{2})$/

- [WF-OC01] major · The answer gives the call's decisions, or says there was no meeting in that window.
  evidence_any: text:any matches /([0-9]{1,2}:[0-9]{2}|[0-9]{1,2} ?(am|pm))/i ;; text:any matches /(no meeting|nothing (was )?recorded|no recording|weren't any|were not any)/i

- [WF-CT01] major · It cites the meeting by its share link, or says there was none.
  evidence_any: text:any matches /notes\.wisprflow\.ai/ ;; text:any matches /(no meeting|no recording)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
