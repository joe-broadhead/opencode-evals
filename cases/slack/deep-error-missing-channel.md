# deep-error-missing-channel
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A channel that does not exist is reported as not found, with the search shown; no id is guessed and no other channel is summarised.
- Data check: no channel has that name; content unchecked
- Data: real
- Checkable: query
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
summarise what was said in #no-such-channel-232 last week

## Items
- [SLK-OC01] blocker · It looks the channel up before reading anything.
  evidence: call:slack.slack_search_channels#1

- [SLK-ER01] major · It says the channel was not found, naming what it searched for.
  evidence_any: text:any matches /(not found|no channel|couldn't find|could not find|didn't find)/i

- [SLK-ER02] major · It asks which channel the user means, or offers the closest match, without summarising a different one.
  evidence_any: text:any matches /\?/ ;; text:any matches /(closest|did you mean|which channel)/i

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · No channel read with a guessed id, and no write.
  evidence: absent-write:slack
  evidence: committed-write:none
  evidence: absent:slack.slack_read_channel
