# stripe-idempotency-format
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle stripe-v2 (60 messages, 2 compactions)
- Decision tested: A detail from a long compacted session: found through its compaction summary or an early message.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Set: core, screen

## Prompt
what format do we use for the Stripe idempotency keys?

## Items
- [H-OC01] blocker · The key format is stated exactly: lumen_${invoiceId}_${attempt}.
  evidence: text:any matches /lumen_\$\{invoiceId\}_\$\{attempt\}/i

- [H-OC02] minor · It says why: deterministic, so retries cannot double-charge.
  evidence: text:any matches /deterministic|retr(y|ies)|double-?charge/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: stripe-v2.
  evidence: text:any matches /ses_5F3vJAwkf9zXff2PL3aPow/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_5F3vJAwkf9zXff2PL3aPow #[0-9]+\)/

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
