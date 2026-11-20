# route-no-3
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local export is read with the local file tools, not by searching Slack for the same text.
- Data check: the credential-free local arm has chat-export.csv in the working directory
- Data: seeded
- Set: route, local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
summarise the chat-export.csv on my Desktop and list the busiest channels

## Items
- [SLK-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:slack.*
  evidence: committed-write:none
  evidence: absent-write:slack

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean
