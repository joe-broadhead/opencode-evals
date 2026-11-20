# route-search-1
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A decision in a Slack channel is a Slack search, not a meeting-note query or a web search.
- Data check: the sandbox channel holds the seeded decision message; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Seed: plugins=granola,tavily
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what did we decide in #evals-232 about the launch date?

## Items
- [SLK-RT01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:slack.slack_search_public#1

- [SLK-RT02] major · The overlapping plugin is not called.
  evidence: absent:granola.*
  evidence: absent:tavily.*

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · Nothing is committed.
  evidence: committed-write:none
  evidence: absent-write:slack
