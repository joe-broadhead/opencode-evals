# tools-read-summaries
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle stripe-v2 (2 compactions)
- Decision tested: history_read with kinds: only the compaction summaries of a long session, not its 50+ messages.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 300000

## Prompt
show me only the compaction summaries of the Stripe v2 migration session, nothing else

## Items
- [H-OC01] blocker · It quotes the summary content: the STRIPE_LEGACY=1 flag.
  evidence: text:any matches /STRIPE_LEGACY/i

- [H-OC02] major · It read with kinds (summary) instead of paging through every message.
  evidence: call:history.read#1 args.kinds present

- [H-OC03] major · It shows two summaries (the session was compacted twice).
  evidence: text:any matches /idempotency/i
  evidence: text:any matches /legacy client/i

- [H-EF01] minor · A handful of calls at most.
  evidence: count:history.* <= 5

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
