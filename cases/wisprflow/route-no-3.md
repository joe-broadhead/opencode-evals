# route-no-3
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: Dictation history is not readable here: no tool call, one sentence saying so, and the nearest real thing offered.
- Data check: none
- Data: real
- Budget: outer_calls <= 4, inner_calls <= 3, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=wisprflow
- Set: route

## Prompt
what did I dictate this morning? I want the exact words.

## Items
- [WF-RT01] blocker · No Wispr Flow tool call for dictation history.
  evidence: absent:wisprflow.*

- [WF-OC01] major · It says dictation history cannot be read here.
  evidence: text:any matches /(dictation|dictated)[^.\n]{0,60}(can't|cannot|not available|don't have|do not have|no access|isn't|not something)/i

- [WF-OC02] major · It offers Scratchpad or a meeting instead.
  evidence: text:any matches /(scratchpad|a meeting|meeting notes)/i

- [WF-RT02] minor · No Wispr Flow skill loaded for dictation.
  evidence: absent-skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
