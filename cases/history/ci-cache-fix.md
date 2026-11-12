# ci-cache-fix
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle ci-cache
- Decision tested: Cross-project (lumen-infra), with numbers.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Set: guard

## Prompt
our CI used to take forever because the npm cache never hit. how did we fix that?

## Items
- [H-OC01] blocker · The fix is stated: the cache key hashes only the root package-lock.json.
  evidence: text:any matches /hashFiles\('package-lock\.json'\)|root (package-)?lock|package-lock\.json/i

- [H-OC02] blocker · The results are stated: 0% to 94% hit rate, 11m to 4m.
  evidence: text:any matches /94/i
  evidence: text:any matches /\b4 ?m(in)?\b|4 minutes|\bto 4\b|→ ?4\b/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: ci-cache.
  evidence: text:any matches /ses_JSwEG9AUkpYr3Ijuh8tFFr/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_JSwEG9AUkpYr3Ijuh8tFFr #[0-9]+\)/

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
