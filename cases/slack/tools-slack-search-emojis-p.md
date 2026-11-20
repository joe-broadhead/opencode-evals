# tools-slack-search-emojis-p
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-slack-search-emojis (lane L6b)
- Decision tested: An emoji lookup is one emoji search, and the answer reports the match or says there is none.
- Data check: the workspace's emoji set either has parrot or does not; both are a report
- Data: real
- Checkable: query
- Set: wide, twin
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
does this workspace have a custom parrot-with-a-party-hat emoji?

## Items
- [SLK-OC01] blocker · slack_search_emojis answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_search_emojis#1

- [SLK-PR01] major · The call carries query as the user gave it.
  evidence: call:slack_search_emojis#1 args.query contains parrot

- [SLK-OC02] major · The answer reports the emoji it found, or says there is none.
  evidence_any: text:any matches /(parrot|no (emoji|match)|couldn't find|could not find)/i

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:slack
  evidence: committed-write:none
