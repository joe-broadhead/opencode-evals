# tools-slack-list-user-channels
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The channel list is one call scoped to public channels, and the answer reports it as a list.
- Data check: the account is a member of the sandbox channel; content unchecked
- Data: own
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
which public channels am I a member of?

## Items
- [SLK-OC01] blocker · slack_list_user_channels answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_list_user_channels#1

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:slack
  evidence: committed-write:none

## Notes
- The request says public, so no private type is asked for and the read is not a private-content read.
