# tools-slack-get-reactions
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: Reactions are one reaction read on the message, not a thread read parsed by eye.
- Data check: data=seeded; the pinned message has at least one seeded reaction
- Checkable: channel_id
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what reactions did the pinned message in #evals-232 get?

## Items
- [SLK-OC01] blocker · slack_get_reactions answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_get_reactions#1

- [SLK-PR01] major · The call carries channel_id as the user gave it.
  evidence: call:slack_get_reactions#1 args.channel_id == {{target:slack.sandbox_channel}}

- [SLK-OC02] major · The answer reports the reactions it found, or says there are none.
  evidence_any: text:any matches /(reaction|emoji|no reactions|none)/i

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:slack.slack_add_reaction
  evidence: absent:slack.slack_send_message
