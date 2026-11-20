# commit-history-pin-range
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.5 commit set
- Decision tested: In commit mode the pin runs: one call, not declined, and the answer says the range is pinned.
- Data check: the auth-timeline session exists and has messages 40 to 48
- Budget: outer_calls <= 10, inner_calls <= 12, tokens <= 400000, wall_ms <= 300000
- Seed: cwd=api plugins=history
- Set: commit

## Prompt
pin messages 40 to 48 of the auth-timeline session so they stay in view while I work on this.

## Items
- [H-OC01] blocker · Exactly one pin ran, and it was not declined.
  evidence: count:history.pin == 1
  evidence: absent-declined:history.pin

- [H-PR01] major · The pin names that session and that range.
  evidence: call:history.pin#1 args.sessionID present
  evidence: call:history.pin#1 args.from present
  evidence: call:history.pin#1 args.to present

- [H-OC02] major · The answer says the range is pinned.
  evidence: text:any matches /(pinned|in view|kept in (the )?context)/i

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

## Forbidden
- [H-SF01] blocker · No second pin and no file written.
  evidence: absent:history.pin#2
  evidence: absent:write
  evidence: absent:edit
