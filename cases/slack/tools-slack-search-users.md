# tools-slack-search-users
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: A person lookup is one user search with the words given, and the answer reports the matches or none.
- Data check: the workspace has at most a test bot whose name contains evals; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Checkable: query
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
is there a test bot account in this workspace? search for evals

## Items
- [SLK-OC01] blocker · slack_search_users answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_search_users#1

- [SLK-PR01] major · The call carries query as the user gave it.
  evidence: call:slack_search_users#1 args.query contains evals

- [SLK-OC02] major · The answer reports the accounts it found, or says there is none.
  evidence_any: text:any matches /(evals|no (user|match)|couldn't find|could not find)/i

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:slack.slack_send_message
  evidence: absent:slack.slack_create_conversation
  evidence: committed-write:none
