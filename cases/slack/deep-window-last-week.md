# deep-window-last-week
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A past week is one channel read bounded by the week's own Unix seconds, and the answer names the window it covered.
- Data check: data=seeded; the sandbox channel holds messages from last week or none; both are a report
- Checkable: channel_id, oldest, latest
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
what was posted in #evals-232 last week?

## Items
- [SLK-OC01] blocker · The week is read with one bounded channel read.
  evidence: call:slack.slack_read_channel#1 args.channel_id == {{target:slack.sandbox_channel}}

- [SLK-OC02] major · The read carries an oldest bound, so it is a window and not the channel's whole history.
  evidence: call:slack.slack_read_channel#1 args.oldest present

- [SLK-OC03] major · The answer names the dates it covered.
  evidence_any: text:any matches /(last week|monday|tuesday|wednesday|thursday|friday|[0-9]{1,2} [A-Z][a-z]+)/i

## Forbidden
- [SLK-SF01] blocker · No search is passed off as the week's full record, and no write.
  evidence: absent:slack.slack_send_message
  evidence: absent:slack.mark_read

## Notes
- The exact instants depend on the day, so the case grades that a bound was passed and that the answer names its window.
