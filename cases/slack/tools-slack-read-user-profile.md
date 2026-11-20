# tools-slack-read-user-profile
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The signed-in user's profile is one profile read, and the answer repeats only what it holds.
- Data check: data=seeded; the signed-in account has a profile
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what does my Slack profile say about me?

## Items
- [SLK-OC01] blocker · slack_read_user_profile answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:slack_read_user_profile#1

- [SLK-OC02] major · The answer reports the profile fields it read.
  evidence_any: text:any matches /(profile|title|name|timezone|email)/i

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:slack.slack_send_message
  evidence: absent:slack.slack_create_conversation

## Notes
- The user id is the account's own; there is no sandbox alias for a person, so the call itself is graded.
