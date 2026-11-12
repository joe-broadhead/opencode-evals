# nightly-run-count
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: nightly-1..12
- Decision tested: A count over similar sessions: one sql/sessions answer of 12, not an estimate from a page of results.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
how many times has the nightly PR digest run so far?

## Items
- [H-OC01] blocker · It states 12 runs.
  evidence: text:any matches /\b12\b|twelve/i

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

- [H-EF01] minor · Few calls were needed.
  evidence: budget:inner_calls <= 5

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
