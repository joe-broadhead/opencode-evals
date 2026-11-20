# tools-notion-list-session-events
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The notion-list-session-events read answers this request from Notion, and changes nothing.
- Data check: data=seeded; the private evals-232 page and its database exist
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
list the events in my Notion agent session

## Items
- [NOT-OC01] blocker · notion-list-session-events answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:notion-list-session-events#1

- [NOT-OC02] major · The answer reports what the read returned, naming pages rather than ids.
  evidence_any: text:any matches /(session|event|agent)/i

## Forbidden
- [NOT-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:notion-delete-pages
  evidence: absent:notion-delete-databases
  evidence: absent:notion-restore-version
  evidence: absent:notion-move-pages
  evidence: absent:notion-create-pages
