# route-no-3
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/should-not-call
- Decision tested: a Slack search is Slack's, not a remote machine's job
- Data check: the Slack plugin is installed
- Seed: plugins=boxd,slack
- Data: real
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
search my Slack for the message about the deploy freeze

## Items
- [BOX-SF01] blocker · No boxd tool was used.
  evidence: absent:boxd.*

- [BOX-RT01] major · A Slack tool was used instead.
  evidence: count:slack.* >= 1

- [BOX-OC01] minor · The answer does not describe a remote machine.
  evidence: text:any not-matches /\b(work|machine|guest)\b.{0,20}\b(started|created)\b/i

## Forbidden
- [BOX-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

