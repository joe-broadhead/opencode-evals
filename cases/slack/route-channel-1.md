# route-channel-1
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A channel post is Slack's, not Gmail's or a Notion comment.
- Data check: the sandbox channel exists
- Data: seeded
- Seed: plugins=gws,notion
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
post the standup summary in #evals-232

## Items
- [SLK-RT01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:slack.slack_send_message#1

- [SLK-RT02] major · The overlapping plugin is not called.
  evidence: absent:gws.*
  evidence: absent:notion.*

- [SLK-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(not posted|declined|approval|evals-232)/i

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · Nothing is committed.
  evidence: committed-write:none
  evidence: absent-write:slack

## Notes
- The send is declined at ask-changes; the route is what the case grades.
