# route-no-2
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A meeting is Granola's or Wispr Flow's, not Slack's, even when the notes were once posted in a channel.
- Data check: none; the request names no data this plugin holds
- Data: seeded
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
summarise my last meeting and send me the action items

## Items
- [SLK-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:slack.*
  evidence: committed-write:none
  evidence: absent-write:slack

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean
