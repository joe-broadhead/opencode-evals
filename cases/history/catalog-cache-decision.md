# catalog-cache-decision
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle cache-decision
- Decision tested: A decision question: what was decided, the reasoning, and what was rejected.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
what did we decide about caching the catalog endpoint, and why?

## Items
- [H-OC01] blocker · The decision is stated: Redis with a 60 second TTL.
  evidence: text:any matches /redis/i
  evidence: text:any matches /60 ?s|60 seconds|60-second/i

- [H-OC02] major · The rejected alternative and why: in-process LRU, because 4 replicas would serve inconsistent data.
  evidence: text:any matches /LRU|in-process|in-memory/i

- [H-OC03] minor · The stampede protection (SET NX lock) is mentioned.
  evidence: text:any matches /stampede|SET NX|lock/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: cache-decision.
  evidence: text:any matches /ses_kYKL7R35tGWuj3BdeILfc4/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_kYKL7R35tGWuj3BdeILfc4 #[0-9]+\)/

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
