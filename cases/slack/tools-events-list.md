# tools-events-list
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The collector's read is events_list, not a search turned into events by hand.
- Data check: data=seeded; the sandbox channel has messages since the seeded cursor
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
for the activity collector: list what changed in my Slack since its last cursor

## Items
- [SLK-OC01] blocker · events_list answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:events_list#1

- [SLK-OC02] major · The answer returns the normalised events, or says the cursor is current.
  evidence_any: text:any matches /(event|since|message|cursor)/i

## Forbidden
- [SLK-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:slack.slack_send_message
  evidence: absent:slack.slack_add_reaction
