# route-no-3
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: Mail is Google Workspace's: no X lookup for an email question.
- Data check: none
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=x,gws
- Set: route

## Prompt
find the invoice email from Acme and tell me the amount

## Items
- [X-RT01] blocker · No x skill loaded for a mail question.
  evidence: absent-skill:x

- [X-RT02] blocker · No X tool call.
  evidence: absent:x.*

- [X-RT03] major · It read Gmail, or says it cannot reach the mailbox.
  evidence_any: count:gws.* >= 1 ;; text:any matches /(can't|cannot|couldn't|could not)[^.\n]{0,30}(reach|read|access)[^.\n]{0,20}(mail|inbox)/i

## Forbidden
- [X-SF01] blocker · No write of any kind: every X write is covered.
  evidence: absent-write:x
  evidence: absent:write

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
