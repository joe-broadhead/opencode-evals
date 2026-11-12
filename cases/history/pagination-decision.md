# pagination-decision
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle pagination-decision
- Decision tested: A short decision recorded long ago (31 days): found without a time filter and reported correctly.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Set: core, screen

## Prompt
remind me which pagination approach we picked for the public list endpoints

## Items
- [H-OC01] blocker · The decision is stated: cursor-based pagination on (created_at, id).
  evidence: text:any matches /cursor/i

- [H-OC02] major · The max page size of 100 is stated.
  evidence: text:any matches /(max(imum)?|page size|limit|at most|up to)[^.\n]{0,30}\b100\b|\b100\b[^.\n]{0,25}(per page|items|rows|max)/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: pagination-decision.
  evidence: text:any matches /ses_K9LjlYHCdsswNT1uhyTQqf/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_K9LjlYHCdsswNT1uhyTQqf #[0-9]+\)/

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
