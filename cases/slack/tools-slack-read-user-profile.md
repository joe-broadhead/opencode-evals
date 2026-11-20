# tools-slack-read-user-profile
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The signed-in user's profile is one profile read, and the answer repeats only what it holds.
- Data check: the signed-in account has a profile; content unchecked
- Data: real
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what does my Slack profile say about me?

## Items
- [SLK-OC01] blocker · slack_read_user_profile answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_read_user_profile#1

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:slack
  evidence: committed-write:none

## Notes
- The user id is the account's own; there is no sandbox alias for a person, so the call itself is graded.
