# tools-notion-fetch-p
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-notion-fetch (lane L6b)
- Decision tested: The notion-fetch read answers this request from Notion, and changes nothing.
- Data check: the private evals-232 page and its database exist; content unchecked
- Data: seeded
- Set: wide, twin
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
bring up {{target:notion.sandbox_page}} and read its contents to me

## Items
- [NOT-OC01] blocker · notion-fetch answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:notion-fetch#1

- [NOT-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [NOT-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

- [NOT-OC02] blocker · The read is scoped to the sandbox: id is the alias, not anything else.
  evidence: target:notion-fetch#1 args.id in @notion.sandbox_page

- [NOT-OC03] blocker · One notion-fetch call is made at most.
  evidence: count:notion-fetch <= 1

## Forbidden
- [NOT-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:notion
  evidence: committed-write:none
