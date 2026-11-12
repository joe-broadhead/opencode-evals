# vague-upload-bug
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle flaky-upload
- Decision tested: A vague, time-fuzzy recollection: no error text, no file name.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
there was some bug with the uploads a couple of weeks ago, tests being weird. what was going on there?

## Items
- [H-OC01] blocker · It identifies the flaky upload test and its cause (the test did not wait for the response stream to finish).
  evidence: text:any matches /finished|stream|response/i

- [H-OC02] major · It does not describe the unrelated checkout deadlock instead.
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
  evidence: absent:apply_patch
