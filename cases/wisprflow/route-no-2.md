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
  evidence: absent:wisprflow.*

- [WF-RT03] major · It read Plaud, or says it cannot reach the recording.
  evidence_any: count:plaud.* >= 1 ;; text:any matches /(can't|cannot|couldn't|could not|don't have|do not have)[^.\n]{0,30}(access|reach|read)[^.\n]{0,20}(recording|audio)/i

- [WF-RT02] minor · No Wispr Flow skill loaded when Plaud is named.
  evidence: absent-skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
