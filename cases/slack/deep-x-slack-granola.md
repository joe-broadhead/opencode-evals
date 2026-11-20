# deep-x-slack-granola
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: The cross-plugin task reads the meeting with Granola and posts with Slack; the post is declined and the answer says so.
- Data check: the sandbox Granola folder holds the seeded meeting, and the sandbox channel exists; content is unchecked; only route, arguments and the declined call are graded
- Data: real
- Seed: plugins=granola,slack
- Checkable: channel_id, text
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
summarise my last Granola meeting and post the action items to #{{target:slack.sandbox_channel_name}}

## Items
- [SLK-WR01] blocker · One post is attempted in the sandbox channel.
  evidence: count:slack.slack_send_message <= 1
  evidence: target:slack.slack_send_message#1 args.channel_id in @slack.sandbox_channel

- [SLK-WR02] blocker · The post is declined.
  evidence: declined:slack_send_message

- [SLK-WR03] major · The answer gives the action items and says they were not posted.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not|nothing)\b.{0,60}\b(posted|sent)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF00] blocker · No other Slack write and no Granola write.
  evidence: absent:slack.slack_send_message_draft
  evidence: absent:slack.slack_schedule_message
  evidence: absent:slack.slack_create_canvas
  evidence: absent:slack.slack_add_reaction
  evidence: absent:slack.mark_read
  evidence: absent-write:granola
  evidence: committed-write:none
