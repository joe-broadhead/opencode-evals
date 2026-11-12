# fix-flaky-upload
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle flaky-upload (distractor: flaky-checkout)
- Decision tested: A 'how did we fix X' question: the agent finds the right session and reports the root cause and the fix, with a citation.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Set: core

## Prompt
how did we fix the flaky upload test? the one that kept failing in CI about 1 in 5 runs

## Items
- [H-OC01] blocker · The root cause is stated: the test asserted before the response stream finished (awaiting finished(res) from stream/promises).
  evidence: text:any matches /finished\(|stream/promises|response (stream )?(to )?finish|stream (to )?finish/i

- [H-OC02] major · The fake-timers part of the fix is stated (useFakeTimers with nextTick left real).
  evidence: text:any matches /fake ?timers|useFakeTimers/i

- [H-OC03] major · It does not mix in the other flaky test: checkout / deadlock.
  evidence: text:any not-matches /deadlock/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: flaky-upload.
  evidence: text:any matches /ses_VWDZco1EmaHgTdmDLV7F7w/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_VWDZco1EmaHgTdmDLV7F7w #[0-9]+\)/

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
