# tools-pin-list
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: history_pin
- Decision tested: history_pin's other actions: list the pins, then remove any. At v0.0.0's default access (all) it runs without a prompt; under the ask-changes arm a refusal is reported plainly and not retried.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000
- Set: smoke, f7

## Prompt
list the history pins in this session, and remove any that exist

## Items
- [H-OC01] blocker · It called history_pin.
  evidence: call:history_pin#1

- [H-OC02] major · The first call used action: list.
  evidence: call:history_pin#1 args.action == list

- [H-OC03] major · It tells the user plainly what happened: there are no pins (a fresh session has none), or approval was needed.
  evidence: text:any matches /no (history )?pins|(0|zero|none) pins?|nothing (is |was )?pinned|no pinned|not (any|find any) pins|declined|denied|needs? (your )?approval|permission/i

- [H-EF01] minor · It did not retry a refused pin more than twice.
  evidence: count:history_pin <= 2

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
