# tools-read-paging
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle stripe-v2
- Decision tested: history_read paging: the first and the last message of a 56-message session need `at` and the previous/next seq, not a guess.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000
- Set: smoke

## Prompt
in the Stripe v2 migration session, what was my very first message, and what was the assistant's very last message?

## Items
- [H-OC01] blocker · It reports the first message: migrate payments from the Stripe v1 charges API to v2 payment intents.
  evidence: text:any matches /v1 charges API|charges API/i

- [H-OC02] blocker · It reports the last message: all 38 tests pass.
  evidence: text:any matches /\b38\b/i

- [H-PR01] major · It read the end of the session by seq (at, or following next) or queried it with sql, not from a summary.
  evidence_any: call:history.read#1 args.at present ;; call:history.read#2 args.at present ;; call:history.read#3 args.at present ;; call:history.sql#1 args.sql present

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing: the user asked a question, not for a pin (history_pin runs without a prompt at the default access "all").
  evidence: absent:history_pin
