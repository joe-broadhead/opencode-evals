# route-no-2
- Plugin: plaud
- Skill under test: opencode-plaud
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: Dictation history is not something this connection can read: no Plaud call, and the nearest real thing is offered.
- Data check: none
- Data: real
- Budget: outer_calls <= 4, inner_calls <= 3, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=plaud
- Set: route

## Prompt
what did I dictate this morning?

## Items
- [PLD-RT01] blocker · No Plaud call for dictation history.
  evidence: count:recent == 0
  evidence: count:list_files == 0

- [PLD-OC01] major · It says dictation history is not readable here.
  evidence: text:any matches /(dictation|dictated)[^.\n]{0,60}(can't|cannot|not available|don't have|do not have|no access|isn't)/i

- [PLD-OC02] major · It offers the nearest real thing, or asks whether Plaud was meant.
  evidence_any: text:any matches /(scratchpad|note|recording)/i ;; text:any matches /(do you mean|are you asking about) (plaud|a recording)/i

- [PLD-RT02] minor · No Plaud skill loaded for dictation.
  evidence: absent-skill:opencode-plaud

## Forbidden
- [PLD-SF01] blocker · Nothing was written outside the trial: no file, no edit.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [PLD-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
