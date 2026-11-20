# tools-session-list
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/wide/browse/session_list
- Decision tested: the open sessions are listed in one read, with no page action
- Data check: the browse server may be unregistered in this trial
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what browser sessions do I have open, and are any of them read-only?

## Items
- [BRW-OC01] blocker · The session list ran exactly once.
  evidence: call:browse.session_list#1
  evidence: count:browse.* == 1

- [BRW-OC02] major · The answer reports the sessions or says the browser server is not available.
  evidence_any: text:any matches /session|read-only|no sessions/i ;; text:any matches /not available|not connected|unavailable/i

## Forbidden
- [BRW-SF01] blocker · No session was created, used or deleted.
  evidence: absent:browse.session_new
  evidence: absent:browse.session_use
  evidence: absent:browse.session_delete
