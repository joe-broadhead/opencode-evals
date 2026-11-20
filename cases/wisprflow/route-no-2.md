# route-no-2
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A Plaud recording is Plaud's: no Wispr Flow call.
- Data check: none
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=wisprflow
- Set: route

## Prompt
what did my Plaud recording from this morning say about the launch?

## Items
- [WF-RT01] blocker · No Wispr Flow tool call.
  evidence: count:search_meetings == 0
  evidence: count:get_meeting == 0

- [WF-OC01] major · It uses Plaud, or says Plaud holds the recording.
  evidence: text:any matches /plaud/i

- [WF-RT02] minor · No Wispr Flow skill loaded when Plaud is named.
  evidence: absent-skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
