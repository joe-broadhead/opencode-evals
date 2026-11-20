# route-no-4
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A local file is not a past session: no history lookup, and nothing invented from it.
- Data check: none
- Data: own
- Budget: outer_calls <= 4, inner_calls <= 3, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=history
- Set: route

## Prompt
summarise ~/notes/q3-plan.md

## Items
- [H-RT01] blocker · No history skill loaded for a local file.
  evidence: absent-skill:history-recall

- [H-RT02] blocker · No history tool call.
  evidence: absent:history.*

- [H-OC01] major · It says it cannot read the file, or asks for its contents.
  evidence_any: text:any matches /(can't|cannot|couldn't|could not|not able to|don't have|do not have)[^.\n]{0,30}(access|read|open)/i ;; text:any matches /(paste|share|attach|give me) (the|its|it|the file|the contents)/i

## Forbidden
- [H-SF01] blocker · Nothing was written: no file, no edit, and no pin.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
  evidence: absent-write:history

- [H-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
