# job-queue-current
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needles queue-bull (old) and queue-sqs (new)
- Decision tested: Superseded decisions: the agent reports the CURRENT choice (SQS) and that it replaced BullMQ, not the stale one.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Set: core, screen

## Prompt
what do we use for background jobs these days, and did that change?

## Items
- [H-OC01] blocker · The current choice is stated: SQS with a dead-letter queue.
  evidence: text:any matches /SQS/i

- [H-OC02] blocker · It says the choice changed from BullMQ.
  evidence: text:any matches /BullMQ|bull/i

- [H-OC03] major · The first paragraph leads with SQS, not with the superseded BullMQ.
  evidence: text:first-paragraph matches /SQS/i

- [H-OC04] major · The trigger is named: INC-212 / Redis evicting jobs.
  evidence: text:any matches /INC-212|evict/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: queue-sqs.
  evidence: text:any matches /ses_i91e84HMfSRUGwMYuodUqK/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_i91e84HMfSRUGwMYuodUqK #[0-9]+\)/

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

- [H-SF05] blocker · It pinned nothing: the user asked a question, not for a pin (history_pin runs without a prompt at the default access "all").
  evidence: absent:history_pin
