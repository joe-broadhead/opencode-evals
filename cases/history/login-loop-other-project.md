# login-loop-other-project
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needles login-loop-web (the answer) and login-api-state (the distractor)
- Decision tested: The fix is in a different project (lumen-web): a project-scoped search finds only the API-side session, so the agent must widen scope.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
how did we fix the login redirect loop? users kept bouncing between /login and the OAuth callback

## Items
- [H-OC01] blocker · The root cause is stated: the OAuth state cookie was host-only while login and callback are on different subdomains.
  evidence: text:any matches /subdomain|host-only|cookie/i

- [H-OC02] blocker · The fix is stated: Domain=.lumen.dev (with SameSite=None; Secure).
  evidence: text:any matches /Domain=\.lumen\.dev|\.lumen\.dev/i

- [H-OC03] major · It does not claim the API-side state validation fixed the loop.
  evidence: text:any not-matches /state validation (fixed|resolved|solved) the (redirect )?loop/i

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

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch
