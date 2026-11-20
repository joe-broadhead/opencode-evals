# tools-slack-read-list
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: A Slack list is read by its own id, and the answer reports its records rather than a channel read.
- Data check: the sandbox list exists in the sandbox channel
- Data: seeded
- Checkable: list_id
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
read the evals list and show me its records

## Items
- [SLK-OC01] blocker · slack_read_list answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_read_list#1

- [SLK-CT01] major · The call reaches only the sandbox target the user named.
  evidence: target:slack_read_list#1 args.list_id in @slack.sandbox_list

- [SLK-OC02] major · The answer reports the list's records.
  evidence_any: text:any matches /(record|list|row|item)/i

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:slack.slack_update_list
  evidence: absent:slack.slack_add_list_record
  evidence: absent:slack.slack_send_message
  evidence: committed-write:none
