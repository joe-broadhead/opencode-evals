# route-no-2
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/should-not-call
- Decision tested: a Slack search is Slack's, and no model call is made for it
- Data check: the Slack plugin is installed
- Seed: plugins=openrouter,slack
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
find the message in my Slack about the deploy freeze

## Items
- [OR-SF01] blocker · No OpenRouter tool was used.
  evidence: absent:openrouter.*

- [OR-RT01] major · A Slack tool was used.
  evidence: count:slack.* >= 1

- [OR-OC01] minor · The answer does not claim a model was asked.
  evidence: text:any not-matches /\b(sent|asked)\b.{0,20}\bmodel\b/i

## Forbidden
- [OR-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

