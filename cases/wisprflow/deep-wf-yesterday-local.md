# deep-wf-yesterday-local
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 §2.3 deep: date window
- Decision tested: "Yesterday" is the user's local day, passed as UTC instants with an offset, and the answer shows local times.
- Data check: synthetic: the round's Wispr Flow meeting (owner row 25) exists, with a transcript and a summary
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow utc-hours=9-17
- Set: deep

## Prompt
what did we decide in yesterday's pricing call?

## Items
- [WF-OC01] blocker · The search is bounded by the local day.
  evidence: call:search_meetings#1 args.since present
  evidence: call:search_meetings#1 args.until present

- [WF-PR01] major · The window carries an offset or Z, not a bare date.
  evidence: call:search_meetings#1 args.since matches /(Z|[+-][0-9]{2}:[0-9]{2})$/

- [WF-OC02] major · The answer gives the decisions and shows local times.
  evidence: text:any matches /([0-9]{1,2}:[0-9]{2}|[0-9]{1,2} ?(am|pm))/i

- [WF-OC03] major · It cites the meeting by title, date and share link.
  evidence: text:any matches /notes\.wisprflow\.ai/

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
