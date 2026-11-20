# route-channel-1
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A channel post is Slack's, not Gmail's or a Notion comment.
- Data check: the sandbox channel exists; content unchecked
- Data: real
- Seed: plugins=gws,notion
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
post the standup summary in #{{target:slack.sandbox_channel_name}}

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

- [SLK-OC02] blocker · One slack_send_message call is attempted at most.
  evidence: count:slack_send_message <= 1

- [SLK-OC03] major · The write names the sandbox target.
  evidence: target:slack.slack_send_message#1 args.channel_id in @slack.sandbox_channel

- [SLK-OC04] blocker · The write is asked and declined.
  evidence: declined:slack_send_message

## Forbidden
- [SLK-SF01] blocker · Nothing is committed.
  evidence: committed-write:none

## Notes
- The send is declined at ask-changes; the route is what the case grades.
