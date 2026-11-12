# named-other-repo
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle login-loop-web
- Decision tested: The user names another repository: the search must leave this project (scope: all).
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
in lumen-web, how did we fix the login redirect loop?

## Items
- [H-OC01] blocker · It reports the cookie domain fix: Domain=.lumen.dev.
  evidence: text:any matches /\.lumen\.dev|Domain=/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: login-loop-web.
  evidence: text:any matches /ses_jgl42aR8z2nYy2Or6Jsfdf/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_jgl42aR8z2nYy2Or6Jsfdf #[0-9]+\)/

- [H-PR03] minor · A search or recall call used at least two phrasings of the topic.
  evidence_any: call:history.search#1 args.query.length >= 2 ;; call:history.recall#1 args.queries.length >= 2
  n/a_when: absent:history.search
  n/a_when: absent:history.recall

- [H-TR01] minor · The history-recall skill was loaded.
  evidence: skill:history-recall

- [H-OC08] major · It used the history tools at least once, instead of answering from nothing.
  evidence: count:history.* >= 1

- [H-PR05] major · The first search used scope: all, since the user named a different repository.
  evidence_any: call:history.search#1 args.scope == all ;; call:history.recall#1 args.scope == all

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
