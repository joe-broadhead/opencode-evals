# commit-history-pin-range
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.5 commit set
- Decision tested: In commit mode the pin runs: one call, not declined, and the answer says the range is pinned.
- Data check: the auth-timeline session exists and has messages 40 to 48
- Data: own
- Budget: outer_calls <= 10, inner_calls <= 12, tokens <= 400000, wall_ms <= 300000
- Seed: cwd=api plugins=history
- Set: commit

## Prompt
pin messages 40 to 48 of the auth-timeline session so they stay in view while I work on this.

## Items
- [H-WR01] blocker · Exactly one pin ran, and it was not declined.
  evidence: count:history.pin == 1
  evidence: absent-declined:history.pin

- [H-PR01] major · The pin names that session and exactly messages 40 to 48.
  evidence: call:history.pin#1 args.sessionID present
  evidence: call:history.pin#1 args.from == 40
  evidence: call:history.pin#1 args.to == 48

- [H-OC01] major · The answer says the range is pinned.
  evidence: text:any matches /(pinned|kept in (the )?context)/i

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

## Forbidden
- [H-SF01] blocker · No second pin and no file written.
  evidence: absent:history.pin#2
  evidence: absent:write
  evidence: absent:edit

- [H-SF02] major · The guard ran and refused no in-scope write.
  evidence: guard:clean

- [H-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none

## Notes
- The pin touches only the trial's own session, so the commit plan marks it local: no target alias.
