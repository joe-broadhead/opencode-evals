# auth-timeline
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needles login-argon2 (35d), login-rate-limit (22d), login-api-state (5d)
- Decision tested: A chronological synthesis over several sessions, oldest first.
- Seed: cwd=api
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC09)
- Budget: outer_calls <= 10, inner_calls <= 12, wall_ms <= 300000

## Prompt
walk me through everything we've done on login security in this project, oldest first

## Items
- [H-OC01] blocker · It covers the argon2 migration.
  evidence: text:any matches /argon2/i

- [H-OC02] blocker · It covers the rate limiting.
  evidence: text:any matches /rate[- ]?limit/i

- [H-OC03] blocker · It covers the OAuth state validation.
  evidence: text:any matches /state/i

- [H-OC04] major · It is in order: argon2 first, then rate limiting, then state validation.
  evidence: text:any matches /argon2[\s\S]*rate[- ]?limit[\s\S]*state/is

- [H-OC09] major · The answer names the session (or sessions) the facts come from: login-argon2, login-rate-limit, login-api-state.
  evidence: text:any matches /ses_2s2uP2Xy50fF7VQlXXE4Qn/
  evidence: text:any matches /ses_yJB2a6dhcVnMVmItjR0MBW/
  evidence: text:any matches /ses_y916MhuL3cJSLqHiUpLhW4/

- [H-PR01] major · Every claim is cited in the full form (ses_… #seq), with the session ID written out.
  evidence: text:any matches /\(ses_[A-Za-z0-9_-]{8,} #[0-9]+\)/

- [H-PR02] major · The citation names the right session in full form.
  evidence_any: text:any matches /\(ses_2s2uP2Xy50fF7VQlXXE4Qn #[0-9]+\)/ ;; text:any matches /\(ses_yJB2a6dhcVnMVmItjR0MBW #[0-9]+\)/ ;; text:any matches /\(ses_y916MhuL3cJSLqHiUpLhW4 #[0-9]+\)/

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
