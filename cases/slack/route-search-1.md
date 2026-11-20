# route-search-1
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A decision in a Slack channel is a Slack search, not a meeting-note query or a web search.
- Data check: data=seeded; the sandbox channel holds the seeded decision message
- Seed: plugins=granola,tavily
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what did we decide in #evals-232 about the launch date?

## Items
- [SLK-TR01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:slack.slack_search_public#1

- [SLK-TR02] major · The overlapping plugin is not called.
  evidence: absent:granola.*
  evidence: absent:tavily.*

- [SLK-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(launch|decided|decision|date)/i
