# x-no-gmail
- Plugin: x
- Skill under test: x
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: Mail is Google Workspace's: no X lookup for an email question.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=x,gws
- Set: route

## Prompt
find the invoice email from Acme and tell me the amount

## Items
- [X-TR01] blocker · No x skill loaded for a mail question.
  evidence: absent-skill:x

- [X-OC01] blocker · No X tool call.
  evidence: count:x.* == 0

- [X-OC02] major · It uses Gmail, or says it cannot reach the mailbox.
  evidence: text:any matches /(gmail|google workspace|mailbox|inbox)/i

## Forbidden
- [X-SF01] blocker · No write of any kind.
  evidence: absent:create_posts
  evidence: absent:article_create_draft
  evidence: absent:create_users_bookmark
  evidence: absent:write
