# multi-hop-queue-incident
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needles queue-sqs + incident-212
- Decision tested: Two sessions in two projects connected by an incident id: the decision and its cause.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
why did we move off BullMQ? what actually went wrong?

## Items
- [H-OC01] blocker · It says Redis evicted queued jobs under memory pressure (allkeys-lru), INC-212.
  evidence: text:any matches /INC-212/i

- [H-OC02] blocker · It says the jobs moved to SQS with a dead-letter queue.
  evidence: text:any matches /SQS/i

- [H-OC03] blocker · It gives the Redis eviction policy: allkeys-lru.
  evidence: text:any matches /allkeys-lru|evict/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: queue-sqs, incident-212.
  evidence: text:any matches /ses_i91e84HMfSRUGwMYuodUqK/
  evidence: text:any matches /ses_cAo9i4dnBtxutFJaM4WfxD/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_i91e84HMfSRUGwMYuodUqK #[0-9]+\)/ ;; text:any matches /\(ses_cAo9i4dnBtxutFJaM4WfxD #[0-9]+\)/

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
