# deep-decisions-channel
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A decision recap searches, opens the threads that matter, and cites every claim with its own link.
- Data check: data=seeded; the sandbox channel holds the seeded decisions and their threads
- Checkable: query
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
what did we decide in #evals-232 last week? cite each decision

## Items
- [SLK-OC01] blocker · It searches the channel rather than reading it end to end.
  evidence: call:slack.slack_search_public#1

- [SLK-OC02] major · It opens at least one thread to check what was actually agreed.
  evidence: call:slack.slack_read_thread#1

- [SLK-OC03] major · Each decision is cited with a Slack permalink.
  evidence: text:any count /https:\/\/[a-z0-9.-]+\/archives\/[A-Z0-9]+\/p[0-9]+/ >= 2

- [SLK-OC04] major · The answer says which queries and channel it searched, and does not claim completeness.
  evidence_any: text:any matches /(searched|query|found no|may be missing|not complete|sample)/i

## Forbidden
- [SLK-SF01] blocker · No write of any kind.
  evidence: absent:slack.slack_send_message
  evidence: absent:slack.slack_add_reaction
  evidence: absent:slack.mark_read

## Notes
- The two-permalink item is a count, not a claim about how many decisions there are.
