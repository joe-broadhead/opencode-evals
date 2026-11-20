# tools-slack-read-thread
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: A thread is one thread read on the parent's own timestamp, and the answer reports the agreement with links.
- Data check: data=seeded; the sandbox channel's pinned message has replies
- Checkable: channel_id
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
read the thread on the pinned message in #evals-232 and tell me what was agreed

## Items
- [SLK-OC01] blocker · slack_read_thread answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_read_thread#1

- [SLK-PR01] major · The call carries channel_id as the user gave it.
  evidence: call:slack_read_thread#1 args.channel_id == {{target:slack.sandbox_channel}}

- [SLK-OC02] major · The answer reports what the thread says.
  evidence_any: text:any matches /(agreed|thread|reply|replies|decided)/i

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:slack.slack_send_message
  evidence: absent:slack.slack_add_reaction

## Notes
- The parent ts is a sandbox fact with no alias; the channel is graded and the thread read proves the ts was real.
