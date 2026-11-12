# earlier-in-this-session
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle stripe-v2, continued as the current session (two compactions hide the first message from the model's context)
- Decision tested: (runnable since HG-4) scope "session" (or includeCurrent, or a read of the current session) recovers what was said before a compaction; the agent must not guess from the compaction summary alone.
- Seed: cwd=api continue=stripe-v2
- Controls: no-skill (expect pass); no-plugin (expect partial: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 240000
- Set: extra
- Truth: ids.stripe-v2 == ses_5F3vJAwkf9zXff2PL3aPow

## Prompt
what exactly did I ask you to do at the very start of this session, word for word?

## Items
- [H-OC01] blocker · It quotes the first message: migrate from the Stripe v1 charges API to v2 payment intents, keep behaviour identical, invoices in flight.
  evidence: text:any matches /v1 charges API/i
  evidence: text:any matches /invoices in flight|keep behaviou?r identical/i

- [H-PR05] major · It read this session from History: scope session, includeCurrent, or a read of the current session.
  evidence_any: call:history.search#1 args.scope == session ;; call:history.search#1 args.includeCurrent == true ;; call:history.read#1 ;; call:history.sessions#1 args.scope == session ;; call:history.sql#1

- [H-OC08] major · It used the history tools rather than the compaction summary alone.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing.
  evidence: absent:history_pin

## Notes
- Needs the runner to pass `--session <stripe-v2 id>` to `opencode run` (HG-4). The session must be the world's copy in the sandbox, so the run appends to it; delete the sandbox afterwards as today.
- "session" is in the pack's vocab, so `args.scope == session` survives the trace's redaction.
- Families: F5 (scope session, includeCurrent). World: unchanged.
