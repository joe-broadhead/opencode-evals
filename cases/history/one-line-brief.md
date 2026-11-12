# one-line-brief
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle stripe-v2 (56 messages, 2 compactions; a brief carries the outcome and the last reply)
- Decision tested: F13 size discipline. A one-sentence answer about a long session needs a search hit and a brief, not a full read of 56 messages.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 8, inner_calls <= 6, wall_ms <= 240000
- Set: core, new

## Prompt
in one sentence, what did the Stripe v2 migration session achieve?

## Items
- [H-OC01] blocker · It says what was achieved: payments moved to v2 payment intents (all 38 tests pass, legacy client deleted).
  evidence: text:any matches /payment ?intents?|38 tests|legacy client/i

- [H-OC09] major · It names the session: stripe-v2.
  evidence: text:any matches /ses_5F3vJAwkf9zXff2PL3aPow/

- [H-EF01] major · Four History calls at most.
  evidence: count:history.* <= 4

- [H-EF02] minor · It did not page through the session (at most one read).
  evidence: count:history.read <= 1

- [H-EF03] minor · The answer stays short (under about 1,200 characters).
  evidence: text:any not-matches /^[\s\S]{1200,}$/

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing.
  evidence: absent:history_pin

## Notes
- A token budget would be the direct measure, but tokens per run are dominated by cache reads of the system prompt and vary by host; add `budget:tokens <=` once the baseline gives a distribution (T4).
- Families: F13 (size discipline). World: unchanged.
