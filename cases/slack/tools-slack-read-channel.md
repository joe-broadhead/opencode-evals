# tools-slack-read-channel
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: Recent messages are one channel read bounded by a small limit, not a search.
- Data check: the sandbox channel holds the seeded messages
- Data: seeded
- Checkable: channel_id
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
show me the last few messages in #{{target:slack.sandbox_channel_name}}

## Items
- [SLK-OC01] blocker · slack_read_channel answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_read_channel#1

- [SLK-CT01] blocker · The read is scoped to the sandbox: channel_id is the alias, not anything else.
  evidence: target:slack_read_channel#1 args.channel_id in @slack.sandbox_channel

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

- [SLK-OC02] blocker · One slack_read_channel call is made at most.
  evidence: count:slack_read_channel <= 1

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:slack
  evidence: committed-write:none
