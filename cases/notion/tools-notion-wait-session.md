# tools-notion-wait-session
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The notion-wait-session read answers this request from Notion, and changes nothing.
- Data check: the private evals-232 page and its database exist
- Data: seeded
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
wait for my Notion agent session to finish

## Items
- [NOT-OC01] blocker · notion-wait-session answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:notion-wait-session#1

- [NOT-OC02] major · The answer reports what the read returned, naming pages rather than ids.
  evidence_any: text:any matches /(session|wait|finish)/i

- [NOT-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [NOT-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [NOT-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:notion-delete-pages
  evidence: absent:notion-delete-databases
  evidence: absent:notion-restore-version
  evidence: absent:notion-move-pages
  evidence: absent:notion-create-pages
  evidence: committed-write:none
