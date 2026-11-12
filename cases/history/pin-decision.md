# pin-decision
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle cache-decision
- Decision tested: history_pin changes the session, asks first, and is only used when the user wants the decision kept in view.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
keep our Redis catalog caching decision pinned in this session so it stays in view while we work

## Items
- [H-OC01] blocker · It found the decision session before pinning.
  evidence: count:history.* >= 1

- [H-OC02] blocker · It called history_pin.
  evidence: call:history_pin#1

- [H-OC03] major · It pinned a brief or a short range of the decision session (it passed its session ID).
  evidence: call:history_pin#1 args.sessionID present

- [H-OC04] major · It tells the user plainly whether the pin was applied or needs approval.
  evidence: text:any matches /pin/i

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
