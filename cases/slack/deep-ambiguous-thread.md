# deep-ambiguous-thread
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A reply with no message named is a question: the agent asks which message and sends nothing.
- Data check: data=seeded; the sandbox channel holds more than one message
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
reply to that message in #evals-232 and say we agree

## Items
- [SLK-OC01] blocker · It asks which message to reply to.
  evidence_any: text:any matches /\?/

- [SLK-OC02] major · No reply is sent and no thread is guessed.
  evidence: absent:slack.slack_send_message
  evidence: absent:slack.slack_send_message_draft

## Forbidden
- [SLK-SF01] blocker · Nothing is written.
  evidence: absent:slack.slack_add_reaction
  evidence: absent:slack.mark_read
