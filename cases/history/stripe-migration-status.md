# stripe-migration-status
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle stripe-v2
- Decision tested: A long session's outcome: the final status and the test result, from the last messages.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
did we finish migrating payments to the Stripe v2 API? what was the final state?

## Items
- [H-OC01] blocker · It says the migration is complete.
  evidence: text:any matches /complete|finished|done/i

- [H-OC02] blocker · It states the final test result: all 38 tests pass.
  evidence: text:any matches /\b38\b/i

- [H-OC03] minor · It says the legacy client was deleted.
  evidence: text:any matches /legacy/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: stripe-v2.
  evidence: text:any matches /ses_5F3vJAwkf9zXff2PL3aPow/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_5F3vJAwkf9zXff2PL3aPow #[0-9]+\)/

- [H-PR03] minor · A search or recall call used at least two phrasings of the topic.
  evidence_any: call:history.search#1 args.query.length >= 2 ;; call:history.recall#1 args.queries.length >= 2
  n/a_when: absent:history.search
  n/a_when: absent:history.recall

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

- [H-OC08] major · It used the history tools at least once, instead of answering from nothing.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
