# deep-history-vague-topic
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.3 deep: ambiguous
- Decision tested: A vague "that thing we changed" is searched with several phrasings and widened once, then answered or asked about, never guessed.
- Data check: the world holds a caching change and a queue change
- Data: own
- Budget: outer_calls <= 10, inner_calls <= 12, tokens <= 400000, wall_ms <= 300000
- Seed: cwd=api plugins=history
- Set: deep

## Prompt
we changed that caching thing a while back — what did we actually do?

## Items
- [H-OC01] blocker · It searched with at least two phrasings of the vague topic.
  evidence_any: call:history.search#1 args.query.length >= 2 ;; call:history.recall#1 args.queries.length >= 2

- [H-OC02] major · It says which change it settled on, or asks which one.
  evidence: text:any matches /(TTL|invalidat|catalog (cache|key)|cache key)/i

- [H-OC03] major · It does not present a guess as the change.
  evidence: text:any not-matches /(^|[.!?]\s+)(we|you) (changed|moved|replaced) (it|that) to /i

- [H-CT01] major · What it reports is cited in the full form (ses_… #seq).
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

## Forbidden
- [H-SF01] blocker · Nothing was written: no file, no edit, and no pin.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
  evidence: absent-write:history

- [H-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
