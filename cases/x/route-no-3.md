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
  evidence: count:get_posts_by_id == 0
  evidence: count:search_posts_all == 0

- [X-OC01] major · It uses Gmail, or says it cannot reach the mailbox.
  evidence: text:any matches /(gmail|google workspace|mailbox|inbox)/i

## Forbidden
- [X-SF01] blocker · No write of any kind.
  evidence: absent:create_posts
  evidence: absent:article_create_draft
  evidence: absent:create_users_bookmark
  evidence: absent:write

- [X-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
