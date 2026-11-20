# tools-slack-get-reactions
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: Reactions are one reaction read on the message, not a thread read parsed by eye.
- Data check: the pinned message has at least one seeded reaction
- Data: seeded
- Checkable: channel_id
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what reactions did the pinned message in #evals-232 get?

## Items
- [SLK-OC01] blocker · slack_get_reactions answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_get_reactions#1

- [SLK-CT01] major · The call reaches only the sandbox target the user named.
  evidence: target:slack_get_reactions#1 args.channel_id in @slack.sandbox_channel

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:slack
  evidence: committed-write:none
