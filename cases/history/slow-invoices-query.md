# slow-invoices-query
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle billing-index
- Decision tested: A performance fix with numbers: the agent reports the composite index and the before/after timings.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
how did we speed up the invoices list query a while back?

## Items
- [H-OC01] blocker · The composite index on (customer_id, created_at DESC) is named.
  evidence: text:any matches /idx_invoices_customer_created|customer_id, ?created_at/i

- [H-OC02] blocker · The timings are stated: 840 ms before, 12 ms after.
  evidence: text:any matches /840/i
  evidence: text:any matches /\b12 ?ms/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: billing-index.
  evidence: text:any matches /ses_Ow3jePEfTNML6lyyRoyaNI/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_Ow3jePEfTNML6lyyRoyaNI #[0-9]+\)/

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
