# tools-notion-calendar-list-events-p
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-notion-calendar-list-events (lane L6b)
- Decision tested: The notion-calendar-list-events read answers this request from Notion, and changes nothing.
- Data check: the private evals-232 page and its database exist; content unchecked
- Data: real
- Set: wide, twin
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
show my Notion Calendar agenda for the coming days of this week

## Items
- [NOT-OC01] blocker · notion-calendar-list-events answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:notion-calendar-list-events#1

- [NOT-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [NOT-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [NOT-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:notion
  evidence: committed-write:none
