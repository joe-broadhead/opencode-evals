# tools-pin-list
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: history_pin
- Decision tested: history_pin's other actions: list the pins, then remove them. Always asks; a refusal is reported plainly, not retried.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000

## Prompt
list the history pins in this session, and remove any that exist

## Items
- [H-OC01] blocker · It called history_pin.
  evidence: call:history_pin#1

- [H-OC02] major · The first call used action: list.
  evidence: call:history_pin#1 args.action == list

- [H-OC03] major · It tells the user plainly what happened (no pins, or approval was needed).
  evidence: text:any matches /pin/i

- [H-EF01] minor · It did not retry a refused pin more than twice.
  evidence: count:history_pin <= 3

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
