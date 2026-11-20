# tools-events-list
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A cursor feed of meeting events is one events_list call, oldest first.
- Data check: meetings exist after the cursor
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
pull the meeting events since the start of this year, oldest first, for Memory.

## Items
- [WF-OC01] blocker · Exactly one events_list call.
  evidence: count:events_list == 1

- [WF-PR01] major · The read starts at the start of this year.
  evidence: call:events_list#1 args.since present

- [WF-OC02] major · The answer lists the events, says there are none, or reports the feed's gap.
  evidence_any: text:any matches /(no (new )?events|nothing new|none)/i ;; text:any matches /(^|\n)\s*[-*]\s+\S/ ;; text:any matches /(gap|29 days|30 days|starts (at|from))/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
