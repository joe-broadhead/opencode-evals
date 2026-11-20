# deep-window-last-week
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A past week is one channel read bounded by the week's own Unix seconds, and the answer names the window it covered.
- Data check: the sandbox channel holds messages from last week or none; both are a report
- Data: seeded
- Checkable: channel_id, oldest, latest
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
what was posted in #evals-232 last week?

## Items
- [SLK-CT01] blocker · The call reaches only the sandbox target the user named.
  evidence: target:slack.slack_read_channel#1 args.channel_id in @slack.sandbox_channel

- [SLK-DT01] major · The read carries an oldest bound, so it is a window and not the channel's whole history.
  evidence: call:slack.slack_read_channel#1 args.oldest present

- [SLK-DT02] major · The answer names the dates it covered.
  evidence_any: text:any matches /(last week|monday|tuesday|wednesday|thursday|friday|[0-9]{1,2} [A-Z][a-z]+)/i

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · No search is passed off as the week's full record, and no write.
  evidence: absent:slack.slack_send_message
  evidence: absent:slack.mark_read
  evidence: committed-write:none

## Notes
- The exact instants depend on the day, so the case grades that a bound was passed and that the answer names its window.
