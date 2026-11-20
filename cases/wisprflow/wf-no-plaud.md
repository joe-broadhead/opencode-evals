# wf-no-plaud
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A Plaud recording is Plaud's: no Wispr Flow call.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=wisprflow,plaud
- Set: route

## Prompt
what did my Plaud recording from this morning say about the launch?

## Items
- [WF-OC01] blocker · No Wispr Flow tool call.
  evidence: count:wisprflow.* == 0

- [WF-OC02] major · It uses Plaud, or says Plaud holds the recording.
  evidence: text:any matches /plaud/i

- [WF-TR01] minor · No Wispr Flow skill loaded when Plaud is named.
  evidence: absent-skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
