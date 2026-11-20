# tools-slack-search-channels
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: A channel lookup is one channel search, and the answer gives the id it found.
- Data check: the sandbox channel exists and is named evals-232
- Data: seeded
- Checkable: query
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what's the channel id for #evals-232?

## Items
- [SLK-OC01] blocker · slack_search_channels answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_search_channels#1

- [SLK-PR01] major · The call carries query as the user gave it.
  evidence: call:slack_search_channels#1 args.query contains evals-232

- [SLK-OC02] major · The answer names the channel and gives its id.
  evidence_any: text:any matches /(C[A-Z0-9]{6,}|evals-232)/

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:slack.slack_send_message
  evidence: absent:slack.slack_create_conversation
  evidence: committed-write:none
