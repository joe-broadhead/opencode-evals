# ho-checkout-deadlock
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle flaky-checkout
- Decision tested: Held out: a needle no tune case asks about.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Holdout: true
- Status: retired

## Prompt
what was behind the 'deadlock detected' failures in the checkout e2e tests?

## Items
- [H-OC01] blocker · Cause: the e2e database fixtures were seeded once and never reset between tests.
  evidence: text:any matches /reset|seed/i

- [H-OC02] blocker · Fix: resetDb in beforeEach and the e2e project on maxWorkers: 1.
  evidence: text:any matches /maxWorkers|beforeEach|serial/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: flaky-checkout.
  evidence: text:any matches /ses_0MrdG1h25PzOYn9RSRQDlr/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_0MrdG1h25PzOYn9RSRQDlr #[0-9]+\)/

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
