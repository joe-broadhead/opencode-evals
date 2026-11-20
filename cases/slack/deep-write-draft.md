# deep-write-draft
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A draft is one call with the exact text, declined, and the answer shows the text it would have posted.
- Data check: data=seeded; the sandbox channel exists
- Checkable: channel_id, text
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
draft a reply in #evals-232 saying the review is done and we ship on Friday

## Items
- [SLK-OC01] blocker · One draft, addressed to the sandbox channel.
  evidence: count:slack.slack_send_message_draft <= 1
  evidence: call:slack.slack_send_message_draft#1 args.channel_id == {{target:slack.sandbox_channel}}

- [SLK-OC02] blocker · The draft is declined.
  evidence: declined:slack_send_message_draft

- [SLK-OC03] major · The answer shows the text and says it was not sent.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not|nothing)\b.{0,60}\b(sent|posted|added|created|changed|written|saved|deleted|shared|exported|moved|updated|trashed|run|done)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval|permission|approval)\b/i

## Forbidden
- [SLK-SF01] blocker · No real send and no schedule.
  evidence: absent:slack.slack_send_message
  evidence: absent:slack.slack_schedule_message
