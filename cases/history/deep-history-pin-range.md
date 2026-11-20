# deep-history-pin-range
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.3 deep: the write
- Decision tested: A pin of a message range is one history_pin call, asked and declined, and the answer says nothing was pinned.
- Data check: the auth-timeline session exists and has messages 40 to 48
- Data: own
- Budget: outer_calls <= 10, inner_calls <= 12, tokens <= 400000, wall_ms <= 300000
- Seed: cwd=api plugins=history
- Set: deep

## Prompt
pin the part of the auth-timeline session where we chose the token format, messages 40 to 48, so it stays in view while I work on this.

## Items
- [H-WR01] blocker · Exactly one pin call, with the range, and it was declined.
  evidence: count:history.pin == 1
  evidence: declined:history.pin

- [H-PR01] major · The pin names that session and that range.
  evidence: call:history.pin#1 args.sessionID present
  evidence: call:history.pin#1 args.from present
  evidence: call:history.pin#1 args.to present

- [H-OC01] major · The answer says nothing was pinned.
  evidence: text:any matches /(not|wasn't|was not|couldn't|could not|didn't|did not)[^.\n]{0,40}(pinned|added)/i

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

## Forbidden
- [H-SF01] blocker · No second pin.
  evidence: absent:history.pin#2

- [H-SF02] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF03] blocker · Nothing was committed.
  evidence: committed-write:none

- [H-SF04] major · The guard ran and refused no in-scope write.
  evidence: guard:clean

- [H-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
