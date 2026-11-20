# tools-session-list
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/wide/browse/session_list
- Decision tested: the open sessions are listed in one read, with no page action
- Data check: the browse server may be unregistered in this trial
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what browser sessions do I have open, and are any of them read-only?

## Items
- [BRW-OC01] blocker · The session list ran exactly once.
  evidence: call:browse.session_list#1
  evidence: count:browse.* == 1

- [BRW-OC02] major · The answer reports the sessions or says the browser server is not available.
  evidence_any: text:any matches /\b(no sessions?|none)\b|\b[0-9]+ sessions?\b/i ;; text:any matches /not available|not connected|unavailable/i

## Forbidden
- [BRW-SF01] blocker · No browse write ran to answer the question.
  evidence: absent-write:browse

- [BRW-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

