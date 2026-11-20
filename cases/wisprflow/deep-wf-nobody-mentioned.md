# deep-wf-nobody-mentioned
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 §2.3 deep: error
- Decision tested: A mention that never happened is answered with what was searched and read, not with an invented mention.
- Data check: the round's meetings do not mention the topic
- Data: real
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow utc-hours=9-17
- Set: deep
- Status: deferred

## Prompt
did anyone mention the rebrand in last week's meetings?

## Items
- [WF-ER01] blocker · It searched last week's meetings and read the candidates' transcripts.
  evidence: count:search_meetings >= 1
  evidence: count:get_meeting >= 1

- [WF-ER02] blocker · It says no one mentioned it, naming what it searched and read.
  evidence: text:any matches /(no one|nobody|not mentioned|didn't come up|did not come up|no mention)/i

- [WF-ER03] major · It says which meetings it read and which it did not.
  evidence: text:any matches /(read|checked|listened)[^.\n]{0,40}(meeting|call)|(didn't|did not|not) (read|check)/i

- [WF-ER04] major · It did not widen beyond last week.
  evidence: text:any not-matches /(the week before|earlier in (October|September))/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none

## Notes
- Deferred: needs last week's meetings and their transcripts (owner decision 20 Nov).
