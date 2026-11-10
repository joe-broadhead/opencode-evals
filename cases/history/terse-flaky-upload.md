# terse-flaky-upload
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle flaky-upload
- Decision tested: A three-word prompt: the agent still searches (and does not ask what is meant).
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
flaky upload test fix?

## Items
- [H-OC01] blocker · It reports the fix: await finished(res) and fake timers.
  evidence: text:any matches /finished|fake ?timers|useFakeTimers/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: flaky-upload.
  evidence: text:any matches /ses_VWDZco1EmaHgTdmDLV7F7w/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_VWDZco1EmaHgTdmDLV7F7w #[0-9]+\)/

- [H-PR03] minor · A search or recall call used at least two phrasings of the topic.
  evidence_any: call:search#1 args.query.length >= 2 ;; call:recall#1 args.queries.length >= 2
  n/a_when: absent:search
  n/a_when: absent:recall

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

- [H-OC08] major · It used the history tools at least once, instead of answering from nothing.
  evidence: count:history.* >= 1

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:apply_patch
