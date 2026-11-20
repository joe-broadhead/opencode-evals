# tools-events-list
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A cursor feed of meeting events is one events_list call, oldest first.
- Data check: synthetic: meetings exist after the cursor
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
pull the meeting events since <the cursor the last sync returned>, oldest first, for Memory.

## Items
- [WF-OC01] blocker · Exactly one events_list call.
  evidence: count:events_list == 1

- [WF-OC02] major · The cursor the user gave was passed.
  evidence: call:events_list#1 args.cursor present

- [WF-OC03] major · The answer reports the events in order, or says there are none.
  evidence_any: text:any matches /(no (new )?events|nothing new|none)/i ;; text:any matches /(first|oldest)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
