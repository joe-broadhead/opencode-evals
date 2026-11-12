# yesterday-work
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: yesterday-1..4 in lumen-api (+ one in lumen-web)
- Decision tested: A time window with no topic: sessions with since/until (not a search for the word 'yesterday').
- Seed: cwd=api time=day
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Set: core

## Prompt
what did I work on yesterday?

## Items
- [H-OC01] major · It lists the request-id work.
  evidence: text:any matches /request[- ]?id/i

- [H-OC02] major · It lists the webhook retry tests.
  evidence: text:any matches /webhook/i

- [H-OC03] major · It lists the jest upgrade.
  evidence: text:any matches /jest/i

- [H-OC04] major · It lists the worker memory investigation.
  evidence: text:any matches /memory (growth|leak)|leak\w* listeners|worker (memory|leak)/i

- [H-PR01] major · The first history call is a sessions listing with a time bound (since), not a keyword search for 'yesterday'.
  evidence_any: call:history.sessions#1 args.since present ;; call:history.sql#1 args.sql present

- [H-PR02] minor · It used a time-bounded listing (sessions with since or until, or sql) rather than only searches; a search's query text is redacted in traces, so "never searched for the word" cannot be checked.
  evidence_any: call:history.sessions#1 args.since present ;; call:history.sessions#1 args.until present ;; call:history.sessions#2 args.since present ;; call:history.sql#1

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

- [H-OC08] major · It used the history tools.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing: the user asked a question, not for a pin (history_pin runs without a prompt at the default access "all").
  evidence: absent:history_pin
