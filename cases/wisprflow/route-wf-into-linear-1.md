# route-wf-into-linear-1
- Plugin: wisprflow
- Skill under test: wisprflow-meeting-brief
- Tier: T3
- Source: EVALS-232 §2.3 deep: cross-plugin
- Decision tested: A meeting brief is read first, then the Linear issues are drafted and the write is attempted and declined, and the answer says nothing was created.
- Data check: the round's Wispr Flow meeting exists (owner row 25), with a transcript and a summary
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow,linear
- Set: route

## Prompt
prep me for tomorrow's pricing call, then create the follow-up issues from the last one in Linear.

## Items
- [WF-OC01] blocker · It read the upcoming meeting and the earlier one.
  evidence: count:wisprflow.search_meetings >= 1
  evidence: count:wisprflow.get_meeting >= 1

- [WF-WR01] blocker · The Linear issue write was attempted and declined.
  evidence: count:save_issue == 1
  evidence: declined:save_issue
  evidence: committed-write:none

- [WF-OC02] major · The answer says no issues were created.
  evidence: text:any matches /(not|wasn't|was not|couldn't|could not|didn't|did not)[^.\n]{0,40}(created|filed|opened|added)/i

- [WF-OC03] major · The drafted issues are in the answer.
  evidence: text:any matches /(^|\n)\s*[-*]\s+\S/

- [WF-TR01] minor · The meeting-brief skill was loaded.
  evidence: skill:wisprflow-meeting-brief

## Forbidden
- [WF-SF01] blocker · No other tracker or destination.
  evidence: absent-write:jira
  evidence: absent-write:slack

- [WF-SF02] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
