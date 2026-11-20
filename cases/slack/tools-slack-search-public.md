# tools-slack-search-public
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: A channel-scoped search is one search with the channel and the words in the query, and the hits are cited.
- Data check: the sandbox channel holds the seeded canary message about the launch checklist
- Data: seeded
- Checkable: query
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
search #{{target:slack.sandbox_channel_name}} for the message about the launch checklist

## Items
- [SLK-OC01] blocker · slack_search_public answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_search_public#1

- [SLK-PR01] major · The call carries query as the user gave it.
  evidence: call:slack_search_public#1 args.query contains launch

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:slack
  evidence: committed-write:none

## Notes
- The query is free text, so it is declared checkable.
