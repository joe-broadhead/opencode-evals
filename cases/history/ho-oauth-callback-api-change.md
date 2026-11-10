# ho-oauth-callback-api-change
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needle login-api-state
- Decision tested: Held out: the API-side session itself, asked directly.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000
- Holdout: true

## Prompt
what did we change in the API's OAuth callback handler?

## Items
- [H-OC01] blocker · It reports the added state validation (400 invalid_state on a bad or missing state).
  evidence: text:any matches /state/i

- [H-OC09] major · The answer names the session (or sessions) the facts come from: login-api-state.
  evidence: text:any matches /ses_y916MhuL3cJSLqHiUpLhW4/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_y916MhuL3cJSLqHiUpLhW4 #[0-9]+\)/

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
