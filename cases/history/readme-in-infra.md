# readme-in-infra
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needles readme-infra (answer), readme-web and readme-dots (noise)
- Decision tested: A bare README.md matches every repo's README; the agent must qualify the path with the repo folder.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
when did we last change the README in lumen-infra, and what did we add?

## Items
- [H-OC01] blocker · It reports the staging deploy section: make deploy ENV=staging.
  evidence: text:any matches /make deploy ENV=staging|staging/i

- [H-OC02] major · It does not report the badge or install.sh README changes of other repos.
  evidence: text:any not-matches /badge|install\.sh/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: readme-infra.
  evidence: text:any matches /ses_Eq0PXvN52YnBgdHoz50yVR/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_Eq0PXvN52YnBgdHoz50yVR #[0-9]+\)/

- [H-PR03] minor · A search or recall call used at least two phrasings of the topic.
  evidence_any: call:history.search#1 args.query.length >= 2 ;; call:history.recall#1 args.queries.length >= 2
  n/a_when: absent:history.search
  n/a_when: absent:history.recall

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

- [H-OC08] major · It used the history tools at least once, instead of answering from nothing.
  evidence: count:history.* >= 1

- [H-PR05] major · The files call qualified the path with a folder (it contains a slash).
  evidence_any: call:history.files#1 args.path matches /\//
  n/a_when: absent:history.files

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
