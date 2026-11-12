# latest-nightly-digest
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: nightly-1..12 (12 near-identical sessions)
- Decision tested: Scheduled-prompt runs fold into one 'similar' hit: the agent lists them with sessions(title) and reads the NEWEST.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
what did the most recent nightly PR digest say?

## Items
- [H-OC01] blocker · It reports the newest digest's PRs: #509, #511 and #514.
  evidence: text:any matches /#514/i
  evidence: text:any matches /#511/i
  evidence: text:any matches /#509/i

- [H-OC02] major · It does not report an older digest as the latest (#482 is the oldest digest's first PR).
  evidence: text:any not-matches /#482/i

- [H-PR01] major · A citation in the full form (ses_… #seq).
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · It listed sessions by title and recency, or read the newest nightly session.
  evidence_any: call:history.sessions#1 args.title present ;; call:history.sql#1 args.sql present ;; call:history.search#1 args.query present

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
