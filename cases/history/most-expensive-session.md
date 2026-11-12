# most-expensive-session
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: stripe-v2 ($14.87)
- Decision tested: A ranking: sessions sorted by cost, not a search for the word 'expensive'.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Status: retired

## Prompt
what's the most expensive OpenCode session I've ever run, and what was it about?

## Items
- [H-OC01] blocker · It names the Stripe v2 migration session.
  evidence: text:any matches /stripe/i

- [H-OC02] blocker · It states the cost: $14.87.
  evidence: text:any matches /14\.87/i

- [H-PR01] major · It ranked by cost (sessions with sort: cost, or one sql statement) rather than searching for 'expensive'.
  evidence_any: call:history.sessions#1 args.sort == cost ;; call:history.sql#1 args.sql present

- [H-PR02] major · It named the session in a citation.
  evidence: text:any matches /ses_5F3vJAwkf9zXff2PL3aPow/

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
