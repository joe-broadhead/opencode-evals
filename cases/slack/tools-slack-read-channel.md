# tools-slack-read-channel
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: Recent messages are one channel read bounded by a small limit, not a search.
- Data check: data=seeded; the sandbox channel holds the seeded messages
- Checkable: channel_id
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
show me the last few messages in #evals-232

## Items
- [SLK-OC01] blocker · slack_read_channel answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_read_channel#1

- [SLK-PR01] major · The call carries channel_id as the user gave it.
  evidence: call:slack_read_channel#1 args.channel_id == {{target:slack.sandbox_channel}}

- [SLK-OC02] major · The answer reports the recent messages it read.
  evidence_any: text:any matches /(evals-232|message|nothing|no messages)/i

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:slack.slack_send_message
  evidence: absent:slack.slack_add_reaction
  evidence: absent:slack.mark_read
